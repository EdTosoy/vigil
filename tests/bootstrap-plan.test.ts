import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { deployment } from '../tools/deployment-guards';
import { assembleDeploymentSources } from '../tools/deployment-sources';
import {
  assertFreshSeedWorkspace,
  seedBackendContract,
  inspectSeedPlan,
  assertBudgetEvidence,
} from '../tools/bootstrap-plan';

const repository = resolve(__dirname, '..');
const budget = () => ({
  account_id: deployment.account,
  name: deployment.budget,
  budget_type: 'COST',
  time_unit: 'MONTHLY',
  budget_limit: [{ amount: '5.0', unit: 'USD' }],
  cost_types: [
    { include_credit: false, include_refund: false, include_tax: true },
  ],
  cost_filter: [],
  billing_view_arn: '',
  observed_at: new Date().toISOString(),
});
function planFixture() {
  const value = budget();
  const changes: {
    address: string;
    type: string;
    mode: string;
    change: { actions: string[]; before: null; after: Record<string, unknown> };
  }[] = [];
  const add = (address: string, type: string, after: Record<string, unknown>) =>
    changes.push({
      address,
      type,
      mode: 'managed',
      change: { actions: ['create'], before: null, after },
    });
  const tags_all = {
    Project: 'vigil',
    Lifecycle: 'persistent',
    DeploymentAccount: deployment.account,
    DeploymentRegion: deployment.region,
  };
  add('aws_s3_bucket.state', 'aws_s3_bucket', {
    bucket: deployment.bucket,
    force_destroy: false,
    tags_all,
  });
  add(
    'aws_s3_bucket_ownership_controls.state',
    'aws_s3_bucket_ownership_controls',
    { rule: [{ object_ownership: 'BucketOwnerEnforced' }] },
  );
  add(
    'aws_s3_bucket_public_access_block.state',
    'aws_s3_bucket_public_access_block',
    {
      block_public_acls: true,
      block_public_policy: true,
      ignore_public_acls: true,
      restrict_public_buckets: true,
    },
  );
  add('aws_s3_bucket_versioning.state', 'aws_s3_bucket_versioning', {
    versioning_configuration: [{ status: 'Enabled' }],
  });
  add(
    'aws_s3_bucket_server_side_encryption_configuration.state',
    'aws_s3_bucket_server_side_encryption_configuration',
    {
      rule: [
        {
          apply_server_side_encryption_by_default: [
            { sse_algorithm: 'AES256' },
          ],
        },
      ],
    },
  );
  add('aws_s3_bucket_policy.state', 'aws_s3_bucket_policy', {
    policy: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'DenyInsecureTransport',
          Effect: 'Deny',
          Principal: '*',
          Action: 's3:*',
          Resource: [
            `arn:aws:s3:::${deployment.bucket}`,
            `arn:aws:s3:::${deployment.bucket}/*`,
          ],
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        },
      ],
    }),
  });
  for (const name of ['admin', 'ops', 'stripe']) {
    add(`aws_ecr_repository.image["${name}"]`, 'aws_ecr_repository', {
      name: `flow-demo/${name}`,
      image_tag_mutability: 'IMMUTABLE',
      force_delete: false,
      tags_all,
      encryption_configuration: [{ encryption_type: 'AES256' }],
      image_scanning_configuration: [{ scan_on_push: true }],
    });
    add(
      `aws_ecr_lifecycle_policy.image["${name}"]`,
      'aws_ecr_lifecycle_policy',
      {
        repository: `flow-demo/${name}`,
        policy: JSON.stringify({
          rules: [
            {
              rulePriority: 1,
              description: 'Expire untagged build remnants after seven days',
              selection: {
                tagStatus: 'untagged',
                countType: 'sinceImagePushed',
                countUnit: 'days',
                countNumber: 7,
              },
              action: { type: 'expire' },
            },
          ],
        }),
      },
    );
  }
  return {
    resource_changes: changes,
    planned_values: {
      root_module: {
        resources: [
          {
            address: 'data.aws_budgets_budget.existing',
            type: 'aws_budgets_budget',
            mode: 'data',
            // Match the real pinned provider: it leaves period/cost fields null.
            values: {
              account_id: deployment.account,
              name: deployment.budget,
              budget_type: 'COST',
              budget_limit: value.budget_limit,
              time_unit: null,
              cost_types: null,
            },
          },
        ],
      },
    },
    variables: {
      aws_account_id: { value: deployment.account },
      aws_profile: { value: deployment.profile },
      aws_region: { value: deployment.region },
      existing_budget_name: { value: deployment.budget },
      budget_evidence: { value },
    },
    configuration: {
      provider_config: {
        aws: {
          full_name: 'registry.terraform.io/hashicorp/aws',
          expressions: {
            profile: { references: ['var.aws_profile'] },
            region: { references: ['var.aws_region'] },
            allowed_account_ids: { references: ['var.aws_account_id'] },
          },
        },
      },
    },
    output_changes: {
      budget_name: { after_sensitive: false },
      image_repositories: { after_sensitive: false },
      state_bucket: { after_sensitive: false },
    },
  };
}

test('exact twelve-create proposal accepts real-provider missing optional budget fields only with independent fresh gross evidence', () => {
  const plan = planFixture();
  const summary = inspectSeedPlan(plan);
  assert.equal(summary.managedCreates, 12);
  assert.equal(summary.provisioningAuthorized, false);
  const priorData = planFixture();
  const { planned_values, ...rest } = priorData;
  assert.equal(
    inspectSeedPlan({ ...rest, prior_state: { values: planned_values } })
      .managedCreates,
    12,
  );
  assert.doesNotMatch(
    JSON.stringify(summary),
    /observed_at|cost_types|subscriber|secret/i,
  );
  const wrong = planFixture();
  wrong.variables.budget_evidence.value.cost_types[0]!.include_credit = true;
  assert.throws(() => inspectSeedPlan(wrong));
  assert.throws(() =>
    assertBudgetEvidence({ ...budget(), observed_at: '2020-01-01T00:00:00Z' }),
  );
  assert.throws(() =>
    assertBudgetEvidence({ ...budget(), observed_at: 'malformed' }),
  );
  assert.throws(() =>
    assertBudgetEvidence({ ...budget(), time_unit: 'DAILY' }),
  );
});

test('seed plan rejects historical targets, budgets, DNS/runtime resources, destructive changes, prior state and unsafe security', () => {
  for (const mutate of [
    (p: ReturnType<typeof planFixture>) => {
      p.variables.aws_account_id.value =
        '163596511125' as typeof deployment.account;
    },
    (p: ReturnType<typeof planFixture>) => {
      p.variables.aws_profile.value =
        'iamadmin-general' as typeof deployment.profile;
    },
    (p: ReturnType<typeof planFixture>) => {
      p.variables.aws_region.value = 'us-east-1' as typeof deployment.region;
    },
    (p: ReturnType<typeof planFixture>) => {
      p.configuration.provider_config.aws.expressions.allowed_account_ids.references =
        ['var.foreign'];
    },
    ...[
      'aws_budgets_budget',
      'aws_route53_zone',
      'aws_db_instance',
      'aws_iam_role',
      'aws_ecs_service',
      'aws_nat_gateway',
    ].map((type) => (p: ReturnType<typeof planFixture>) => {
      p.resource_changes[0]!.type = type;
    }),
    (p: ReturnType<typeof planFixture>) => {
      p.resource_changes[0]!.change.actions = ['update'];
    },
    (p: ReturnType<typeof planFixture>) => {
      p.resource_changes[0]!.change.actions = ['delete'];
    },
    (p: ReturnType<typeof planFixture>) => {
      Object.assign(p.resource_changes[0]!.change, {
        importing: { id: 'existing' },
      });
    },
    (p: ReturnType<typeof planFixture>) => {
      p.resource_changes[0]!.change.after['bucket'] =
        'flow-demo-tfstate-163596511125-us-east-1';
    },
    (p: ReturnType<typeof planFixture>) => {
      p.resource_changes[2]!.change.after['block_public_acls'] = false;
    },
    (p: ReturnType<typeof planFixture>) => {
      p.resource_changes[5]!.change.after['policy'] = JSON.stringify({
        Statement: [],
      });
    },
    (p: ReturnType<typeof planFixture>) => {
      p.resource_changes[6]!.change.after['image_tag_mutability'] = 'MUTABLE';
    },
    (p: ReturnType<typeof planFixture>) => {
      p.resource_changes[7]!.change.after['policy'] = JSON.stringify({
        rules: [],
      });
    },
    (p: ReturnType<typeof planFixture>) => {
      p.output_changes.budget_name.after_sensitive = true;
    },
  ]) {
    const p = planFixture();
    mutate(p);
    assert.throws(() => inspectSeedPlan(p));
  }
  assert.throws(() =>
    inspectSeedPlan({
      ...planFixture(),
      prior_state: {
        values: { root_module: { resources: [{ mode: 'managed' }] } },
      },
    }),
  );
  assert.throws(() =>
    inspectSeedPlan({ ...planFixture(), deferred_changes: [{}] }),
  );
  const extra = {
    ...planFixture(),
    output_changes: {
      ...planFixture().output_changes,
      secret: { after_sensitive: false },
    },
  };
  assert.throws(() => inspectSeedPlan(extra));
});

test('fresh seed workspace requires exact local contract and refuses old state/backend/cache/plan without reading it', async () => {
  const assembly = await assembleDeploymentSources(
    repository,
    'bootstrap',
    undefined,
    'bootstrap-plan',
  );
  const path = (name: string) =>
    assembly.context.path(`${assembly.prefix}/${name}`);
  try {
    await assert.rejects(() => assertFreshSeedWorkspace(assembly));
    await writeFile(
      path('seed-backend.json'),
      JSON.stringify(seedBackendContract(assembly)),
      { mode: 0o600 },
    );
    await assertFreshSeedWorkspace(assembly);
    await writeFile(
      path('seed-backend.json'),
      JSON.stringify({
        ...seedBackendContract(assembly),
        backend: 's3',
        bucket: 'flow-demo-tfstate-163596511125-us-east-1',
      }),
    );
    await assert.rejects(() => assertFreshSeedWorkspace(assembly));
    await writeFile(
      path('seed-backend.json'),
      JSON.stringify(seedBackendContract(assembly)),
    );
    for (const name of [
      'work/terraform.tfstate',
      'work/terraform.tfstate.backup',
      'work/backend.generated.tf',
      'terraform-data/terraform.tfstate',
      'terraform-data/environment',
      'bootstrap.tfplan',
      'plan-receipt.json',
    ]) {
      await writeFile(path(name), 'foreign');
      await assert.rejects(() => assertFreshSeedWorkspace(assembly));
      await rm(path(name));
    }
    await assertFreshSeedWorkspace(assembly);
  } finally {
    await rm(assembly.context.path(assembly.prefix), {
      recursive: true,
      force: true,
    });
  }
});

test('plan CLI refuses provisioning/overrides before AWS; wrong role/account/region stop before Terraform', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-plan-cli-'));
  const trace = resolve(dir, 'trace');
  try {
    await writeFile(
      resolve(dir, 'aws'),
      `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.MOCK_TRACE,'aws\\n');
console.log(JSON.stringify({Account:process.env.MOCK_ACCOUNT,Arn:process.env.MOCK_ARN,UserId:'AROAFIXTURE:session'}));
`,
      { mode: 0o700 },
    );
    await writeFile(resolve(dir, 'terraform'), '#!/bin/sh\nexit 98\n', {
      mode: 0o700,
    });
    const env = {
      PATH: `${dir}:${process.env['PATH']}`,
      HOME: process.env['HOME'],
      AWS_PROFILE: deployment.profile,
      AWS_REGION: deployment.region,
      MOCK_TRACE: trace,
      MOCK_ACCOUNT: deployment.account,
      MOCK_ARN: `arn:aws:sts::${deployment.account}:assumed-role/OtherRole/session`,
    };
    const run = (args: string[], overrides = {}) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(repository, 'tools/plan-bootstrap.ts'),
          ...args,
        ],
        {
          cwd: repository,
          env: { ...env, ...overrides },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
    for (const args of [
      ['apply'],
      ['destroy'],
      ['--reviewed'],
      ['--state=old.tfstate'],
      ['--backend-config=old'],
    ])
      assert.equal(run(args).status, 1);
    await assert.rejects(() => readFile(trace), /ENOENT/);
    assert.equal(run([]).status, 1);
    assert.equal(run([], { MOCK_ACCOUNT: '163596511125' }).status, 1);
    assert.equal(run([], { AWS_REGION: 'us-east-1' }).status, 1);
    assert.equal(run([], { AWS_SESSION_TOKEN: 'fixture' }).status, 1);
    assert.equal((await readFile(trace, 'utf8')).trim().split('\n').length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
