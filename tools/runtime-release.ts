/** D3F: read-only inspection now; future explicit reviewed commands are separate approvals. */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
  chmod,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deploymentContext, DeploymentSafetyError } from './deployment-context';
import { deployment, assertDeploymentEnvironment } from './deployment-guards';
import {
  verifyDeploymentCaller,
  reportDeploymentFailure,
} from './deployment-preflight';
import {
  verifyDeploymentAssembly,
  type DeploymentAssembly,
} from './deployment-sources';
import { runtimeInputStore } from './runtime-inputs';
import {
  prepareSavedRuntimePlan,
  assertRuntimePlanBackend,
} from './runtime-plan';
import {
  runtimeStateBackend,
  runtimeStateRoleName,
  runtimeStatePolicyName,
  runtimeStateDocument,
  runtimeStatePolicyHashes,
  assertRuntimeStateRole,
} from './runtime-state-role';
import {
  d3eBaselineRun,
  d3eBaselineHash,
  d3fPackageId,
  expectedExecutionPolicies,
  releaseProof as proof,
  parseRuntimeReviewId,
  assertFreshReview,
  assertFreePlan,
  assertRuntimeEquivalent,
  assertRuntimeTeardown,
  assertEmptyRuntimeStateHistory,
  runtimeReleaseArgs,
  claimRuntimeOperation,
  type ReleasePlan,
} from './runtime-apply-review';

const hash = (v: string | Uint8Array) =>
  createHash('sha256').update(v).digest('hex');
const linkedRoles = {
  AWSServiceRoleForECS: 'ecs.amazonaws.com',
  AWSServiceRoleForElasticLoadBalancing: 'elasticloadbalancing.amazonaws.com',
  AWSServiceRoleForRDS: 'rds.amazonaws.com',
} as const;
async function privateBytes(path: string) {
  const s = await lstat(path);
  proof(
    s.isFile() &&
      !s.isSymbolicLink() &&
      s.nlink === 1 &&
      s.uid === process.getuid?.() &&
      (s.mode & 0o777) === 0o600,
    'Private unshared artifact required',
  );
  return readFile(path);
}
async function absent(path: string) {
  try {
    await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  throw new DeploymentSafetyError(
    'Existing attempt/recovery artifact: stop; no automatic retry or state overwrite',
  );
}
const json = async (p: string) =>
  JSON.parse((await privateBytes(p)).toString());
const save = (p: string, v: unknown) =>
  writeFile(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx', mode: 0o600 });

export function runtimeReleaseCommand(args: string[]) {
  if (args.length === 1 && args[0] === 'inspect')
    return { operation: 'inspect' as const };
  if (args.length === 2 && args[0] === 'plan' && args[1] === d3fPackageId)
    return { operation: 'plan' as const };
  if (
    args.length === 3 &&
    args[1] === '--reviewed' &&
    (args[0] === 'apply' || args[0] === 'teardown')
  ) {
    parseRuntimeReviewId(args[2]!);
    return { operation: args[0], id: args[2]! };
  }
  if (
    args.length === 3 &&
    args[0] === 'teardown-plan' &&
    args[1] === '--after'
  ) {
    parseRuntimeReviewId(args[2]!);
    return { operation: 'teardown-plan' as const, id: args[2]! };
  }
  throw new DeploymentSafetyError(
    'Use inspect, plan <exact-package-id>, apply/teardown --reviewed <fresh-run:sha256>, or teardown-plan --after <apply-review-id>; no overrides',
  );
}

export async function runtimeRelease(
  repository: string,
  argv: string[],
  inherited = process.env,
) {
  const command = runtimeReleaseCommand(argv);
  assertDeploymentEnvironment(inherited);
  process.umask(0o077);
  const context = deploymentContext(repository, 'demo');
  const env = {
    ...inherited,
    AWS_DEFAULT_REGION: deployment.region,
    AWS_PAGER: '',
    AWS_CLI_AUTO_PROMPT: 'off',
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_MAX_ATTEMPTS: '1',
  };
  const identity = () => verifyDeploymentCaller(inherited);
  identity();
  function aws(
    service: string,
    operation: string,
    args: string[],
    optional = false,
  ) {
    proof(
      new Set([
        'freetier:get-account-plan-state',
        'iam:get-role',
        'iam:get-role-policy',
        'iam:list-role-policies',
        'iam:list-attached-role-policies',
        's3api:head-object',
        's3api:get-bucket-versioning',
        's3api:list-object-versions',
      ]).has(`${service}:${operation}`),
      'AWS capability is read-only and fixed',
    );
    const r = spawnSync(
      'aws',
      [
        service,
        operation,
        ...args,
        '--profile',
        deployment.profile,
        '--region',
        service === 'freetier' ? 'us-east-1' : deployment.region,
        '--output',
        'json',
        '--no-cli-pager',
        '--cli-connect-timeout',
        '5',
        '--cli-read-timeout',
        '15',
      ],
      { env, encoding: 'utf8', timeout: 25000, maxBuffer: 1024 * 1024 },
    );
    if (
      optional &&
      !r.error &&
      r.status !== 0 &&
      /\(NoSuchEntity\)|\(404\)|\(NotFound\)/.test(r.stderr)
    )
      return null;
    proof(
      !r.error && r.status === 0,
      `Read-only ${service}:${operation} denied/failed; no permission expansion`,
    );
    return JSON.parse(r.stdout || '{}');
  }
  function readiness(requireStateRole: boolean, cleanup = false) {
    identity();
    const free = aws('freetier', 'get-account-plan-state', []);
    assertFreePlan(free, cleanup);
    const linked = Object.entries(linkedRoles).map(([name, service]) => {
      const r = aws('iam', 'get-role', ['--role-name', name], true);
      if (r)
        proof(
          r.Role?.Arn ===
            `arn:aws:iam::${deployment.account}:role/aws-service-role/${service}/${name}`,
          'Unexpected service-linked-role ARN',
        );
      return { name, service, present: !!r };
    });
    const role = aws(
      'iam',
      'get-role',
      ['--role-name', runtimeStateRoleName],
      true,
    );
    if (role) {
      assertRuntimeStateRole(role.Role ?? {});
      proof(
        isDeepStrictEqual(
          aws('iam', 'get-role-policy', [
            '--role-name',
            runtimeStateRoleName,
            '--policy-name',
            runtimeStatePolicyName,
          ]).PolicyDocument,
          runtimeStateDocument('permissions'),
        ) &&
          isDeepStrictEqual(
            aws('iam', 'list-role-policies', [
              '--role-name',
              runtimeStateRoleName,
            ]).PolicyNames,
            [runtimeStatePolicyName],
          ) &&
          isDeepStrictEqual(
            aws('iam', 'list-attached-role-policies', [
              '--role-name',
              runtimeStateRoleName,
            ]).AttachedPolicies,
            [],
          ),
        'State-role policy drift; stop without IAM changes',
      );
    }
    proof(
      aws('s3api', 'get-bucket-versioning', [
        '--bucket',
        deployment.bucket,
        '--expected-bucket-owner',
        deployment.account,
      ]).Status === 'Enabled',
      'Versioned state bucket required',
    );
    if (requireStateRole)
      proof(
        role && (cleanup || linked.every((r) => r.present)),
        'Separate approval/creation required for state role or missing service-linked prerequisites',
      );
    return {
      freePlan: free,
      linkedRoles: linked,
      stateRolePresent: !!role,
      observedAt: new Date().toISOString(),
    };
  }
  async function assembly(run: string): Promise<DeploymentAssembly> {
    proof(/^[a-f0-9-]{36}$/.test(run), 'Invalid preparation ID');
    const prefix = `plan-preparation/${run}`;
    const manifest = context.path(`${prefix}/source-manifest.json`);
    const receipt = await json(manifest);
    const a = {
      context,
      prefix,
      manifest,
      receipt,
      work: context.path(`${prefix}/work`),
      data: context.path(`${prefix}/terraform-data`),
      mode: 'runtime-plan-preparation' as const,
    };
    for (const p of [
      context.base,
      context.path('plan-preparation'),
      context.path(prefix),
      a.work,
      a.data,
    ]) {
      const s = await lstat(p);
      proof(
        s.isDirectory() &&
          s.uid === process.getuid?.() &&
          (s.mode & 0o777) === 0o700,
        'Owner-only run directories required',
      );
    }
    await verifyDeploymentAssembly(a);
    return a;
  }
  function tfEnv(a: DeploymentAssembly, secret?: Record<string, string>) {
    return {
      ...env,
      TF_WORKSPACE: 'default',
      TF_DATA_DIR: a.data,
      TF_CLI_CONFIG_FILE: context.path(`${a.prefix}/terraform.rc`),
      TF_IN_AUTOMATION: '1',
      CHECKPOINT_DISABLE: '1',
      ...(secret ? { TF_VAR_secrets: JSON.stringify(secret) } : {}),
    };
  }
  function terraform(
    a: DeploymentAssembly,
    args: string[],
    secret?: Record<string, string>,
  ) {
    const r = spawnSync('terraform', args, {
      cwd: a.work,
      env: tfEnv(a, secret),
      encoding: 'utf8',
      timeout: args[0] === 'apply' ? 90 * 60000 : 300000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return r;
  }
  function show(a: DeploymentAssembly, path: string): ReleasePlan {
    const version = terraform(a, ['version', '-json']);
    proof(
      !version.error &&
        version.status === 0 &&
        JSON.parse(version.stdout).terraform_version === '1.15.3',
      'Only reviewed Terraform 1.15.3 may inspect/apply these packages',
    );
    const r = terraform(a, ['show', '-json', path]);
    proof(
      !r.error && r.status === 0,
      'Saved plan inspection failed; raw diagnostics withheld',
    );
    return JSON.parse(r.stdout);
  }
  async function baseline() {
    const a = await assembly(d3eBaselineRun);
    const plan = context.path(`${a.prefix}/runtime.tfplan`);
    proof(
      hash(await privateBytes(plan)) === d3eBaselineHash,
      'D3E baseline absent/changed',
    );
    proof(
      (
        await privateBytes(context.path(`${a.prefix}/terraform.rc`))
      ).toString() === 'provider_installation {\n direct {}\n}\n',
      'D3E CLI configuration changed',
    );
    assertRuntimePlanBackend(
      await json(context.path(`${a.prefix}/plan-backend.tfbackend.json`)),
      d3eBaselineRun,
    );
    return { a, plan: show(a, plan) };
  }
  async function codeHash() {
    const names = [
      'runtime-release.ts',
      'runtime-apply-review.ts',
      'runtime-state-role.ts',
      'runtime-plan.ts',
      'runtime-inputs.ts',
      'deployment-context.ts',
      'deployment-sources.ts',
      'deployment-guards.ts',
      'deployment-preflight.ts',
    ];
    return hash(
      Buffer.concat(
        await Promise.all(
          names.map((n) => readFile(resolve(repository, 'tools', n))),
        ),
      ),
    );
  }
  async function committedSources(a: DeploymentAssembly) {
    for (const file of a.receipt.files) {
      const r = spawnSync('git', ['show', `HEAD:infra/demo/${file.name}`], {
        cwd: repository,
        encoding: 'utf8',
        timeout: 15000,
      });
      proof(
        !r.error && r.status === 0 && hash(r.stdout) === file.sha256,
        'Infrastructure differs from committed D3E source',
      );
    }
  }
  function stateVersion() {
    const v = aws(
      's3api',
      'head-object',
      [
        '--bucket',
        deployment.bucket,
        '--key',
        'demo/terraform.tfstate',
        '--expected-bucket-owner',
        deployment.account,
      ],
      true,
    );
    return v ? { versionId: v.VersionId, etag: v.ETag } : null;
  }
  function noLock() {
    proof(
      aws(
        's3api',
        'head-object',
        [
          '--bucket',
          deployment.bucket,
          '--key',
          'demo/terraform.tfstate.tflock',
          '--expected-bucket-owner',
          deployment.account,
        ],
        true,
      ) === null,
      'Existing lock: stop, never force-unlock',
    );
  }
  async function checkPackage(id: string, allowOld = false) {
    const parsed = parseRuntimeReviewId(id);
    const a = await assembly(parsed.run);
    const receipt = await json(context.path(`${a.prefix}/d3f-review.json`));
    const plan = context.path(`${a.prefix}/runtime.tfplan`);
    if (!allowOld) assertFreshReview(receipt, id);
    proof(
      receipt.purpose === 'D3F' &&
        receipt.run === parsed.run &&
        receipt.sha256 === parsed.sha256 &&
        receipt.codeHash === (await codeHash()) &&
        hash(await privateBytes(plan)) === parsed.sha256 &&
        isDeepStrictEqual(receipt.policyHashes, runtimeStatePolicyHashes),
      'Review/hash/executor/policy binding changed',
    );
    const inputs = await runtimeInputStore(repository).loadInitialPlanInputs();
    proof(
      receipt.inputCommitment === hash(JSON.stringify(inputs)),
      'Existing secure inputs changed',
    );
    proof(
      isDeepStrictEqual(
        await json(context.path(`${a.prefix}/initial.tfvars.json`)),
        inputs.variables,
      ),
      'Prepared variables changed',
    );
    assertRuntimePlanBackend(
      await json(context.path(`${a.prefix}/plan-backend.tfbackend.json`)),
      parsed.run,
      'D3F',
    );
    const meta = await json(
      context.path(`${a.prefix}/terraform-data/terraform.tfstate`),
    );
    const cfg = meta.backend?.config;
    const assumed = Array.isArray(cfg?.assume_role)
      ? cfg.assume_role[0]
      : cfg?.assume_role;
    const desired = runtimeStateBackend(parsed.run);
    proof(
      meta.backend?.type === 's3' &&
        cfg.bucket === desired.bucket &&
        cfg.key === desired.key &&
        cfg.profile === deployment.profile &&
        cfg.region === deployment.region &&
        cfg.use_lockfile === true &&
        cfg.encrypt === true &&
        isDeepStrictEqual(cfg.allowed_account_ids, [deployment.account]) &&
        assumed?.role_arn === desired.assume_role.role_arn &&
        assumed.policy === desired.assume_role.policy &&
        assumed.session_name === desired.assume_role.session_name &&
        assumed.duration === '1h',
      'State-write backend mismatch',
    );
    proof(
      (
        await privateBytes(context.path(`${a.prefix}/terraform.rc`))
      ).toString() === 'provider_installation {\n direct {}\n}\n',
      'Terraform CLI configuration changed',
    );
    const old = await baseline();
    proof(
      isDeepStrictEqual(a.receipt.files, old.a.receipt.files),
      'Sources/lockfile changed from D3E',
    );
    await committedSources(a);
    assertRuntimeEquivalent(show(a, plan), old.plan, inputs.variables);
    for (const name of [
      'errored.tfstate',
      'terraform.tfstate',
      'terraform.tfstate.backup',
    ])
      await absent(context.path(`${a.prefix}/work/${name}`));
    return { a, inputs, receipt, plan };
  }

  if (command.operation === 'inspect') {
    const old = await baseline();
    const inputs = await runtimeInputStore(repository).loadInitialPlanInputs();
    await committedSources(old.a);
    const summary = assertRuntimeEquivalent(
      old.plan,
      old.plan,
      inputs.variables,
    );
    const observed = readiness(false);
    const dir = context.path(`apply-readiness/${randomUUID()}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const result = {
      packageId: d3fPackageId,
      baselineSha256: d3eBaselineHash,
      ...summary,
      statePolicyHashes: runtimeStatePolicyHashes,
      executionPolicies: expectedExecutionPolicies(),
      ...observed,
      mutationsPerformed: 0,
      provisioningAuthorized: false,
    };
    await save(resolve(dir, 'approval-package.json'), result);
    return { ...result, privateEvidence: dir };
  }
  if (command.operation === 'plan') {
    await absent(context.path('first-runtime-apply-attempt.json'));
    readiness(true);
    const old = await baseline();
    await committedSources(old.a);
    // A fresh namespace is mandatory, and an earlier unclaimed preparation is never overwritten.
    for (const run of await readdir(context.path('plan-preparation')))
      proof(
        (await readdir(context.path(`plan-preparation/${run}`))).includes(
          'plan-execution.json',
        ),
        'Unclaimed preparation already exists',
      );
    await runtimeInputStore(repository).preparePlan();
    const result = await prepareSavedRuntimePlan(repository, inherited, 'D3F');
    const a = await assembly(result.run);
    proof(
      isDeepStrictEqual(a.receipt.files, old.a.receipt.files),
      'D3E source manifest mismatch',
    );
    const inputs = await runtimeInputStore(repository).loadInitialPlanInputs();
    assertRuntimeEquivalent(show(a, result.plan), old.plan, inputs.variables);
    const receipt = {
      purpose: 'D3F',
      run: result.run,
      sha256: result.sha256,
      createdAt: new Date().toISOString(),
      codeHash: await codeHash(),
      inputCommitment: hash(JSON.stringify(inputs)),
      policyHashes: runtimeStatePolicyHashes,
    };
    await save(context.path(`${a.prefix}/d3f-review.json`), receipt);
    return {
      ...result,
      reviewId: `${result.run}:${result.sha256}`,
      provisioningAuthorized: false,
    };
  }
  if (command.operation === 'apply') {
    const p = await checkPackage(command.id);
    await absent(context.path('first-runtime-apply-attempt.json'));
    const observed = readiness(true);
    proof(
      stateVersion() === null,
      'Existing runtime state: first create-only apply refused',
    );
    const history = aws('s3api', 'list-object-versions', [
      '--bucket',
      deployment.bucket,
      '--prefix',
      'demo/terraform.tfstate',
      '--expected-bucket-owner',
      deployment.account,
      '--max-keys',
      '100',
      '--no-paginate',
    ]);
    assertEmptyRuntimeStateHistory(history);
    noLock();
    await checkPackage(command.id); // Rehash/show/input/source checks immediately before claiming.
    identity();
    const r = await claimRuntimeOperation(
      context.path('first-runtime-apply-attempt.json'),
      { reviewId: command.id, startedAt: new Date().toISOString(), observed },
      () =>
        terraform(
          p.a,
          runtimeReleaseArgs('apply', { plan: p.plan, variables: '' }),
          p.inputs.ephemeralSecrets,
        ),
    );
    await save(context.path(`${p.a.prefix}/infrastructure-apply-result.json`), {
      reviewId: command.id,
      status:
        r.status === 0 && !r.error ? 'COMMAND_SUCCEEDED' : 'FAILED_OR_UNKNOWN',
      exitCode: r.status,
      signal: r.signal,
      endedAt: new Date().toISOString(),
      automaticRetry: false,
    });
    const version = stateVersion();
    if (version?.versionId)
      await save(
        context.path(`${p.a.prefix}/infrastructure-state-version.json`),
        version,
      );
    proof(
      !r.error && r.status === 0,
      'Apply failed or outcome unknown: retain remote/local state; no retry or automatic cleanup',
    );
    proof(
      version?.versionId,
      'Apply command succeeded but durable versioned state verification failed; stop',
    );
    noLock();
    return {
      status: 'INFRASTRUCTURE_ONLY_APPLY_COMMAND_SUCCEEDED',
      reviewId: command.id,
      stateVersion: version,
      activationAuthorized: false,
    };
  }
  if (command.operation === 'teardown-plan') {
    const attempt = await json(
      context.path('first-runtime-apply-attempt.json'),
    );
    proof(
      attempt.reviewId === command.id,
      'Teardown must refer to the actual first-apply attempt',
    );
    const p = await checkPackage(command.id, true);
    readiness(true, true);
    noLock();
    const before = stateVersion();
    proof(
      before?.versionId,
      'No authoritative state: review unknown/partial outcomes before cleanup',
    );
    proof(
      isDeepStrictEqual(
        before,
        await json(
          context.path(`${p.a.prefix}/infrastructure-state-version.json`),
        ),
      ),
      'State changed since apply/partial-apply observation; separate recovery review required',
    );
    const run = randomUUID(),
      dir = context.path(`teardown-reviews/${run}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const plan = resolve(dir, 'teardown.tfplan');
    const r = terraform(
      p.a,
      runtimeReleaseArgs('teardown-plan', {
        plan,
        variables: context.path(`${p.a.prefix}/initial.tfvars.json`),
      }),
      p.inputs.ephemeralSecrets,
    );
    await save(resolve(dir, 'plan-attempt.json'), {
      exitCode: r.status,
      error: !!r.error,
      after: command.id,
    });
    proof(
      !r.error && r.status === 0,
      'Teardown plan failed: preserve claim/state; do not retry automatically',
    );
    await chmod(plan, 0o600);
    const summary = assertRuntimeTeardown(show(p.a, plan));
    proof(
      isDeepStrictEqual(stateVersion(), before),
      'State changed while preparing teardown',
    );
    const sha256 = hash(await privateBytes(plan));
    await save(resolve(dir, 'review.json'), {
      run,
      sha256,
      after: command.id,
      createdAt: new Date().toISOString(),
      stateVersion: before,
      codeHash: await codeHash(),
    });
    return {
      reviewId: `${run}:${sha256}`,
      plan,
      ...summary,
      destroyAuthorized: false,
    };
  }
  proof(
    command.operation === 'teardown' && command.id,
    'Explicit teardown review required',
  );
  const parsed = parseRuntimeReviewId(command.id);
  const dir = context.path(`teardown-reviews/${parsed.run}`);
  const receipt = await json(resolve(dir, 'review.json'));
  const age = Date.now() - Date.parse(receipt.createdAt);
  proof(
    receipt.run === parsed.run &&
      receipt.sha256 === parsed.sha256 &&
      age >= 0 &&
      age <= 15 * 60000 &&
      receipt.codeHash === (await codeHash()),
    'Fresh exact teardown review required',
  );
  const attempt = await json(context.path('first-runtime-apply-attempt.json'));
  proof(attempt.reviewId === receipt.after, 'Foreign teardown parent');
  const p = await checkPackage(receipt.after, true);
  const plan = resolve(dir, 'teardown.tfplan');
  proof(
    hash(await privateBytes(plan)) === parsed.sha256,
    'Teardown plan changed',
  );
  assertRuntimeTeardown(show(p.a, plan));
  readiness(true, true);
  proof(
    isDeepStrictEqual(stateVersion(), receipt.stateVersion),
    'State changed after teardown review',
  );
  noLock();
  identity();
  const r = await claimRuntimeOperation(
    resolve(dir, 'teardown-attempt.json'),
    { reviewId: command.id, startedAt: new Date().toISOString() },
    () =>
      terraform(
        p.a,
        runtimeReleaseArgs('teardown', { plan, variables: '' }),
        p.inputs.ephemeralSecrets,
      ),
  );
  await save(resolve(dir, 'teardown-result.json'), {
    status:
      r.status === 0 && !r.error ? 'COMMAND_SUCCEEDED' : 'FAILED_OR_UNKNOWN',
    exitCode: r.status,
    automaticRetry: false,
  });
  proof(
    !r.error && r.status === 0,
    'Teardown failed/unknown: retain state and obtain recovery review; no retry',
  );
  return {
    status: 'TEARDOWN_COMMAND_SUCCEEDED',
    actualRemovalVerificationRequired: true,
    retainedState: true,
  };
}

if (require.main === module)
  void runtimeRelease(resolve(__dirname, '..'), process.argv.slice(2))
    .then((v) => console.log(JSON.stringify(v, null, 2)))
    .catch(reportDeploymentFailure);
