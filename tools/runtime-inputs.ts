/** Local-only runtime preparation. Never invokes AWS, Stripe, PostgreSQL or Terraform. */
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import {
  deploymentContext,
  backendContract,
  DeploymentSafetyError,
} from './deployment-context';
import { deployment, assertDeploymentEnvironment } from './deployment-guards';
import { reportDeploymentFailure } from './deployment-preflight';
import { sandboxKey } from '@vigil/stripe-integration';
import {
  assembleDeploymentSources,
  verifyDeploymentAssembly,
} from './deployment-sources';

export const runtimeSecretKeys = [
  'admin_password',
  'provisioning',
  'stripe_key',
  'webhook_secrets',
  'demo_username',
  'demo_password',
  'operations_password',
  'ingress_password',
  'stripeworker_password',
] as const;
type SecretKey = (typeof runtimeSecretKeys)[number];
const capabilities = [
  'operations',
  'ingress',
  'stripeWorker',
  'ingestion',
  'processor',
  'bank',
  'reconciliation',
  'exceptions',
  'controls',
  'worker',
  'integrity',
];
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(
    v,
  )?.[0] === v;
function check(v: unknown, m: string): asserts v {
  if (!v) throw new DeploymentSafetyError(m);
}
const target = Object.freeze({
  account: deployment.account,
  profile: deployment.profile,
  region: deployment.region,
  role: deployment.role,
});
export function runtimeInputTemplate() {
  const registry = `${deployment.account}.dkr.ecr.${deployment.region}.amazonaws.com/flow-demo`;
  return {
    version: 1,
    target,
    variables: {
      aws_account_id: deployment.account,
      aws_profile: deployment.profile,
      aws_region: deployment.region,
      hostname: deployment.domain,
      stripe_account_id: 'acct_1UOVU2AoTLlql5uC',
      availability_zones: ['ap-southeast-2a', 'ap-southeast-2b'],
      images: {
        admin: `${registry}/admin@sha256:2c5730a3d9490c18bfe611fd38671140f9f18319f512e193f63ebb8a30dfe223`,
        ops: `${registry}/ops@sha256:06856e82365e186db47f2ed1c8906fca97e59194031d767eefad34e01e929ca9`,
        stripe: `${registry}/stripe@sha256:0c53fce38d2dad143ef243516b0a337ccf127d6ba59003902bbabd01108a2c8a`,
      },
      secrets_version: 1,
      stripe_source_id: null as string | null,
      ops_book_id: null as string | null,
      start_services: false,
      certificate_dns_confirmed: false,
    },
    bindings: { stripe_book_id: null as string | null },
    database: {
      identifier: 'flow-demo',
      address: null as string | null,
      name: 'flow',
      port: 5432,
      sslmode: 'verify-full',
      ca_bundle: 'container/rds-ca.pem',
    },
  };
}
type Configuration = ReturnType<typeof runtimeInputTemplate>;
export function assertRuntimeInputConfiguration(
  value: unknown,
): asserts value is Configuration {
  check(value && typeof value === 'object', 'Invalid local configuration');
  const v = value as Configuration;
  const expected = runtimeInputTemplate();
  check(
    v.variables && v.database && v.bindings,
    'Incomplete local configuration',
  );
  check(
    v.bindings.stripe_book_id === null || uuid(v.bindings.stripe_book_id),
    'Stripe book must be an actual UUID or explicitly missing',
  );
  expected.bindings.stripe_book_id = v.bindings.stripe_book_id;
  for (const key of ['stripe_source_id', 'ops_book_id'] as const) {
    check(
      v.variables[key] === null || uuid(v.variables[key]),
      'Binding IDs must be actual UUIDs or explicitly missing',
    );
    expected.variables[key] = v.variables[key];
  }
  check(
    v.database.address === null ||
      (typeof v.database.address === 'string' &&
        /^flow-demo\.[a-z0-9.-]+\.ap-southeast-2\.rds\.amazonaws\.com$/.exec(
          v.database.address,
        )?.[0] === v.database.address),
    'Only the expected Sydney RDS hostname is permitted',
  );
  expected.database.address = v.database.address;
  check(
    isDeepStrictEqual(value, expected),
    'Foreign target, changed images, activation flags or unexpected local configuration',
  );
}
export function validateRuntimeSecrets(
  values: unknown,
  config: Configuration,
): asserts values is Partial<Record<SecretKey, string>> {
  try {
    check(
      values && typeof values === 'object' && !Array.isArray(values),
      'Invalid private input map',
    );
    for (const [key, value] of Object.entries(values)) {
      check(
        runtimeSecretKeys.includes(key as SecretKey) &&
          typeof value === 'string' &&
          value.length <= 16384,
        'Unknown or invalid private input',
      );
      if (key === 'stripe_key') {
        sandboxKey(value);
        check(
          /^(sk|rk)_test_[A-Za-z0-9_]{16,}$/.exec(value)?.[0] === value,
          'Real sandbox API key required',
        );
      } else if (key === 'webhook_secrets')
        check(
          /^whsec_[A-Za-z0-9]{16,}(,whsec_[A-Za-z0-9]{16,})*$/.exec(
            value,
          )?.[0] === value,
          'Real webhook signing secrets required',
        );
      else if (key === 'demo_username')
        check(
          /^[A-Za-z0-9_-]{1,64}$/.exec(value)?.[0] === value,
          'Invalid operator username',
        );
      else if (key === 'provisioning') {
        const p = JSON.parse(value) as {
          bookId: string;
          accountId: string;
          passwords: Record<string, string>;
        };
        check(
          isDeepStrictEqual(Object.keys(p).sort(), [
            'accountId',
            'bookId',
            'passwords',
          ]) &&
            uuid(p.bookId) &&
            p.bookId === config.bindings.stripe_book_id &&
            p.accountId === config.variables.stripe_account_id,
          'Provisioning scope must match supplied book/account',
        );
        check(
          isDeepStrictEqual(
            Object.keys(p.passwords).sort(),
            [...capabilities].sort(),
          ) &&
            Object.values(p.passwords).every(
              (v) => /^[A-Za-z0-9_-]{40,100}$/.exec(v)?.[0] === v,
            ),
          'Strong exact capability password map required',
        );
        for (const [field, capability] of [
          ['operations_password', 'operations'],
          ['ingress_password', 'ingress'],
          ['stripeworker_password', 'stripeWorker'],
        ]) {
          const existing = (values as Record<string, string>)[field!];
          check(
            existing === undefined || existing === p.passwords[capability!],
            'Conflicting scoped passwords',
          );
        }
      } else
        check(
          /^[A-Za-z0-9_-]{40,100}$/.exec(value)?.[0] === value,
          'Strong fresh password required',
        );
    }
  } catch {
    throw new DeploymentSafetyError(
      'Private input validation failed; no value was saved or printed',
    );
  }
}

/** Only the RDS owner password is needed for the first, stopped infrastructure plan.
 * The return value contains a secret: never serialize it into artifacts or stdout.
 */
export function initialRuntimePlanInputs(
  config: Configuration,
  values: unknown,
) {
  assertRuntimeInputConfiguration(config);
  validateRuntimeSecrets(values, config);
  check(
    values.admin_password !== undefined,
    'Initial runtime plan requires admin_password; enter it using the hidden local prompt',
  );
  const variables = {
    aws_account_id: config.variables.aws_account_id,
    aws_profile: config.variables.aws_profile,
    aws_region: config.variables.aws_region,
    hostname: config.variables.hostname,
    stripe_account_id: config.variables.stripe_account_id,
    availability_zones: config.variables.availability_zones,
    images: config.variables.images,
    secrets_version: config.variables.secrets_version,
    start_services: false,
    certificate_dns_confirmed: false,
  };
  return {
    variables: {
      ...variables,
      initial_infrastructure_only: true,
      defer_webhook_secret: true,
      // Empty bindings use the existing disabled-service Terraform defaults.
      // No endpoint or invented financial identity is a Terraform input here.
    },
    ephemeralSecrets: { admin_password: values.admin_password },
  };
}
export function runtimePlanScope() {
  return {
    version: 1,
    target,
    authorization: 'NOT_GRANTED',
    workspace: 'default',
    backend: backendContract('demo'),
    stateReadOnly: `arn:aws:s3:::${deployment.bucket}/demo/terraform.tfstate`,
    proposedLockWrites: {
      resource: `arn:aws:s3:::${deployment.bucket}/demo/terraform.tfstate.tflock`,
      actions: ['s3:PutObject', 's3:DeleteObject'],
      condition:
        'Only conditional creation of this run lock and normal release of the same owned lock; existing locks stop execution',
    },
    readOnlyDiscovery: {
      bucket: deployment.bucket,
      prefixes: ['demo/', 'env:/'],
    },
    forbidden: [
      'state PutObject/DeleteObject',
      'bootstrap state access/migration',
      'non-default workspace',
      'force-unlock',
      '-lock=false',
      'apply',
      'destroy',
      'import',
    ],
    futureTerraformArgs: {
      init: ['init', '-reconfigure', '-input=false', '-lockfile=readonly'],
      plan: [
        'plan',
        '-input=false',
        '-lock-timeout=30s',
        '-out=<private target/run plan>',
      ],
    },
    executable: false,
  };
}

export function runtimeInputStore(repository: string) {
  const context = deploymentContext(repository, 'demo');
  const path = (n: string) => context.path(`runtime-inputs/${n}`);
  async function privatePath(file: string, directory = false) {
    const s = await lstat(file);
    check(
      s.uid === process.getuid?.() &&
        (s.mode & 0o777) === (directory ? 0o700 : 0o600) &&
        !s.isSymbolicLink() &&
        (directory ? s.isDirectory() : s.isFile() && s.nlink === 1),
      'Private owner-only unshared local path required',
    );
  }
  async function ensure() {
    await mkdir(context.base, { recursive: true, mode: 0o700 });
    await mkdir(path('.'), { recursive: true, mode: 0o700 });
    for (const d of [
      resolve(context.base, '../..'),
      resolve(context.base, '..'),
      context.base,
      path('.'),
    ])
      await privatePath(d, true);
  }
  async function read(n: string) {
    const file = path(n);
    await privatePath(file);
    const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return JSON.parse(await h.readFile('utf8')) as unknown;
    } catch {
      throw new DeploymentSafetyError(
        'Cannot read private input file; content omitted',
      );
    } finally {
      await h.close();
    }
  }
  async function configuration() {
    const v = await read('configuration.json');
    assertRuntimeInputConfiguration(v);
    return v;
  }
  async function secrets(config: Configuration) {
    let raw: unknown;
    try {
      raw = await read('secrets.json');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
    check(raw && typeof raw === 'object', 'Invalid private input file');
    const v = raw as { version: number; target: unknown; values: unknown };
    check(
      isDeepStrictEqual(Object.keys(v).sort(), [
        'target',
        'values',
        'version',
      ]) &&
        v.version === 1 &&
        isDeepStrictEqual(v.target, target),
      'Foreign private input file',
    );
    validateRuntimeSecrets(v.values, config);
    return v.values;
  }
  return {
    path,
    async init() {
      await ensure();
      await writeFile(
        path('configuration.json'),
        JSON.stringify(runtimeInputTemplate(), null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      await writeFile(
        path('backend-plan-scope.json'),
        JSON.stringify(runtimePlanScope(), null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      return { initialized: true, secretsCreated: false };
    },
    async set(key: string, value: string) {
      check(
        runtimeSecretKeys.includes(key as SecretKey),
        'Unsupported private input key',
      );
      await ensure();
      const config = await configuration();
      const existing = await secrets(config);
      const values = { ...existing, [key]: value };
      validateRuntimeSecrets(values, config);
      const file = path('secrets.json');
      try {
        await privatePath(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const temporary = path(`.secrets-${randomUUID()}.tmp`);
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, target, values }, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      context.path(`runtime-inputs/secrets.json`);
      await rename(temporary, file);
      return { storedKey: key, valuesPrinted: false };
    },
    async check() {
      await ensure();
      const config = await configuration();
      const values = await secrets(config);
      return {
        target,
        missingSecretKeys: runtimeSecretKeys.filter(
          (k) => values[k] === undefined,
        ),
        missingBeforeInitialPlanKeys:
          values.admin_password === undefined ? ['admin_password'] : [],
        deferredUntilProvisioning: [
          'provisioning',
          'operations_password',
          'ingress_password',
          'stripeworker_password',
        ],
        deferredUntilActivation: [
          'stripe_key',
          'demo_username',
          'demo_password',
        ],
        deferredUntilWebhookRegistration: ['webhook_secrets'],
        missingBindings: ['ops_book_id', 'stripe_source_id'].filter(
          (k) =>
            config.variables[k as 'ops_book_id' | 'stripe_source_id'] === null,
        ),
        stripeBookMissing: config.bindings.stripe_book_id === null,
        databaseAddressMissing: config.database.address === null,
        bindingsVerified: false,
        credentialAccountVerified: false,
        dnsConfirmed: false,
        backendWritesAuthorized: false,
        planExecutable: false,
        reason:
          'Initial infrastructure plan requires only admin_password; endpoint/binding/DNS proof is required later for activation. Backend lock authorization and its bounded executor remain missing',
      };
    },
    async preparePlan() {
      await ensure();
      const config = await configuration();
      const values = await secrets(config);
      const inputs = initialRuntimePlanInputs(config, values);
      // No credentials are copied: the future child must reload and validate the
      // ephemeral input privately at execution time, including saved-plan apply.
      const assembly = await assembleDeploymentSources(
        repository,
        'demo',
        randomUUID(),
        'runtime-plan-preparation',
      );
      await verifyDeploymentAssembly(assembly);
      const variableFile = assembly.context.path(
        `${assembly.prefix}/initial.tfvars.json`,
      );
      await writeFile(
        variableFile,
        JSON.stringify(inputs.variables, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      await writeFile(
        assembly.context.path(`${assembly.prefix}/plan-readiness.json`),
        JSON.stringify(
          {
            version: 1,
            target,
            sourceManifest: assembly.manifest,
            variableFile,
            stage: 'initial-infrastructure-only',
            ephemeralKeys: ['admin_password'],
            backend: runtimePlanScope(),
            terraformRun: false,
            savedPlanCreated: false,
            authorization: 'NOT_GRANTED',
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      return {
        prepared: true,
        sourceManifest: assembly.manifest,
        variableFile,
        secretsCopied: false,
        terraformRun: false,
        savedPlanCreated: false,
        backendWritesAuthorized: false,
      };
    },
  };
}
async function hiddenInput(): Promise<string> {
  check(
    process.stdin.isTTY && process.stdout.isTTY,
    'Hidden local entry requires an interactive terminal; no secret arguments or redirected input',
  );
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  process.stdout.write('Enter private value (hidden; one line), then Enter: ');
  try {
    return await new Promise<string>((resolve, reject) => {
      let ended = false;
      rl.on('SIGINT', () => {
        ended = true;
        reject(new DeploymentSafetyError('Private entry cancelled'));
        rl.close();
      });
      rl.on('close', () => {
        if (!ended) reject(new DeploymentSafetyError('Private entry closed'));
      });
      rl.question('', (value) => {
        ended = true;
        resolve(value);
      });
    });
  } finally {
    rl.close();
    process.stdout.write('\n');
  }
}
async function main() {
  assertDeploymentEnvironment(process.env);
  const [command, key, ...extra] = process.argv.slice(2);
  check(
    !extra.length &&
      ((command === 'set' && runtimeSecretKeys.includes(key as SecretKey)) ||
        (['init', 'check', 'prepare-plan', 'plan-scope', 'plan'].includes(
          command ?? '',
        ) &&
          key === undefined)),
    'Use init, check, prepare-plan, plan-scope or set <approved-key>; never pass secret values or overrides',
  );
  check(
    command !== 'plan',
    'Runtime plan execution remains disabled; explicit lock-operation authorization and a verified bounded executor are required. No Terraform was run',
  );
  const repository = resolve(__dirname, '..');
  const store = runtimeInputStore(repository);
  for (const name of [
    'configuration.json',
    'secrets.json',
    'backend-plan-scope.json',
  ]) {
    const ignored = spawnSync(
      'git',
      ['check-ignore', '--quiet', store.path(name)],
      { cwd: repository },
    );
    check(
      ignored.status === 0,
      'Every runtime input must be Git-ignored and untracked',
    );
  }
  process.umask(0o077);
  const result =
    command === 'init'
      ? await store.init()
      : command === 'check'
        ? await store.check()
        : command === 'prepare-plan'
          ? await store.preparePlan()
          : command === 'plan-scope'
            ? runtimePlanScope()
            : await store.set(key!, await hiddenInput());
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) void main().catch(reportDeploymentFailure);
