import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  lstat,
  chmod,
  symlink,
  link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  runtimeInputTemplate,
  assertRuntimeInputConfiguration,
  validateRuntimeSecrets,
  runtimeInputStore,
  runtimePlanScope,
  runtimeSecretKeys,
} from '../tools/runtime-inputs';

test('fixed Sydney input config rejects foreign targets, images, hostname, backend/activation injection and fabricated IDs', () => {
  const c = runtimeInputTemplate();
  assertRuntimeInputConfiguration(c);
  for (const change of [
    (v: typeof c) => {
      Object.assign(v.target, { account: '163596511125' });
    },
    (v: typeof c) => {
      v.variables.aws_profile =
        'iamadmin-general' as typeof v.variables.aws_profile;
    },
    (v: typeof c) => {
      v.variables.images.ops = v.variables.images.ops.replace(
        'ap-southeast-2',
        'us-east-1',
      );
    },
    (v: typeof c) => {
      v.variables.images.ops = 'latest';
    },
    (v: typeof c) => {
      v.variables.hostname = 'flow.edtosoy.com' as typeof v.variables.hostname;
    },
    (v: typeof c) => {
      v.variables.start_services = true;
    },
    (v: typeof c) => {
      v.variables.certificate_dns_confirmed = true;
    },
    (v: typeof c) => {
      v.variables.ops_book_id = 'made-up';
    },
    (v: typeof c) => {
      v.database.address = 'flow-demo.fake.us-east-1.rds.amazonaws.com';
    },
    (v: typeof c) => {
      Object.assign(v, { secrets: { password: 'fixture' } });
    },
  ]) {
    const bad = structuredClone(c);
    change(bad);
    assert.throws(() => assertRuntimeInputConfiguration(bad));
  }
});

test('private values are checked without exposing failures or accepting live/pending secrets or mismatched provisioning', () => {
  const c = runtimeInputTemplate();
  validateRuntimeSecrets(
    {
      stripe_key: 'sk_test_' + 'a'.repeat(32),
      webhook_secrets: 'whsec_' + 'b'.repeat(32),
      admin_password: 'c'.repeat(48),
    },
    c,
  );
  for (const values of [
    { stripe_key: 'sk_live_sensitive_fixture' },
    { stripe_key: 'sk_test_example' },
    { webhook_secrets: 'pending-hosted-destination' },
    { admin_password: 'weak' },
    { unknown: 'sensitive_fixture' },
    { provisioning: 'sensitive_fixture' },
  ]) {
    try {
      validateRuntimeSecrets(values, c);
      assert.fail('unsafe input accepted');
    } catch (e) {
      assert.match(String(e), /Private input validation failed/);
      assert.doesNotMatch(String(e), /sensitive_fixture|sk_live_|weak|pending/);
    }
  }
  c.variables.ops_book_id = '33333333-3333-4333-8333-333333333333';
  c.bindings.stripe_book_id = '11111111-1111-4111-8111-111111111111';
  const passwords = Object.fromEntries(
    [
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
    ].map((k) => [k, 'd'.repeat(48)]),
  );
  const provisioning = JSON.stringify({
    bookId: c.bindings.stripe_book_id,
    accountId: c.variables.stripe_account_id,
    passwords,
  });
  validateRuntimeSecrets(
    { provisioning, operations_password: 'd'.repeat(48) },
    c,
  );
  assert.throws(() =>
    validateRuntimeSecrets(
      { provisioning, operations_password: 'e'.repeat(48) },
      c,
    ),
  );
  assert.throws(() =>
    validateRuntimeSecrets(
      {
        provisioning: provisioning.replace(
          c.bindings.stripe_book_id!,
          '22222222-2222-4222-8222-222222222222',
        ),
      },
      c,
    ),
  );
});

test('private store is exclusive, owner-only, Git-isolated by path and never promotes UUIDs or syntax to verified identities', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'vigil-input-store-'));
  try {
    const store = runtimeInputStore(root);
    await store.init();
    await assert.rejects(() => lstat(store.path('secrets.json')), /ENOENT/);
    assert.equal((await lstat(store.path('.'))).mode & 0o777, 0o700);
    assert.equal(
      (await lstat(store.path('configuration.json'))).mode & 0o777,
      0o600,
    );
    await assert.rejects(() => store.init(), /EEXIST/);
    let status = await store.check();
    assert.deepEqual(status.missingSecretKeys, runtimeSecretKeys);
    assert.equal(status.planExecutable, false);
    await store.set('stripe_key', 'sk_test_' + 'a'.repeat(32));
    assert.equal((await lstat(store.path('secrets.json'))).mode & 0o777, 0o600);
    status = await store.check();
    assert.equal(status.missingSecretKeys.includes('stripe_key'), false);
    assert.equal(status.bindingsVerified, false);
    assert.doesNotMatch(JSON.stringify(status), /sk_test_/);
    const c = runtimeInputTemplate();
    c.variables.ops_book_id = '11111111-1111-4111-8111-111111111111';
    c.variables.stripe_source_id = '22222222-2222-4222-8222-222222222222';
    await writeFile(store.path('configuration.json'), JSON.stringify(c));
    status = await store.check();
    assert.deepEqual(status.missingBindings, []);
    assert.equal(status.bindingsVerified, false);
    assert.equal(status.planExecutable, false);
    await chmod(store.path('secrets.json'), 0o644);
    await assert.rejects(() => store.check(), /Private owner-only/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('secret/config symlinks, shared files, foreign metadata and permissive parent paths fail closed', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'vigil-input-escape-'));
  try {
    const store = runtimeInputStore(root);
    await store.init();
    const outside = resolve(root, 'outside');
    await writeFile(outside, 'private fixture', { mode: 0o600 });
    await symlink(outside, store.path('secrets.json'));
    await assert.rejects(() => store.check(), /Symlink/);
    await rm(
      resolve(
        root,
        '.deployment/747240980964/ap-southeast-2/demo/runtime-inputs/secrets.json',
      ),
    );
    await link(outside, store.path('secrets.json'));
    await assert.rejects(() => store.check(), /shared/);
    await rm(
      resolve(
        root,
        '.deployment/747240980964/ap-southeast-2/demo/runtime-inputs/secrets.json',
      ),
    );
    await writeFile(
      store.path('secrets.json'),
      JSON.stringify({
        version: 1,
        target: { account: '163596511125' },
        values: {},
      }),
      { mode: 0o600 },
    );
    await assert.rejects(() => store.check(), /Foreign/);
    await rm(store.path('secrets.json'));
    await chmod(store.path('.'), 0o755);
    await assert.rejects(() => store.check(), /Private owner-only/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('plan scope proposes only exact runtime lock writes and keeps authorization and all execution disabled', () => {
  const scope = runtimePlanScope();
  assert.equal(scope.authorization, 'NOT_GRANTED');
  assert.equal(scope.executable, false);
  assert.equal(scope.workspace, 'default');
  assert.equal(
    scope.proposedLockWrites.resource,
    'arn:aws:s3:::flow-demo-tfstate-747240980964-ap-southeast-2/demo/terraform.tfstate.tflock',
  );
  assert.deepEqual(scope.proposedLockWrites.actions, [
    's3:PutObject',
    's3:DeleteObject',
  ]);
  assert(scope.forbidden.includes('state PutObject/DeleteObject'));
  assert(scope.forbidden.includes('apply'));
  assert(scope.backend.use_lockfile);
  for (const name of [
    'configuration.json',
    'secrets.json',
    'backend-plan-scope.json',
    'future.tfplan',
    'future.log',
    'terraform-data/terraform.tfstate',
  ]) {
    const path = resolve(
      __dirname,
      '../.deployment/747240980964/ap-southeast-2/demo/runtime-inputs',
      name,
    );
    assert.equal(
      spawnSync('git', ['check-ignore', '--quiet', path], {
        cwd: resolve(__dirname, '..'),
      }).status,
      0,
    );
  }
});

test('CLI refuses secret arguments, redirects, unsafe targets and any plan execution before network tools', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-input-cli-'));
  const trace = resolve(dir, 'trace');
  try {
    for (const name of ['aws', 'terraform'])
      await writeFile(
        resolve(dir, name),
        `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.MOCK_TRACE,'unexpected');process.exit(99);\n`,
        { mode: 0o700 },
      );
    const run = (args: string[], overrides = {}) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(__dirname, '../tools/runtime-inputs.ts'),
          ...args,
        ],
        {
          env: {
            PATH: `${dir}:${process.env['PATH']}`,
            HOME: process.env['HOME'],
            AWS_PROFILE: 'edtosoy',
            AWS_REGION: 'ap-southeast-2',
            MOCK_TRACE: trace,
            ...overrides,
          },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
    for (const args of [
      ['set', 'stripe_key', 'secret_fixture'],
      ['set', 'unknown'],
      ['--root=/tmp'],
      ['plan'],
      ['apply'],
    ]) {
      const r = run(args);
      assert.equal(r.status, 1);
      assert.doesNotMatch(r.stderr + r.stdout, /secret_fixture/);
    }
    assert.equal(run(['set', 'stripe_key']).status, 1);
    for (const overrides of [
      { AWS_REGION: 'us-east-1' },
      { AWS_PROFILE: 'iamadmin-general' },
      { AWS_SESSION_TOKEN: 'fixture' },
    ])
      assert.equal(run(['check'], overrides).status, 1);
    const scope = run(['plan-scope']);
    assert.equal(scope.status, 0);
    assert.equal(JSON.parse(scope.stdout).authorization, 'NOT_GRANTED');
    await assert.rejects(() => readFile(trace), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
