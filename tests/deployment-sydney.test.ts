import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  deployment,
  assertDeploymentEnvironment,
  assertDeploymentIdentity,
} from '../tools/deployment-guards';
import {
  deploymentContext,
  backendContract,
  assertBackendConfiguration,
  prepareBackendContract,
  readBackendConfiguration,
  planReceipt,
  assertPlanReceipt,
  verifySavedPlan,
  type PlanBinding,
} from '../tools/deployment-context';
import { verifyDeploymentCaller } from '../tools/deployment-preflight';

const env = { AWS_PROFILE: 'edtosoy', AWS_REGION: 'ap-southeast-2' };
const identity = (session = 'browser-session-1') => ({
  Account: deployment.account,
  Arn: `arn:aws:sts::${deployment.account}:assumed-role/AccountFullAccessRole/${session}`,
  UserId: `AROAFIXTURE:${session}`,
});
const binding: PlanBinding = {
  sourceHash: 'a'.repeat(64),
  inputHash: 'b'.repeat(64),
  stateIdentity: 'new-sydney-lineage:serial-1',
  intent: 'apply',
};
const repository = resolve(__dirname, '..');

test('STS accepts exact Sydney role across rotating browser session names using explicit selectors', () => {
  for (const session of ['browser-session-1', 'rotated.user+tag@example.com']) {
    let calls = 0;
    verifyDeploymentCaller(env, (args, selected) => {
      calls++;
      assert.deepEqual(args.slice(0, 6), [
        'sts',
        'get-caller-identity',
        '--profile',
        'edtosoy',
        '--region',
        'ap-southeast-2',
      ]);
      assert.equal(selected['AWS_IGNORE_CONFIGURED_ENDPOINT_URLS'], 'true');
      return JSON.stringify(identity(session));
    });
    assert.equal(calls, 1);
  }
});

test('foreign, root, IAM user, spoofed role, malformed/foreign ARN and account disagreement are rejected', () => {
  for (const [account, arn] of [
    [
      '163596511125',
      'arn:aws:sts::163596511125:assumed-role/AccountFullAccessRole/session',
    ],
    [deployment.account, `arn:aws:iam::${deployment.account}:root`],
    [
      deployment.account,
      `arn:aws:iam::${deployment.account}:user/AccountFullAccessRole`,
    ],
    [
      deployment.account,
      `arn:aws:sts::163596511125:assumed-role/AccountFullAccessRole/session`,
    ],
    ...[
      'WrongRole',
      'AccountFullAccessRole-admin',
      'prefixAccountFullAccessRole',
    ].map((role) => [
      deployment.account,
      `arn:aws:sts::${deployment.account}:assumed-role/${role}/session`,
    ]),
    ...['aws-cn', 'aws-us-gov'].map((partition) => [
      deployment.account,
      `arn:${partition}:sts::${deployment.account}:assumed-role/AccountFullAccessRole/session`,
    ]),
    ...['', 'x', 'session/extra', 'session\n'].map((session) => [
      deployment.account,
      identity(session).Arn,
    ]),
    [deployment.account, 'malformed'],
    [
      deployment.account,
      identity().Arn.replace('sts::', 'sts:ap-southeast-2:'),
    ],
  ])
    assert.throws(() => assertDeploymentIdentity(account!, arn!));
});

test('missing, expired and malformed identity failures are redacted and never accepted', () => {
  for (const value of [
    null,
    [],
    {},
    { ...identity(), Account: Number(deployment.account) },
    { ...identity(), UserId: '' },
    { ...identity(), Arn: null },
  ])
    assert.throws(() =>
      verifyDeploymentCaller(env, () => JSON.stringify(value)),
    );
  for (const error of [
    'Unable to locate credentials: secret-fixture',
    'ExpiredToken: secret-fixture',
    'secret-fixture',
  ]) {
    assert.throws(
      () =>
        verifyDeploymentCaller(env, () => {
          throw new Error(error);
        }),
      (e) => e instanceof Error && !e.message.includes('secret-fixture'),
    );
  }
  assert.throws(() => verifyDeploymentCaller(env, () => '{malformed-json'));
});

test('no implicit profile/region or inherited credential, endpoint, cache, workspace and CLI override', () => {
  for (const wrong of [
    {},
    { AWS_PROFILE: 'edtosoy' },
    { ...env, AWS_PROFILE: 'iamadmin-general' },
    { ...env, AWS_PROFILE: 'default' },
    { ...env, AWS_DEFAULT_PROFILE: 'iamadmin-general' },
    { ...env, AWS_REGION: 'us-east-1' },
    { ...env, AWS_DEFAULT_REGION: 'us-east-1' },
    ...[
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_SECURITY_TOKEN',
      'AWS_ROLE_ARN',
      'AWS_ROLE_SESSION_NAME',
      'AWS_WEB_IDENTITY_TOKEN_FILE',
      'AWS_CONTAINER_CREDENTIALS_FULL_URI',
      'AWS_ENDPOINT_URL',
      'AWS_ENDPOINT_URL_STS',
      'AWS_CONFIG_FILE',
      'AWS_SHARED_CREDENTIALS_FILE',
      'AWS_CA_BUNDLE',
      'AWS_LOGIN_CACHE_DIRECTORY',
      'TF_CLI_ARGS',
      'TF_CLI_ARGS_apply',
      'TF_VAR_region',
      'TF_DATA_DIR',
      'TF_WORKSPACE',
      'TF_CLI_CONFIG_FILE',
      'TF_PLUGIN_CACHE_DIR',
      'TF_LOG',
      'TERRAFORM_CONFIG',
    ].map((key) => ({ ...env, [key]: 'secret-fixture' })),
    { ...env, AWS_ACCESS_KEY_ID: '' },
  ]) {
    let calls = 0;
    assert.throws(() =>
      verifyDeploymentCaller(wrong, () => {
        calls++;
        return JSON.stringify(identity());
      }),
    );
    assert.equal(calls, 0, 'reject conflict before invoking AWS');
  }
  assertDeploymentEnvironment({
    ...env,
    AWS_DEFAULT_REGION: env.AWS_REGION,
    AWS_DEFAULT_PROFILE: env.AWS_PROFILE,
  });
});

test('private backend preparation is exclusive, separated by root and never falls back to legacy files', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-sydney-'));
  try {
    await mkdir(resolve(dir, '.deployment'), { mode: 0o700 });
    const legacy = resolve(dir, '.deployment', 'demo-secrets.json');
    await writeFile(legacy, 'legacy-sentinel');
    const oldRoot = resolve(dir, 'infra/bootstrap');
    await mkdir(resolve(oldRoot, '.terraform'), { recursive: true });
    for (const name of [
      'backend.generated.tf',
      'terraform.tfstate',
      '.terraform/terraform.tfstate',
    ])
      await writeFile(resolve(oldRoot, name), 'foreign-legacy-do-not-load');
    const boot = deploymentContext(dir, 'bootstrap'),
      demo = deploymentContext(dir, 'demo');
    assert.notEqual(boot.work, demo.work);
    for (const context of [boot, demo]) {
      for (const name of [
        'work',
        'terraform-data',
        'backend.s3.tfbackend.json',
        `${context.stage}.tfplan`,
        `${context.stage}-plan.json`,
        'environment.env',
        'demo-secrets.json',
        'images.json',
        'last-command.log',
        'deployment-proof.json',
        'history/cycle/destroy-proof.json',
      ])
        assert.ok(
          context
            .path(name)
            .startsWith(
              `${dir}/.deployment/747240980964/ap-southeast-2/${context.stage}/`,
            ),
        );
      await assert.rejects(
        () => readBackendConfiguration(context),
        /no legacy fallback/,
      );
      await prepareBackendContract(context);
      assert.deepEqual(
        await readBackendConfiguration(context),
        backendContract(context.stage),
      );
      assert.equal((await stat(context.backendFile)).mode & 0o777, 0o600);
      assert.equal((await stat(context.base)).mode & 0o777, 0o700);
      await assert.rejects(() => prepareBackendContract(context), /EEXIST/);
      assert.throws(() =>
        assertBackendConfiguration(
          backendContract(context.stage === 'bootstrap' ? 'demo' : 'bootstrap'),
          context.stage,
        ),
      );
    }
    for (const wrong of [
      undefined,
      {},
      {
        ...backendContract('demo'),
        bucket: 'flow-demo-tfstate-163596511125-us-east-1',
      },
      { ...backendContract('demo'), region: 'us-east-1' },
      { ...backendContract('demo'), profile: 'iamadmin-general' },
      { ...backendContract('demo'), encrypt: false },
      { ...backendContract('demo'), use_lockfile: false },
      { ...backendContract('demo'), allowed_account_ids: ['163596511125'] },
      { ...backendContract('demo'), endpoint: 'foreign' },
    ])
      assert.throws(() => assertBackendConfiguration(wrong, 'demo'));
    assert.equal(await readFile(legacy, 'utf8'), 'legacy-sentinel');
    for (const name of [
      'backend.generated.tf',
      'terraform.tfstate',
      '.terraform/terraform.tfstate',
    ])
      assert.equal(
        await readFile(resolve(oldRoot, name), 'utf8'),
        'foreign-legacy-do-not-load',
      );
    await assert.rejects(() =>
      readFile(resolve(boot.work, 'terraform.tfstate')),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('traversal, symlink namespace/cache/plan escapes and shared files fail closed', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-paths-'));
  const foreign = await mkdtemp(resolve(tmpdir(), 'vigil-foreign-'));
  try {
    const context = deploymentContext(dir, 'demo');
    for (const path of [
      '../bootstrap/demo.tfplan',
      'work/../../demo/a',
      '/tmp/foreign',
      '',
    ])
      assert.throws(() => context.path(path));
    await mkdir(context.base, { recursive: true, mode: 0o700 });
    for (const name of [
      'work',
      'terraform-data',
      'demo.tfplan',
      'backend.s3.tfbackend.json',
      'history',
    ]) {
      await symlink(foreign, resolve(context.base, name));
      assert.throws(() => context.path(name));
      await rm(resolve(context.base, name));
    }
    const foreignFile = resolve(foreign, 'state');
    await writeFile(foreignFile, 'foreign-state');
    await link(foreignFile, resolve(context.base, 'demo.tfplan'));
    assert.throws(() => context.path('demo.tfplan'));
    await rm(resolve(context.base, 'demo.tfplan'));
    await rm(resolve(dir, '.deployment'), { recursive: true });
    await symlink(foreign, resolve(dir, '.deployment'));
    assert.throws(() => deploymentContext(dir, 'bootstrap'));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(foreign, { recursive: true, force: true });
  }
});

test('historical, stale, tampered, cross-root and cross-checkout receipts/plans are refused', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-plans-'));
  try {
    const demo = deploymentContext(dir, 'demo'),
      boot = deploymentContext(dir, 'bootstrap');
    const bytes = Buffer.from('new-plan');
    const receipt = planReceipt(demo, bytes, binding);
    const injected = planReceipt(demo, bytes, {
      ...binding,
      account: '163596511125',
      backend: backendContract('bootstrap'),
    } as PlanBinding);
    assert.deepEqual(
      injected,
      receipt,
      'input binding cannot override the validated target/backend',
    );
    assert.throws(() =>
      planReceipt(demo, bytes, {
        ...binding,
        sourceHash: binding.sourceHash + '\n',
      }),
    );
    assertPlanReceipt(receipt, demo, bytes, binding);
    for (const patch of [
      { account: '163596511125' },
      { region: 'us-east-1' },
      { profile: 'iamadmin-general' },
      { root: 'bootstrap' },
      { workspace: 'foreign' },
      { version: 0 },
      { backend: backendContract('bootstrap') },
      { work: 'infra/demo' },
      { data: 'infra/demo/.terraform' },
      { sourceHash: 'c'.repeat(64) },
      { inputHash: 'c'.repeat(64) },
      { stateIdentity: 'other-lineage' },
      { intent: 'destroy' },
      { checksum: 'c'.repeat(64) },
    ])
      assert.throws(() =>
        assertPlanReceipt({ ...receipt, ...patch }, demo, bytes, binding),
      );
    assert.throws(() => assertPlanReceipt(receipt, boot, bytes, binding));
    assert.throws(() =>
      assertPlanReceipt(
        receipt,
        deploymentContext(repository, 'demo'),
        bytes,
        binding,
      ),
    );
    assert.throws(() =>
      assertPlanReceipt(receipt, demo, Buffer.from('old-plan'), binding),
    );
    assert.throws(() =>
      assertPlanReceipt(
        { checksum: receipt.checksum, fingerprint: 'legacy' },
        demo,
        bytes,
        binding,
      ),
    );
    assert.throws(() =>
      planReceipt(boot, bytes, { ...binding, intent: 'destroy' }),
    );
    await prepareBackendContract(demo);
    await assert.rejects(() => verifySavedPlan(demo, binding));
    await writeFile(demo.plan, bytes);
    await writeFile(demo.receipt, JSON.stringify(receipt));
    await verifySavedPlan(demo, binding);
    await writeFile(demo.plan, 'historical-or-tampered');
    await assert.rejects(() => verifySavedPlan(demo, binding));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every deployment CLI rejects unsafe operations before Terraform, publication, secrets, remote tasks, Stripe or cleanup', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-cli-'));
  const trace = resolve(dir, 'trace.jsonl');
  try {
    const mock = `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync(process.env.MOCK_TRACE, JSON.stringify({command: require('node:path').basename(process.argv[1]), args: process.argv.slice(2)}) + '\\n');
if (process.argv[2] !== 'sts' || process.argv[3] !== 'get-caller-identity') process.exit(97);
if (process.env.MOCK_FAILURE) { console.error('ExpiredToken secret-fixture'); process.exit(1); }
console.log(process.env.MOCK_IDENTITY);
`;
    for (const name of ['aws', 'terraform', 'docker'])
      await writeFile(resolve(dir, name), mock, { mode: 0o700 });
    const selected = {
      PATH: `${dir}:${process.env['PATH']}`,
      HOME: process.env['HOME'],
      ...env,
      MOCK_TRACE: trace,
      MOCK_IDENTITY: JSON.stringify(identity()),
    };
    const invoke = (tool: string, command: string[], overrides = {}) =>
      spawnSync(
        process.execPath,
        ['--import', 'tsx', resolve(repository, 'tools', tool), ...command],
        {
          cwd: repository,
          env: { ...selected, ...overrides },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
    for (const [tool, commands] of [
      [
        'deploy.ts',
        [
          'bootstrap-plan',
          'bootstrap-dns-plan',
          'bootstrap-apply',
          'bootstrap-migrate-state',
          'bootstrap-connect',
          'bootstrap-destroy',
          'dns-verify',
        ],
      ],
      [
        'demo-deploy.ts',
        [
          'prepare',
          'images',
          'plan',
          'destroy-plan',
          'apply',
          'provision',
          'destination',
          'enable',
          'retire-destination',
          'reset',
          'sandbox-payment',
          'backfill',
          'verify-sandbox',
          'proof',
          'outputs',
        ],
      ],
      ['demo-observe.ts', ['', 'destroy-verify']],
    ] as const) {
      for (const command of commands) {
        const result = invoke(tool, command ? [command] : []);
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, /disabled pending D1B/);
        assert.doesNotMatch(result.stderr, /secret-fixture/);
      }
      const safe = invoke(tool, ['preflight']);
      assert.equal(safe.status, 0, safe.stderr);
      assert.match(safe.stdout, /747240980964/);
      assert.doesNotMatch(safe.stdout, /browser-session/);
      const failed = invoke(tool, ['apply'], { MOCK_FAILURE: 'expired' });
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /STS identity verification failed/);
      assert.doesNotMatch(failed.stderr, /secret-fixture/);
    }
    const calls = (await readFile(trace, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { command: string; args: string[] });
    assert.equal(calls.length, 30);
    assert.ok(
      calls.every(
        (call) =>
          call.command === 'aws' &&
          call.args[0] === 'sts' &&
          call.args[1] === 'get-caller-identity',
      ),
    );
    const before = calls.length;
    assert.equal(
      invoke('deploy.ts', ['preflight', '--profile', 'iamadmin-general'])
        .status,
      1,
    );
    for (const overrides of [
      { AWS_PROFILE: 'iamadmin-general' },
      { AWS_REGION: 'us-east-1' },
      { AWS_SESSION_TOKEN: 'secret-fixture' },
      {
        MOCK_IDENTITY: JSON.stringify({
          ...identity(),
          Account: '163596511125',
        }),
      },
    ])
      assert.equal(
        invoke('deploy.ts', ['bootstrap-apply'], overrides).status,
        1,
      );
    const after = (await readFile(trace, 'utf8')).trim().split('\n');
    assert.equal(
      after.length,
      before + 1,
      'only the identity mismatch needs an STS call',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
