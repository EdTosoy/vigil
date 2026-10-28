/** Recovery planning/review ONLY. No apply, destroy execution, unlock or state mutation command. */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deploymentContext } from './deployment-context';
import { deployment, assertDeploymentEnvironment } from './deployment-guards';
import {
  verifyDeploymentCaller,
  reportDeploymentFailure,
} from './deployment-preflight';
import { deploymentSourceNames } from './deployment-sources';
import {
  runtimePlanBackend,
  runtimePlannerRoleName,
  runtimePlannerPolicyName,
  runtimeBackendPolicy,
  assertRuntimePlannerRole,
  inspectRuntimeBackendIdentity,
} from './runtime-plan';
import { releaseProof as proof } from './runtime-apply-review';
import {
  assertRuntimeInputConfiguration,
  validateRuntimeSecrets,
} from './runtime-inputs';
import {
  validateRecoveryState,
  validateRecoveryPlan,
  assertRecoveryFresh,
  type RecoveryState,
} from './runtime-recovery-review';

const hash = (b: string | Uint8Array) =>
  createHash('sha256').update(b).digest('hex');
const deployedRun = 'f6d86afa-0b36-40e3-9b4d-c1112581ecb0';
export function recoveryCommand(args: string[]) {
  if (args.length === 1 && args[0] === 'plan')
    return { operation: 'plan' as const };
  if (args.length === 3 && args[0] === 'review' && args[1] === '--reviewed') {
    const m =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{64})$/.exec(
        args[2]!,
      );
    proof(m, 'Exact recovery run:SHA256 review ID required');
    return { operation: 'review' as const, run: m[1]!, sha256: m[2]! };
  }
  throw new Error(
    'Recovery supports only plan or review --reviewed <run:sha256>; execution is forbidden',
  );
}
async function bytes(path: string) {
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
const json = async (p: string) => JSON.parse((await bytes(p)).toString());
const save = (p: string, v: unknown) =>
  writeFile(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
export async function recovery(
  repository: string,
  args: string[],
  inherited = process.env,
) {
  const command = recoveryCommand(args);
  assertDeploymentEnvironment(inherited);
  process.umask(0o077);
  verifyDeploymentCaller(inherited);
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
  function aws(service: string, op: string, argv: string[], optional = false) {
    proof(
      [
        's3api:head-object',
        's3api:get-object',
        's3api:list-object-versions',
        's3api:get-bucket-versioning',
        'iam:get-role',
        'iam:get-role-policy',
        'iam:list-role-policies',
        'iam:list-attached-role-policies',
      ].includes(`${service}:${op}`),
      'Only fixed read-only AWS operations',
    );
    const r = spawnSync(
      'aws',
      [
        service,
        op,
        ...argv,
        '--profile',
        deployment.profile,
        '--region',
        deployment.region,
        '--output',
        'json',
        '--no-cli-pager',
        '--cli-connect-timeout',
        '5',
        '--cli-read-timeout',
        '15',
      ],
      { env, encoding: 'utf8', timeout: 25000, maxBuffer: 8 * 1024 * 1024 },
    );
    if (
      optional &&
      !r.error &&
      r.status !== 0 &&
      /\(404\)|\(NotFound\)/.test(r.stderr)
    )
      return null;
    proof(
      !r.error && r.status === 0,
      'Read-only AWS request failed; no credential fallback or permission expansion',
    );
    return JSON.parse(r.stdout || '{}');
  }
  const object = (key: string) => [
    '--bucket',
    deployment.bucket,
    '--key',
    key,
    '--expected-bucket-owner',
    deployment.account,
  ];
  function head() {
    const h = aws('s3api', 'head-object', object('demo/terraform.tfstate'));
    proof(h.VersionId, 'Versioned state required');
    return { versionId: h.VersionId, etag: h.ETag };
  }
  function versions() {
    const v = aws('s3api', 'list-object-versions', [
      '--bucket',
      deployment.bucket,
      '--prefix',
      'demo/',
      '--expected-bucket-owner',
      deployment.account,
    ]);
    return { versions: v.Versions ?? [], markers: v.DeleteMarkers ?? [] };
  }
  function noLock() {
    proof(
      aws(
        's3api',
        'head-object',
        object('demo/terraform.tfstate.tflock'),
        true,
      ) === null,
      'Existing lock: stop without force-unlock',
    );
  }
  const codeHash = async () =>
    hash(
      Buffer.concat(
        await Promise.all(
          [
            'runtime-recovery.ts',
            'runtime-recovery-review.ts',
            'runtime-plan.ts',
            'deployment-guards.ts',
            'deployment-preflight.ts',
            'deployment-context.ts',
          ].map((n) => readFile(resolve(repository, 'tools', n))),
        ),
      ),
    );
  if (command.operation === 'review') {
    const dir = context.path(`recovery-teardown/${command.run}`),
      receipt = await json(resolve(dir, 'review.json'));
    proof(
      receipt.run === command.run &&
        receipt.sha256 === command.sha256 &&
        hash(await bytes(resolve(dir, 'destroy.tfplan'))) === command.sha256 &&
        receipt.codeHash === (await codeHash()),
      'Recovery binary/receipt/code changed',
    );
    assertRecoveryFresh(receipt.createdAt, receipt.stateVersion, head());
    for (const f of receipt.files as { name: string; sha256: string }[])
      proof(
        hash(await bytes(resolve(dir, f.name))) === f.sha256,
        'Recovery snapshot/source/input changed',
      );
    noLock();
    return {
      status: 'REVIEW_VALID',
      ...receipt.summary,
      plan: resolve(dir, 'destroy.tfplan'),
      executionAuthorized: false,
      remainingReviewMinutes:
        15 - (Date.now() - Date.parse(receipt.createdAt)) / 60000,
    };
  }
  const run = randomUUID(),
    dir = context.path(`recovery-teardown/${run}`),
    work = resolve(dir, 'work'),
    data = resolve(dir, 'terraform-data');
  await mkdir(work, { recursive: true, mode: 0o700 });
  await mkdir(data, { mode: 0o700 });
  const source = context.path(`plan-preparation/${deployedRun}`);
  const attempt = await json(context.path('first-runtime-apply-attempt.json'));
  proof(
    attempt.reviewId.startsWith(deployedRun + ':'),
    'Unexpected first-apply receipt',
  );
  const originalVersion = await json(
    resolve(source, 'infrastructure-state-version.json'),
  );
  const manifest = await json(resolve(source, 'source-manifest.json'));
  proof(
    manifest.account === deployment.account &&
      manifest.region === deployment.region &&
      manifest.profile === deployment.profile &&
      isDeepStrictEqual(
        manifest.files.map((f: { name: string }) => f.name).sort(),
        [...deploymentSourceNames('demo')].sort(),
      ),
    'Foreign deployed source manifest',
  );
  for (const f of manifest.files as { name: string; sha256: string }[]) {
    const b = await bytes(
      context.path(`plan-preparation/${deployedRun}/work/${f.name}`),
    );
    proof(hash(b) === f.sha256, 'Deployed sources changed');
    await mkdir(resolve(work, f.name, '..'), { recursive: true, mode: 0o700 });
    await writeFile(resolve(work, f.name), b, { flag: 'wx', mode: 0o600 });
  }
  await writeFile(
    resolve(dir, 'activation.tfvars.json'),
    await bytes(resolve(source, 'activation.tfvars.json')),
    { flag: 'wx', mode: 0o600 },
  );
  const variables = await json(resolve(dir, 'activation.tfvars.json'));
  proof(
    variables.aws_account_id === deployment.account &&
      variables.aws_region === deployment.region &&
      variables.aws_profile === deployment.profile &&
      variables.hostname === deployment.domain,
    'Foreign activation input target',
  );
  const config = await json(context.path('runtime-inputs/configuration.json'));
  assertRuntimeInputConfiguration(config);
  const secrets = await json(context.path('runtime-inputs/secrets.json'));
  proof(
    secrets.version === 1 && isDeepStrictEqual(secrets.target, config.target),
    'Foreign secret target',
  );
  validateRuntimeSecrets(secrets.values, config);
  assertRuntimePlannerRole(
    aws('iam', 'get-role', ['--role-name', runtimePlannerRoleName]).Role,
  );
  proof(
    isDeepStrictEqual(
      aws('iam', 'get-role-policy', [
        '--role-name',
        runtimePlannerRoleName,
        '--policy-name',
        runtimePlannerPolicyName,
      ]).PolicyDocument,
      runtimeBackendPolicy(),
    ) &&
      isDeepStrictEqual(
        aws('iam', 'list-role-policies', [
          '--role-name',
          runtimePlannerRoleName,
        ]).PolicyNames,
        [runtimePlannerPolicyName],
      ) &&
      isDeepStrictEqual(
        aws('iam', 'list-attached-role-policies', [
          '--role-name',
          runtimePlannerRoleName,
        ]).AttachedPolicies,
        [],
      ),
    'Planning role policy drift',
  );
  proof(
    aws('s3api', 'get-bucket-versioning', [
      '--bucket',
      deployment.bucket,
      '--expected-bucket-owner',
      deployment.account,
    ]).Status === 'Enabled',
    'State versioning disabled',
  );
  noLock();
  const before = head(),
    inventory = versions();
  aws('s3api', 'get-object', [
    ...object('demo/terraform.tfstate'),
    '--version-id',
    before.versionId,
    resolve(dir, 'live.tfstate'),
  ]);
  aws('s3api', 'get-object', [
    ...object('demo/terraform.tfstate'),
    '--version-id',
    originalVersion.versionId,
    resolve(dir, 'original.tfstate'),
  ]);
  const live = (await json(resolve(dir, 'live.tfstate'))) as RecoveryState,
    original = (await json(resolve(dir, 'original.tfstate'))) as RecoveryState;
  validateRecoveryState(live, original);
  proof(
    isDeepStrictEqual(head(), before),
    'State changed during snapshot validation',
  );
  const backend = runtimePlanBackend(run);
  await save(resolve(dir, 'backend.json'), backend);
  await writeFile(
    resolve(dir, 'terraform.rc'),
    'provider_installation {\n direct {}\n}\n',
    { flag: 'wx', mode: 0o600 },
  );
  const tfEnv = {
    ...env,
    TF_DATA_DIR: data,
    TF_WORKSPACE: 'default',
    TF_IN_AUTOMATION: '1',
    TF_CLI_CONFIG_FILE: resolve(dir, 'terraform.rc'),
    CHECKPOINT_DISABLE: '1',
    TF_LOG_CORE: 'DEBUG',
    TF_LOG_PROVIDER: 'OFF',
    TF_VAR_secrets: JSON.stringify(secrets.values),
  };
  let summary: ReturnType<typeof validateRecoveryPlan> | undefined;
  const plan = resolve(dir, 'destroy.tfplan');
  await save(resolve(dir, 'attempt.json'), {
    run,
    stateVersion: before,
    serial: live.serial,
    startedAt: new Date().toISOString(),
    executionAuthorized: false,
  });
  try {
    const commands = [
      ['version', '-json'],
      ['fmt', '-check'],
      [
        'init',
        '-reconfigure',
        '-input=false',
        '-lockfile=readonly',
        `-backend-config=${resolve(dir, 'backend.json')}`,
      ],
      ['validate', '-no-color'],
      [
        'plan',
        '-destroy',
        '-input=false',
        '-no-color',
        '-lock-timeout=30s',
        `-var-file=${resolve(dir, 'activation.tfvars.json')}`,
        `-out=${plan}`,
      ],
      ['show', '-json', plan],
    ];
    for (const argv of commands) {
      proof(
        isDeepStrictEqual(head(), before),
        'Live state drift before Terraform command',
      );
      if (argv[0] === 'init' || argv[0] === 'plan')
        verifyDeploymentCaller(inherited);
      const r = spawnSync('terraform', argv, {
        cwd: work,
        env: tfEnv,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 64 * 1024 * 1024,
      });
      await save(resolve(dir, `${argv[0]}-result.json`), {
        status: r.status,
        error: !!r.error,
      });
      proof(
        !r.error && r.status === 0,
        `Recovery ${argv[0]} failed; raw output withheld, no retry`,
      );
      if (argv[0] === 'version')
        proof(
          JSON.parse(r.stdout).terraform_version === '1.15.3',
          'Only Terraform 1.15.3 reviewed',
        );
      if (argv[0] === 'init' || argv[0] === 'plan')
        inspectRuntimeBackendIdentity(r.stderr, run);
      if (argv[0] === 'plan') await chmod(plan, 0o600);
      if (argv[0] === 'show')
        summary = validateRecoveryPlan(JSON.parse(r.stdout), live);
    }
  } finally {
    const after = head();
    noLock();
    const finalInventory = versions();
    const payload = (v: typeof inventory) => ({
      versions: v.versions.filter(
        (x: { Key: string }) => x.Key === 'demo/terraform.tfstate',
      ),
      markers: v.markers.filter(
        (x: { Key: string }) => x.Key === 'demo/terraform.tfstate',
      ),
    });
    proof(
      isDeepStrictEqual(before, after) &&
        isDeepStrictEqual(payload(inventory), payload(finalInventory)),
      'Remote state/history changed: reject recovery review',
    );
    await save(resolve(dir, 'state-proof.json'), {
      before,
      after,
      inventory,
      finalInventory,
      statePayloadUnchanged: true,
    });
  }
  proof(summary, 'No validated destroy proposal');
  const names = [
    'live.tfstate',
    'original.tfstate',
    'backend.json',
    'activation.tfvars.json',
    'terraform.rc',
    ...manifest.files.map((f: { name: string }) => `work/${f.name}`),
  ];
  const files = await Promise.all(
    names.map(async (name: string) => ({
      name,
      sha256: hash(await bytes(resolve(dir, name))),
    })),
  );
  const receipt = {
    run,
    createdAt: new Date().toISOString(),
    sha256: hash(await bytes(plan)),
    stateVersion: before,
    lineage: live.lineage,
    serial: live.serial,
    summary,
    files,
    codeHash: await codeHash(),
    executionAuthorized: false,
  };
  await save(resolve(dir, 'review.json'), receipt);
  return {
    status: 'SAVED_RECOVERY_PLAN',
    ...summary,
    plan,
    sha256: receipt.sha256,
    reviewId: `${run}:${receipt.sha256}`,
    serial: live.serial,
    executionAuthorized: false,
  };
}
if (require.main === module)
  void recovery(resolve(__dirname, '..'), process.argv.slice(2))
    .then((v) => console.log(JSON.stringify(v, null, 2)))
    .catch(reportDeploymentFailure);
