import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, cp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  runtimeBackendPolicy,
  runtimePlanBackend,
  assertRuntimePlanBackend,
  runtimeTerraformArgs,
  initialRuntimeAddresses,
  inspectInitialRuntimePlan,
  loadPreparedRuntime,
  type RuntimePlanOperation,
  runtimeCallerRoleArn,
  assertRuntimeSelfTrust,
} from '../tools/runtime-plan';
import { deploymentSourceNames } from '../tools/deployment-sources';
import {
  runtimeInputStore,
  runtimeInputTemplate,
  initialRuntimePlanInputs,
} from '../tools/runtime-inputs';

test('session backend pins exact target/key and refuses privilege or backend changes', () => {
  const run = randomUUID(),
    config = runtimePlanBackend(run);
  assertRuntimePlanBackend(config, run);
  assert.equal(
    config.assume_role.role_arn,
    'arn:aws:iam::747240980964:role/managed/AccountFullAccessRole',
  );
  assert(JSON.stringify(runtimeBackendPolicy()).length < 2048);
  for (const patch of [
    { bucket: 'foreign' },
    { key: 'bootstrap/terraform.tfstate' },
    { key: 'demo/other.tflock' },
    { profile: 'iamadmin-general' },
    { region: 'us-east-1' },
    { allowed_account_ids: ['163596511125'] },
    { use_lockfile: false },
    { assume_role: undefined },
    { assume_role: { ...config.assume_role, policy: '{}' } },
    {
      assume_role: {
        ...config.assume_role,
        role_arn: config.assume_role.role_arn.replace(
          '747240980964',
          '163596511125',
        ),
      },
    },
    { endpoints: { s3: 'http://fixture' } },
  ])
    assert.throws(() => assertRuntimePlanBackend({ ...config, ...patch }, run));
});

test('IAM role paths are preserved and service-only trust stops before self-assumption', () => {
  const observed = {
    Arn: runtimeCallerRoleArn,
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'account-access.amazonaws.com' },
          Action: ['sts:AssumeRole', 'sts:SetContext'],
        },
      ],
    },
  };
  assert.throws(
    () => assertRuntimeSelfTrust(observed),
    /does not explicitly trust self-assumption/,
  );
  assert.throws(
    () =>
      assertRuntimeSelfTrust({
        ...observed,
        Arn: runtimeCallerRoleArn.replace('/managed/', '/'),
      }),
    /Unexpected IAM role ARN/,
  );
  // Pure hypothetical fixture only: no trust update is authorized or performed.
  assertRuntimeSelfTrust({
    Arn: runtimeCallerRoleArn,
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: runtimeCallerRoleArn },
          Action: 'sts:AssumeRole',
        },
      ],
    },
  });
});

test('session policy denies state/foreign writes, nonconditional puts and all additional resource mutations', () => {
  const statements = JSON.parse(JSON.stringify(runtimeBackendPolicy()))
    .Statement as Record<string, unknown>[];
  const list = (v: unknown) => (Array.isArray(v) ? v : [v]) as string[];
  // Interpret only the exact constructs this fixed policy uses; no wildcard-policy simulator.
  const decision = (action: string, resource: string, header?: string) => {
    const matched = statements.filter((s) => {
      if (s.Action && !list(s.Action).includes(action)) return false;
      if (s.NotAction && list(s.NotAction).includes(action)) return false;
      if (
        s.Resource &&
        !list(s.Resource).some((v) => v === '*' || v === resource)
      )
        return false;
      if (s.NotResource && list(s.NotResource).includes(resource)) return false;
      const condition = s.Condition as
        | {
            StringEquals?: Record<string, string>;
            StringNotEquals?: Record<string, string>;
          }
        | undefined;
      if (condition?.StringEquals && header !== '*') return false;
      if (condition?.StringNotEquals && header === '*') return false;
      return true;
    });
    return (
      !matched.some((s) => s.Effect === 'Deny') &&
      matched.some((s) => s.Effect === 'Allow')
    );
  };
  const lock =
    'arn:aws:s3:::flow-demo-tfstate-747240980964-ap-southeast-2/demo/terraform.tfstate.tflock';
  assert(decision('s3:PutObject', lock, '*'));
  assert(decision('s3:DeleteObject', lock));
  assert(!decision('s3:PutObject', lock));
  assert(!decision('s3:PutObject', lock, 'foreign-etag'));
  for (const object of [
    lock.replace('.tflock', ''),
    lock.replace('/demo/', '/bootstrap/'),
    lock.replace('747240980964', '163596511125'),
    lock + '/extra',
    lock.replace('.tflock', '.other'),
  ])
    for (const action of ['s3:PutObject', 's3:DeleteObject'])
      assert(!decision(action, object, '*'));
  for (const action of [
    's3:DeleteObjectVersion',
    's3:PutBucketPolicy',
    'ecs:RunTask',
    'rds:CreateDBInstance',
    'ssm:PutParameter',
    'acm:RequestCertificate',
    'sts:AssumeRole',
  ])
    assert(!decision(action, lock, '*'));
});

test('Terraform capability has fixed argv and refuses apply/destroy/import/state/unlock or arbitrary flags', () => {
  const paths = {
    backend: '/private/backend.json',
    variables: '/private/vars.json',
    plan: '/private/runtime.tfplan',
  };
  for (const op of [
    'version',
    'fmt',
    'init',
    'validate',
    'plan',
    'show',
  ] as const) {
    const args = runtimeTerraformArgs(op, paths);
    assert.equal(args[0], op);
    assert(
      !args.some((v) =>
        /lock=false|force-unlock|migrate-state|force-copy|auto-approve/.test(v),
      ),
    );
  }
  assert(runtimeTerraformArgs('init', paths).includes('-lockfile=readonly'));
  for (const op of [
    'apply',
    'destroy',
    'import',
    'state',
    'force-unlock',
    'workspace',
    'plan -lock=false',
    '--target=foreign',
  ])
    assert.throws(() =>
      runtimeTerraformArgs(op as RuntimePlanOperation, paths),
    );
});

test('initial saved-plan inventory rejects extra, updated, deleted, replaced or secret-persisting resources', () => {
  const inputs = initialRuntimePlanInputs(runtimeInputTemplate(), {
    admin_password: 'x'.repeat(48),
  });
  const plan = {
    variables: Object.fromEntries(
      Object.entries(inputs.variables).map(([k, v]) => [k, { value: v }]),
    ),
    resource_changes: initialRuntimeAddresses().map((address) => ({
      address,
      mode: 'managed',
      type: address.split('.')[0]!,
      change: {
        actions: ['create'],
        after:
          address === 'aws_db_instance.demo'
            ? {
                identifier: 'flow-demo',
                publicly_accessible: false,
                multi_az: false,
                storage_encrypted: true,
                instance_class: 'db.t4g.micro',
                backup_retention_period: 0,
                deletion_protection: false,
                skip_final_snapshot: true,
                password: null,
                engine: 'postgres',
                engine_version: '18.6',
                allocated_storage: 20,
                storage_type: 'gp3',
                ca_cert_identifier: 'rds-ca-rsa2048-g1',
              }
            : address.startsWith('aws_ssm_parameter.')
              ? {
                  name: '/flow/demo/admin_url',
                  type: 'SecureString',
                  value: null,
                  value_wo_version: 1,
                }
              : ({} as Record<string, unknown>),
      },
    })),
  };
  Object.assign(plan.variables, {
    stripe_source_id: { value: '' },
    ops_book_id: { value: '' },
  });
  for (const r of plan.resource_changes) {
    const a = r.change.after;
    if (r.type === 'aws_ecs_task_definition') {
      const kind = JSON.parse(r.address.split('[')[1]!.slice(0, -1)) as string;
      Object.assign(a, {
        cpu: '256',
        memory: kind === 'ops' || kind === 'admin' ? '1024' : '512',
        runtime_platform: [
          { cpu_architecture: 'X86_64', operating_system_family: 'LINUX' },
        ],
        container_definitions: JSON.stringify([
          {
            name: kind,
            user: '1000:1000',
            image:
              inputs.variables.images[
                kind === 'ingress' || kind === 'worker'
                  ? 'stripe'
                  : kind === 'verify'
                    ? 'admin'
                    : (kind as 'ops' | 'admin')
              ],
            environment: [{ name: 'STRIPE_MODE', value: 'sandbox' }],
            secrets: [
              {
                name: 'fixture',
                valueFrom:
                  'arn:aws:ssm:ap-southeast-2:747240980964:parameter/flow/demo/fixture',
              },
            ],
          },
        ]),
      });
    }
    if (r.type === 'aws_iam_role')
      Object.assign(a, {
        assume_role_policy: JSON.stringify({
          Statement: [
            {
              Principal: { Service: 'ecs-tasks.amazonaws.com' },
              Action: 'sts:AssumeRole',
              Condition: {
                StringEquals: { 'aws:SourceAccount': '747240980964' },
                ArnLike: {
                  'aws:SourceArn': 'arn:aws:ecs:ap-southeast-2:747240980964:*',
                },
              },
            },
          ],
        }),
      });
    if (r.type === 'aws_subnet')
      Object.assign(a, { availability_zone: 'ap-southeast-2a' });
    if (r.type === 'aws_db_parameter_group')
      Object.assign(a, { parameter: [{ name: 'rds.force_ssl', value: '1' }] });
    if (r.type === 'aws_acm_certificate')
      Object.assign(a, {
        domain_name: 'vigil.edtosoy.com',
        validation_method: 'DNS',
      });
    if (r.type === 'aws_lb')
      Object.assign(a, {
        internal: false,
        load_balancer_type: 'application',
        enable_deletion_protection: false,
      });
  }
  assert.equal(inspectInitialRuntimePlan(plan, inputs.variables).creates, 75);
  for (const actions of [
    ['update'],
    ['delete'],
    ['delete', 'create'],
    ['no-op'],
  ]) {
    const bad = structuredClone(plan);
    bad.resource_changes[0]!.change.actions = actions;
    assert.throws(() => inspectInitialRuntimePlan(bad, inputs.variables));
  }
  const extra = structuredClone(plan);
  extra.resource_changes.push({
    ...extra.resource_changes[0]!,
    address: 'aws_route53_zone.foreign',
    type: 'aws_route53_zone',
  });
  assert.throws(() => inspectInitialRuntimePlan(extra, inputs.variables));
  const leaked = structuredClone(plan);
  Object.assign(leaked.variables, {
    secrets: { value: { admin_password: 'fixture' } },
  });
  assert.throws(() => inspectInitialRuntimePlan(leaked, inputs.variables));
  const active = structuredClone(plan);
  active.variables.start_services!.value = true;
  assert.throws(() => inspectInitialRuntimePlan(active, inputs.variables));
  for (const [address, patch] of [
    ['aws_db_instance.demo', { publicly_accessible: true }],
    ['aws_ssm_parameter.runtime["admin_url"]', { value: 'plaintext-fixture' }],
    [
      'aws_ecs_task_definition.app["ops"]',
      {
        container_definitions: JSON.stringify([
          { name: 'ops', image: 'latest', user: 'root' },
        ]),
      },
    ],
    [
      'aws_db_parameter_group.demo',
      { parameter: [{ name: 'rds.force_ssl', value: '0' }] },
    ],
    [
      'aws_iam_role.task["ops"]',
      {
        assume_role_policy: JSON.stringify({
          Statement: [{ Principal: { AWS: '*' } }],
        }),
      },
    ],
  ] as const) {
    const bad = structuredClone(plan);
    Object.assign(
      bad.resource_changes.find((r) => r.address === address)!.change.after,
      patch,
    );
    assert.throws(() => inspectInitialRuntimePlan(bad, inputs.variables));
  }
});

test('prepared runtime rejects stale claims, unexpected backend metadata, variables or state files', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'vigil-d3e-prepared-'));
  try {
    await mkdir(resolve(root, 'infra/demo/tests'), { recursive: true });
    for (const name of deploymentSourceNames('demo'))
      await cp(
        resolve(__dirname, '../infra/demo', name),
        resolve(root, 'infra/demo', name),
      );
    const store = runtimeInputStore(root);
    await store.init();
    await store.set('admin_password', 'x'.repeat(48));
    const result = await store.preparePlan();
    const prepared = await loadPreparedRuntime(root);
    assert.equal(
      prepared.inputs.ephemeralSecrets.admin_password,
      'x'.repeat(48),
    );
    await writeFile(prepared.paths.plan, 'historical fixture', { mode: 0o600 });
    await assert.rejects(() => loadPreparedRuntime(root), /stale/);
    await rm(prepared.paths.plan);
    const state = resolve(prepared.assembly.work, 'terraform.tfstate');
    await writeFile(state, '{}', { mode: 0o600 });
    await assert.rejects(() => loadPreparedRuntime(root), /Unexpected/);
    await rm(state);
    const cache = resolve(prepared.assembly.data, 'terraform.tfstate');
    await writeFile(cache, '{}', { mode: 0o600 });
    await assert.rejects(() => loadPreparedRuntime(root), /backend metadata/);
    await rm(cache);
    const original = await readFile(result.variableFile);
    await writeFile(result.variableFile, '{}');
    await assert.rejects(() => loadPreparedRuntime(root), /Stale/);
    await writeFile(result.variableFile, original);
    await writeFile(
      resolve(prepared.assembly.work, 'backend.generated.tf'),
      'foreign',
    );
    await assert.rejects(() => loadPreparedRuntime(root), /Unexpected/);
    await rm(resolve(prepared.assembly.work, 'backend.generated.tf'));
    await writeFile(
      prepared.assembly.context.path(
        `${prepared.assembly.prefix}/plan-execution.json`,
      ),
      '{}',
      { mode: 0o600 },
    );
    await assert.rejects(() => loadPreparedRuntime(root), /unclaimed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime plan CLI refuses unsafe identity, inherited credentials and overrides before Terraform', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-d3e-cli-'));
  const trace = resolve(dir, 'trace');
  try {
    await writeFile(
      resolve(dir, 'aws'),
      '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({Account:"163596511125",Arn:"arn:aws:sts::163596511125:assumed-role/AccountFullAccessRole/session",UserId:"fixture"}));\n',
      { mode: 0o700 },
    );
    await writeFile(
      resolve(dir, 'terraform'),
      '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.MOCK_TRACE,"unexpected");process.exit(99);\n',
      { mode: 0o700 },
    );
    const run = (args: string[], extra = {}) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(__dirname, '../tools/plan-runtime.ts'),
          ...args,
        ],
        {
          env: {
            PATH: `${dir}:${process.env['PATH']}`,
            HOME: process.env['HOME'],
            AWS_PROFILE: 'edtosoy',
            AWS_REGION: 'ap-southeast-2',
            MOCK_TRACE: trace,
            ...extra,
          },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
    for (const args of [
      [],
      ['apply'],
      ['--bucket=foreign'],
      ['-lock=false'],
      ['--key=bootstrap/terraform.tfstate'],
    ])
      assert.equal(run(args).status, 1);
    for (const extra of [
      { AWS_PROFILE: 'iamadmin-general' },
      { AWS_REGION: 'us-east-1' },
      { AWS_ACCESS_KEY_ID: 'fixture' },
      { TF_CLI_ARGS: 'apply' },
    ])
      assert.equal(run([], extra).status, 1);
    await assert.rejects(() => readFile(trace), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
