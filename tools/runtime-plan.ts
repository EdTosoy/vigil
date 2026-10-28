/** D3E: one initial S3-backed plan; never apply, import, unlock, migrate or destroy. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, readFile, readdir, writeFile, chmod } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  deploymentContext,
  backendContract,
  DeploymentSafetyError,
} from './deployment-context';
import {
  deployment,
  assertDeploymentEnvironment,
  assertDemoPlan,
  type BootstrapPlan,
} from './deployment-guards';
import { verifyDeploymentCaller } from './deployment-preflight';
import {
  deploymentSourceNames,
  verifyDeploymentAssembly,
  type DeploymentAssembly,
} from './deployment-sources';
import { runtimeInputStore } from './runtime-inputs';

const hash = (v: string | Uint8Array) =>
  createHash('sha256').update(v).digest('hex');
interface ObjectVersion {
  Key: string;
  VersionId: string;
  [field: string]: unknown;
}
function proof(v: unknown, message: string): asserts v {
  if (!v) throw new DeploymentSafetyError(message);
}
const bucketArn = `arn:aws:s3:::${deployment.bucket}`;
export const runtimeStateKey = 'demo/terraform.tfstate';
export const runtimeLockKey = runtimeStateKey + '.tflock';
// IAM GetRole confirmed this path. STS assumed-role ARNs omit IAM role paths.
export const runtimeCallerRoleArn = `arn:aws:iam::${deployment.account}:role/managed/${deployment.role}`;

export function assertRuntimeSelfTrust(role: {
  Arn?: string;
  AssumeRolePolicyDocument?: {
    Statement?: {
      Effect?: string;
      Principal?: { AWS?: string | string[]; Service?: string | string[] };
      Action?: string | string[];
    }[];
  };
}) {
  proof(
    role.Arn === runtimeCallerRoleArn,
    'Unexpected IAM role ARN; never derive role paths from an STS ARN',
  );
  const list = (v: string | string[] | undefined) =>
    typeof v === 'string' ? [v] : (v ?? []);
  proof(
    role.AssumeRolePolicyDocument?.Statement?.some(
      (s) =>
        s.Effect === 'Allow' &&
        list(s.Principal?.AWS).includes(runtimeCallerRoleArn) &&
        list(s.Action).includes('sts:AssumeRole'),
    ),
    'Browser-managed AccountFullAccessRole does not explicitly trust self-assumption; separately review the proposed backend-only planning role. No trust change or AssumeRole retry was performed',
  );
}

/** No persistent IAM change. Explicit denies also defeat resource-policy grants. */
export function runtimeBackendPolicy() {
  const reads = [
    's3:ListBucket',
    's3:GetBucketLocation',
    's3:GetObject',
    'sts:GetCallerIdentity',
  ];
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket', 's3:GetBucketLocation'],
        Resource: bucketArn,
      },
      {
        Effect: 'Allow',
        Action: 's3:GetObject',
        Resource: [
          `${bucketArn}/${runtimeStateKey}`,
          `${bucketArn}/${runtimeLockKey}`,
        ],
      },
      { Effect: 'Allow', Action: 'sts:GetCallerIdentity', Resource: '*' },
      {
        Effect: 'Allow',
        Action: 's3:PutObject',
        Resource: `${bucketArn}/${runtimeLockKey}`,
        Condition: { StringEquals: { 's3:if-none-match': '*' } },
      },
      {
        Effect: 'Allow',
        Action: 's3:DeleteObject',
        Resource: `${bucketArn}/${runtimeLockKey}`,
      },
      {
        Effect: 'Deny',
        NotAction: [...reads, 's3:PutObject', 's3:DeleteObject'],
        Resource: '*',
      },
      {
        Effect: 'Deny',
        Action: ['s3:PutObject', 's3:DeleteObject'],
        NotResource: `${bucketArn}/${runtimeLockKey}`,
      },
      {
        Effect: 'Deny',
        Action: 's3:PutObject',
        Resource: `${bucketArn}/${runtimeLockKey}`,
        Condition: { StringNotEquals: { 's3:if-none-match': '*' } },
      },
    ],
  };
}
export function runtimePlanBackend(run: string) {
  proof(/^[a-f0-9-]{36}$/.test(run), 'Invalid runtime plan run identity');
  return {
    ...backendContract('demo'),
    assume_role: {
      role_arn: runtimeCallerRoleArn,
      session_name: `vigil-d3e-${run}`,
      duration: '15m',
      policy: JSON.stringify(runtimeBackendPolicy()),
    },
  };
}
export function assertRuntimePlanBackend(v: unknown, run: string) {
  proof(
    isDeepStrictEqual(v, runtimePlanBackend(run)),
    'Unauthorized backend, account, role, key or session policy',
  );
}

export type RuntimePlanOperation =
  'version' | 'fmt' | 'init' | 'validate' | 'plan' | 'show';
export function runtimeTerraformArgs(
  operation: RuntimePlanOperation,
  paths: { backend: string; variables: string; plan: string },
) {
  const commands = {
    version: ['version', '-json'],
    fmt: ['fmt', '-check', '-recursive'],
    init: [
      'init',
      '-reconfigure',
      '-input=false',
      '-lockfile=readonly',
      `-backend-config=${paths.backend}`,
    ],
    validate: ['validate', '-no-color'],
    plan: [
      'plan',
      '-input=false',
      '-no-color',
      '-lock-timeout=30s',
      `-var-file=${paths.variables}`,
      `-out=${paths.plan}`,
    ],
    show: ['show', '-json', paths.plan],
  };
  proof(
    Object.hasOwn(commands, operation),
    'Only fixed initial-runtime plan commands are authorized',
  );
  return commands[operation];
}

const workloads = ['ops', 'ingress', 'worker', 'admin', 'verify'];
export function initialRuntimeAddresses() {
  const names = [
    'aws_vpc.demo',
    'aws_internet_gateway.demo',
    'aws_route_table.public',
    'aws_route_table.database',
    'aws_route.internet',
    'aws_security_group.alb',
    'aws_security_group.database',
    'aws_vpc_security_group_ingress_rule.http',
    'aws_vpc_security_group_ingress_rule.https',
    'aws_db_subnet_group.demo',
    'aws_db_parameter_group.demo',
    'aws_db_instance.demo',
    'aws_ecs_cluster.demo',
    'aws_acm_certificate.demo',
    'aws_lb.demo',
    'aws_ssm_parameter.runtime["admin_url"]',
  ];
  for (const kind of ['public', 'database'])
    for (const i of [0, 1])
      for (const type of ['aws_subnet', 'aws_route_table_association'])
        names.push(`${type}.${kind}[${i}]`);
  for (const key of ['ops', 'ingress'])
    for (const root of [
      'aws_vpc_security_group_ingress_rule.app',
      'aws_vpc_security_group_egress_rule.alb_app',
      'aws_lb_target_group.app',
    ])
      names.push(`${root}["${key}"]`);
  for (const key of workloads)
    for (const root of [
      'aws_security_group.task',
      'aws_vpc_security_group_ingress_rule.postgres',
      'aws_vpc_security_group_egress_rule.task_database',
      'aws_vpc_security_group_egress_rule.task_https',
      'aws_cloudwatch_log_group.app',
      'aws_iam_role.execution',
      'aws_iam_role.task',
      'aws_iam_role_policy.execution',
      'aws_ecs_task_definition.app',
    ])
      names.push(`${root}["${key}"]`);
  return names.sort();
}
export function inspectInitialRuntimePlan(
  plan: BootstrapPlan & { variables?: Record<string, { value: unknown }> },
  variables: Record<string, unknown>,
) {
  assertDemoPlan(plan);
  const changes = plan.resource_changes!;
  proof(
    isDeepStrictEqual(
      changes.map((r) => r.address).sort(),
      initialRuntimeAddresses(),
    ),
    'Unexpected initial runtime resource inventory',
  );
  proof(
    changes.every(
      (r) =>
        r.mode === 'managed' &&
        r.address.startsWith(r.type + '.') &&
        isDeepStrictEqual(r.change.actions, ['create']),
    ),
    'Initial runtime plan must contain creates only',
  );
  for (const [key, value] of Object.entries(variables))
    proof(
      isDeepStrictEqual(plan.variables?.[key]?.value, value),
      'Saved plan variables differ from private preparation',
    );
  proof(
    !Object.hasOwn(plan.variables ?? {}, 'secrets'),
    'Ephemeral secrets unexpectedly persisted in plan variables',
  );
  proof(
    plan.variables?.['stripe_source_id']?.value === '' &&
      plan.variables?.['ops_book_id']?.value === '',
    'Initial infrastructure must not claim financial bindings',
  );
  const images = variables['images'] as Record<string, string>;
  for (const r of changes) {
    const a = r.change.after!;
    if (r.type === 'aws_ecs_task_definition') {
      const kind = workloads.find(
        (k) => r.address === `aws_ecs_task_definition.app["${k}"]`,
      )!;
      proof(
        typeof a['container_definitions'] === 'string',
        'Missing planned container configuration',
      );
      const containers = JSON.parse(a['container_definitions']);
      const c = containers[0];
      const platform = (
        a['runtime_platform'] as {
          cpu_architecture: string;
          operating_system_family: string;
        }[]
      )[0];
      proof(
        containers.length === 1 &&
          c.name === kind &&
          c.image ===
            images[
              kind === 'ingress' || kind === 'worker'
                ? 'stripe'
                : kind === 'verify'
                  ? 'admin'
                  : kind
            ] &&
          c.user === '1000:1000' &&
          platform?.cpu_architecture === 'X86_64' &&
          platform.operating_system_family === 'LINUX',
        'Unexpected container identity, digest, user or architecture',
      );
      proof(
        a['cpu'] === '256' &&
          a['memory'] === (kind === 'ops' || kind === 'admin' ? '1024' : '512'),
        'Unexpected task sizing',
      );
      proof(
        c.secrets?.length &&
          c.secrets.every((s: { valueFrom: string }) =>
            s.valueFrom.startsWith(
              `arn:aws:ssm:${deployment.region}:${deployment.account}:parameter/flow/demo/`,
            ),
          ),
        'Unexpected task secret reference',
      );
    }
    if (r.type === 'aws_db_instance')
      proof(
        a['engine'] === 'postgres' &&
          a['engine_version'] === '18.6' &&
          a['allocated_storage'] === 20 &&
          a['storage_type'] === 'gp3' &&
          a['ca_cert_identifier'] === 'rds-ca-rsa2048-g1',
        'Unexpected database size, engine or TLS trust',
      );
    if (r.type === 'aws_db_parameter_group')
      proof(
        (a['parameter'] as { name: string; value: string }[])?.some(
          (p) => p.name === 'rds.force_ssl' && p.value === '1',
        ),
        'Database must require TLS',
      );
    if (r.type === 'aws_ssm_parameter')
      proof(
        a['name'] === '/flow/demo/admin_url' && a['value_wo_version'] === 1,
        'Unexpected initial secret parameter',
      );
    if (r.type === 'aws_iam_role') {
      const trust = JSON.parse(String(a['assume_role_policy']));
      proof(
        trust.Statement?.length === 1 &&
          trust.Statement[0].Principal?.Service === 'ecs-tasks.amazonaws.com' &&
          trust.Statement[0].Action === 'sts:AssumeRole' &&
          trust.Statement[0].Condition?.StringEquals?.['aws:SourceAccount'] ===
            deployment.account &&
          trust.Statement[0].Condition?.ArnLike?.['aws:SourceArn'] ===
            `arn:aws:ecs:${deployment.region}:${deployment.account}:*`,
        'Unexpected ECS role trust',
      );
    }
    if (r.type === 'aws_subnet')
      proof(
        (variables['availability_zones'] as string[]).includes(
          String(a['availability_zone']),
        ),
        'Unexpected subnet region/zone',
      );
    if (r.type === 'aws_acm_certificate')
      proof(
        a['domain_name'] === deployment.domain &&
          a['validation_method'] === 'DNS',
        'Unexpected certificate/domain',
      );
    if (r.type === 'aws_lb')
      proof(
        a['internal'] === false &&
          a['load_balancer_type'] === 'application' &&
          a['enable_deletion_protection'] === false,
        'Unexpected load balancer configuration',
      );
  }
  const counts: Record<string, number> = {};
  for (const r of changes) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return {
    creates: changes.length,
    updates: 0,
    replacements: 0,
    deletes: 0,
    resourceTypes: counts,
  };
}

async function privateFile(path: string) {
  const s = await lstat(path);
  proof(
    s.isFile() &&
      !s.isSymbolicLink() &&
      s.nlink === 1 &&
      s.uid === process.getuid?.() &&
      (s.mode & 0o777) === 0o600,
    'Private unshared owner-only artifact required',
  );
  return readFile(path);
}

export async function loadPreparedRuntime(repository: string) {
  const context = deploymentContext(repository, 'demo');
  const roots = await readdir(context.path('plan-preparation'));
  const fresh: string[] = [];
  for (const run of roots) {
    proof(/^[a-f0-9-]{36}$/.test(run), 'Unexpected runtime preparation entry');
    try {
      await lstat(context.path(`plan-preparation/${run}/plan-execution.json`));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        fresh.push(run);
        continue;
      }
      throw e;
    }
  }
  proof(
    fresh.length === 1,
    'Exactly one unclaimed runtime preparation is required; no stale-plan reuse',
  );
  const run = fresh[0]!;
  const prefix = `plan-preparation/${run}`;
  proof(
    isDeepStrictEqual(
      (await readdir(context.path(prefix))).sort(),
      [
        'source-manifest.json',
        'initial.tfvars.json',
        'plan-readiness.json',
        'work',
        'terraform-data',
      ].sort(),
    ),
    'Unexpected or stale runtime preparation artifacts',
  );
  const manifest = context.path(`${prefix}/source-manifest.json`);
  const receipt = JSON.parse(
    (await privateFile(manifest)).toString(),
  ) as DeploymentAssembly['receipt'];
  proof(
    Array.isArray(receipt.files) &&
      isDeepStrictEqual(
        receipt.files.map((f) => f.name).sort(),
        [...deploymentSourceNames('demo')].sort(),
      ),
    'Unexpected source manifest paths',
  );
  const assembly: DeploymentAssembly = {
    context,
    prefix,
    work: context.path(`${prefix}/work`),
    data: context.path(`${prefix}/terraform-data`),
    manifest,
    receipt,
    mode: 'runtime-plan-preparation',
  };
  await verifyDeploymentAssembly(assembly);
  for (const directory of [
    context.base,
    context.path('plan-preparation'),
    context.path(prefix),
    assembly.work,
    assembly.data,
  ]) {
    const s = await lstat(directory);
    proof(
      s.isDirectory() &&
        s.uid === process.getuid?.() &&
        (s.mode & 0o777) === 0o700,
      'Private runtime directories required',
    );
  }
  proof(
    (await readdir(assembly.data)).length === 0,
    'Existing runtime backend metadata refused',
  );
  const inputs = await runtimeInputStore(repository).loadInitialPlanInputs();
  const variables = context.path(`${prefix}/initial.tfvars.json`);
  proof(
    isDeepStrictEqual(
      JSON.parse((await privateFile(variables)).toString()),
      inputs.variables,
    ),
    'Stale or foreign initial plan inputs',
  );
  const ready = JSON.parse(
    (
      await privateFile(context.path(`${prefix}/plan-readiness.json`))
    ).toString(),
  );
  proof(
    ready.sourceManifest === manifest &&
      ready.variableFile === variables &&
      ready.savedPlanCreated === false &&
      ready.terraformRun === false,
    'Invalid initial plan preparation',
  );
  return {
    assembly,
    inputs,
    run,
    paths: {
      variables,
      backend: context.path(`${prefix}/plan-backend.tfbackend.json`),
      plan: context.path(`${prefix}/runtime.tfplan`),
    },
  };
}

/** Returns a sanitized summary only. Never prints credentials, raw AWS errors or plan JSON. */
export async function prepareSavedRuntimePlan(
  repository: string,
  env = process.env,
) {
  assertDeploymentEnvironment(env);
  process.umask(0o077);
  const calls: { action: string; readOnly: boolean; success: boolean }[] = [];
  const awsEnv = {
    ...env,
    AWS_DEFAULT_REGION: deployment.region,
    AWS_PAGER: '',
    AWS_CLI_AUTO_PROMPT: 'off',
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
    AWS_EC2_METADATA_DISABLED: 'true',
  };
  function identity() {
    verifyDeploymentCaller(env, (args, e) => {
      const r = spawnSync('aws', args, {
        env: e,
        encoding: 'utf8',
        timeout: 25000,
      });
      calls.push({
        action: 'sts:GetCallerIdentity',
        readOnly: true,
        success: r.status === 0 && !r.error,
      });
      proof(
        !r.error && r.status === 0,
        'STS failed; manual browser login for edtosoy required',
      );
      return r.stdout;
    });
  }
  identity();
  const git = (args: string[]) => {
    const r = spawnSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      timeout: 15000,
    });
    proof(!r.error && r.status === 0, 'Git source/privacy verification failed');
    return r.stdout;
  };
  const privateContext = deploymentContext(repository, 'demo');
  for (const name of [
    'runtime-inputs/secrets.json',
    'runtime-inputs/configuration.json',
    'plan-preparation/.privacy-guard',
  ])
    git(['check-ignore', '--quiet', '--', privateContext.path(name)]);
  const { assembly, inputs, run, paths } =
    await loadPreparedRuntime(repository);
  const sourceRevision = git(['rev-parse', 'HEAD']).trim();
  for (const file of assembly.receipt.files)
    proof(
      hash(git(['show', `HEAD:infra/demo/${file.name}`])) === file.sha256,
      'Prepared infrastructure differs from committed sources',
    );
  for (const path of [paths.backend, paths.plan, paths.variables])
    git(['check-ignore', '--quiet', '--', path]);
  const { context, prefix } = assembly;
  const out = (name: string, v: unknown) =>
    writeFile(
      context.path(`${prefix}/${name}`),
      JSON.stringify(v, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
  const backend = runtimePlanBackend(run);
  assertRuntimePlanBackend(backend, run);
  const secret = inputs.ephemeralSecrets.admin_password;
  const inputHash = hash(JSON.stringify(inputs)); // Private commitment; values never persisted.
  async function unchanged() {
    proof(
      git(['rev-parse', 'HEAD']).trim() === sourceRevision,
      'Source revision changed; saved plan invalidated',
    );
    await verifyDeploymentAssembly(assembly);
    proof(
      hash(
        JSON.stringify(
          await runtimeInputStore(repository).loadInitialPlanInputs(),
        ),
      ) === inputHash,
      'Runtime inputs changed; saved plan invalidated',
    );
    proof(
      isDeepStrictEqual(
        JSON.parse((await privateFile(paths.variables)).toString()),
        inputs.variables,
      ),
      'Prepared variables changed',
    );
  }
  function aws(action: string, args: string[], absent = false) {
    const r = spawnSync(
      'aws',
      [
        ...args,
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
      {
        env: awsEnv,
        encoding: 'utf8',
        timeout: 25000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    calls.push({ action, readOnly: true, success: !r.error && r.status === 0 });
    if (
      absent &&
      !r.error &&
      r.status !== 0 &&
      /\(404\)|\(NotFound\)|\(NoSuchKey\)/.test(r.stderr)
    )
      return null;
    proof(
      !r.error && r.status === 0,
      `Read-only ${action} failed; stop without expanding permissions`,
    );
    return r.stdout.trim() ? JSON.parse(r.stdout) : {};
  }
  function versions() {
    const v = aws('s3:ListObjectVersions', [
      's3api',
      'list-object-versions',
      '--bucket',
      deployment.bucket,
      '--prefix',
      'demo/',
      '--max-keys',
      '100',
      '--no-paginate',
      '--expected-bucket-owner',
      deployment.account,
    ]);
    proof(!v.IsTruncated, 'Runtime version inventory is truncated');
    return {
      versions: (v.Versions ?? []) as ObjectVersion[],
      markers: (v.DeleteMarkers ?? []) as ObjectVersion[],
    };
  }
  function absentObjects() {
    for (const key of [runtimeStateKey, runtimeLockKey])
      proof(
        aws(
          's3:HeadObject',
          [
            's3api',
            'head-object',
            '--bucket',
            deployment.bucket,
            '--key',
            key,
            '--expected-bucket-owner',
            deployment.account,
          ],
          true,
        ) === null,
        'Unexpected runtime state or lock exists; no write permitted',
      );
  }
  const stateFiles = [
    'work/terraform.tfstate',
    'state-custody-backup.tfstate',
  ].map((n) =>
    deploymentContext(repository, 'bootstrap').path(
      `plans/7672de2b-8c20-4488-b356-68075ce9b0d5/${n}`,
    ),
  );
  async function custody() {
    return Promise.all(
      stateFiles.map(async (p) => {
        const bytes = await privateFile(p);
        const s = await lstat(p);
        proof(
          hash(bytes) ===
            '83a22793b582723d0849a1840a7236e4dd2c6d1aefdf7a332e4cca32ce956235',
          'Bootstrap custody hash changed',
        );
        return { path: p, hash: hash(bytes), mtime: s.mtimeMs, size: s.size };
      }),
    );
  }
  const stateBefore = await custody();
  const actualRole = aws('iam:GetRole', [
    'iam',
    'get-role',
    '--role-name',
    deployment.role,
  ]);
  assertRuntimeSelfTrust(actualRole.Role ?? {});
  aws('s3:HeadBucket', [
    's3api',
    'head-bucket',
    '--bucket',
    deployment.bucket,
    '--expected-bucket-owner',
    deployment.account,
  ]);
  proof(
    aws('s3:GetBucketLocation', [
      's3api',
      'get-bucket-location',
      '--bucket',
      deployment.bucket,
      '--expected-bucket-owner',
      deployment.account,
    ]).LocationConstraint === deployment.region,
    'Wrong backend bucket region',
  );
  absentObjects();
  const before = versions();
  proof(
    [...before.versions, ...before.markers].every(
      (v) => v.Key !== runtimeStateKey,
    ),
    'Historical runtime state versions exist; stop',
  );
  for (const [name, uri] of Object.entries(inputs.variables.images)) {
    const digest = uri.split('@')[1]!;
    const images = aws('ecr:BatchGetImage', [
      'ecr',
      'batch-get-image',
      '--registry-id',
      deployment.account,
      '--repository-name',
      `flow-demo/${name}`,
      '--image-ids',
      `imageDigest=${digest}`,
    ]);
    proof(
      !images.failures?.length &&
        images.images?.length === 1 &&
        images.images[0].imageId.imageDigest === digest &&
        `sha256:${hash(images.images[0].imageManifest)}` === digest,
      'Published immutable ECR image missing or mismatched',
    );
  }
  // Claim before Terraform. Failures are retained; never retry this preparation.
  await out('plan-execution.json', {
    version: 1,
    authorization: 'D3E_EXACT_OWNED_LOCK_ONLY',
    account: deployment.account,
    region: deployment.region,
    run,
    lockKey: runtimeLockKey,
    stateWrites: false,
    startedAt: new Date().toISOString(),
  });
  await out('plan-backend.tfbackend.json', backend);
  await writeFile(
    context.path(`${prefix}/terraform.rc`),
    'provider_installation {\n direct {}\n}\n',
    { mode: 0o600, flag: 'wx' },
  );
  const tfEnv = {
    ...awsEnv,
    TF_WORKSPACE: 'default',
    TF_DATA_DIR: assembly.data,
    TF_CLI_CONFIG_FILE: context.path(`${prefix}/terraform.rc`),
    TF_IN_AUTOMATION: '1',
    CHECKPOINT_DISABLE: '1',
  };
  let summary: ReturnType<typeof inspectInitialRuntimePlan> | undefined;
  let failure: unknown;
  try {
    for (const operation of [
      'version',
      'fmt',
      'init',
      'validate',
      'plan',
      'show',
    ] as const) {
      await unchanged();
      assertRuntimePlanBackend(
        JSON.parse((await privateFile(paths.backend)).toString()),
        run,
      );
      if (operation === 'init' || operation === 'plan') {
        identity();
        absentObjects();
      }
      const args = runtimeTerraformArgs(operation, paths);
      const r = spawnSync('terraform', args, {
        cwd: assembly.work,
        env:
          operation === 'plan'
            ? {
                ...tfEnv,
                TF_VAR_secrets: JSON.stringify(inputs.ephemeralSecrets),
              }
            : tfEnv,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 32 * 1024 * 1024,
      });
      // Raw diagnostics may contain private provider values. Retain only bounded codes.
      await out(`${operation}-result.json`, {
        args,
        status: r.status,
        error: !!r.error,
        diagnostics: [
          'AccessDenied',
          'AssumeRole',
          'Cannot assume IAM Role',
          'failed to upload state',
          'Error acquiring the state lock',
        ].filter((s) => (r.stderr + r.stdout).includes(s)),
      });
      proof(
        !r.error && r.status === 0,
        `Runtime ${operation} blocked or failed; inspect sanitized private result. No retry or permission expansion`,
      );
      if (operation === 'version')
        proof(
          JSON.parse(r.stdout).terraform_version === '1.15.3',
          'Only reviewed Terraform 1.15.3 is authorized',
        );
      if (operation === 'init') {
        const local = JSON.parse(
          (
            await privateFile(
              context.path(`${prefix}/terraform-data/terraform.tfstate`),
            )
          ).toString(),
        );
        const config = local.backend?.config;
        proof(
          local.backend?.type === 's3' &&
            config?.bucket === backend.bucket &&
            config.key === backend.key &&
            config.profile === backend.profile &&
            config.region === backend.region &&
            config.use_lockfile === true &&
            config.encrypt === true &&
            isDeepStrictEqual(
              config.allowed_account_ids,
              backend.allowed_account_ids,
            ),
          'Unexpected initialized backend metadata',
        );
        const assumed = Array.isArray(config.assume_role)
          ? config.assume_role[0]
          : config.assume_role;
        proof(
          assumed?.role_arn === backend.assume_role.role_arn &&
            assumed.policy === backend.assume_role.policy,
          'Restricted backend session policy missing',
        );
        proof(!local.resources?.length, 'Unexpected local managed state');
      }
      if (operation === 'plan') {
        await chmod(paths.plan, 0o600);
        await privateFile(paths.plan);
      }
      if (operation === 'show') {
        proof(
          !r.stdout.includes(secret) &&
            !r.stdout.includes(encodeURIComponent(secret)),
          'Private value leaked into saved plan; stop',
        );
        summary = inspectInitialRuntimePlan(
          JSON.parse(r.stdout),
          inputs.variables,
        );
      }
    }
  } catch (e) {
    failure = e;
  }
  // Read-only postcheck runs even on Terraform failure; never manually unlock.
  absentObjects();
  const after = versions();
  proof(
    isDeepStrictEqual(
      after.versions.filter((v) => v.Key === runtimeStateKey),
      before.versions.filter((v) => v.Key === runtimeStateKey),
    ) &&
      isDeepStrictEqual(
        after.markers.filter((v) => v.Key === runtimeStateKey),
        before.markers.filter((v) => v.Key === runtimeStateKey),
      ),
    'Unauthorized runtime state payload version change',
  );
  const old = new Set(
    [...before.versions, ...before.markers].map((v) => v.VersionId),
  );
  const mutations = [
    ...after.versions.map((v) => ({ ...v, action: 's3:PutObject' })),
    ...after.markers.map((v) => ({ ...v, action: 's3:DeleteObject' })),
  ].filter((v) => !old.has(v.VersionId));
  proof(
    mutations.every((v) => v.Key === runtimeLockKey),
    'Unexpected S3 object mutation',
  );
  proof(
    isDeepStrictEqual(await custody(), stateBefore),
    'Bootstrap state/recovery changed',
  );
  await out('aws-evidence.json', {
    calls,
    before,
    after,
    mutations,
    stateUnchanged: true,
    bootstrapUnchanged: true,
  });
  if (failure) throw failure;
  await unchanged();
  proof(summary, 'No valid saved runtime plan');
  proof(
    mutations.length === 2 &&
      mutations.filter((v) => v.action === 's3:PutObject').length === 1 &&
      mutations.filter((v) => v.action === 's3:DeleteObject').length === 1,
    'Expected exactly one conditional native lock creation and owned release',
  );
  const result = {
    status: 'SUCCESS',
    run,
    sourceManifest: assembly.manifest,
    sourceRevision,
    sourceHash: hash(await privateFile(assembly.manifest)),
    privateInputCommitment: inputHash,
    plan: paths.plan,
    sha256: hash(await privateFile(paths.plan)),
    ...summary,
    stateWrites: false,
    lockMutations: mutations.map((v) => ({
      key: v.Key,
      action: v.action,
      versionId: v.VersionId,
    })),
    runtimeApplyAuthorized: false,
  };
  await out('saved-plan-review.json', result);
  return result;
}
