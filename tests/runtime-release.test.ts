import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimeReleaseCommand } from '../tools/runtime-release';
import {
  runtimeStateDocument,
  runtimeStateBackend,
  runtimeStateRoleArn,
} from '../tools/runtime-state-role';
import {
  runtimePlanBackend,
  assertRuntimePlanBackend,
  inspectRuntimeBackendIdentity,
} from '../tools/runtime-plan';
import {
  d3eBaselineRun,
  d3eBaselineHash,
  d3fPackageId,
  parseRuntimeReviewId,
  assertFreshReview,
  assertFreePlan,
  assertRuntimePlanMatch,
  expectedExecutionPolicies,
  assertRuntimeTeardown,
  runtimeReleaseArgs,
  claimRuntimeOperation,
  assertEmptyRuntimeStateHistory,
  type ReleasePlan,
} from '../tools/runtime-apply-review';

test('state role can persist only the exact runtime state; state deletion and nonconditional/foreign writes remain denied', () => {
  const policy = runtimeStateDocument('permissions');
  const list = (v: unknown) => (Array.isArray(v) ? v : [v]) as string[];
  const decision = (action: string, resource: string, header?: string) => {
    const matched = policy.Statement.filter((s: Record<string, unknown>) => {
      if (s['Action'] && !list(s['Action']).includes(action)) return false;
      if (s['NotAction'] && list(s['NotAction']).includes(action)) return false;
      if (
        s['Resource'] &&
        !list(s['Resource']).some((v) => v === '*' || v === resource)
      )
        return false;
      if (s['NotResource'] && list(s['NotResource']).includes(resource))
        return false;
      const c = s['Condition'] as
        { StringEquals?: unknown; StringNotEquals?: unknown } | undefined;
      if (c?.StringEquals && header !== '*') return false;
      if (c?.StringNotEquals && header === '*') return false;
      return true;
    }) as { Effect: string }[];
    return (
      matched.some((s) => s.Effect === 'Allow') &&
      !matched.some((s) => s.Effect === 'Deny')
    );
  };
  const state =
    'arn:aws:s3:::flow-demo-tfstate-747240980964-ap-southeast-2/demo/terraform.tfstate';
  assert(decision('s3:GetObject', state));
  assert(decision('s3:PutObject', state));
  assert(!decision('s3:DeleteObject', state));
  assert(decision('s3:PutObject', state + '.tflock', '*'));
  assert(decision('s3:DeleteObject', state + '.tflock'));
  assert(!decision('s3:PutObject', state + '.tflock'));
  for (const key of [
    state + '.other',
    state.replace('/demo/', '/bootstrap/'),
    state.replace('747240980964', '163596511125'),
  ])
    for (const action of ['s3:PutObject', 's3:DeleteObject'])
      assert(!decision(action, key, '*'));
  for (const action of [
    's3:DeleteObjectVersion',
    's3:PutBucketPolicy',
    's3:PutObjectAcl',
    'iam:CreateRole',
    'iam:PassRole',
    'ecs:RunTask',
    'rds:CreateDBInstance',
    'sts:AssumeRole',
  ])
    assert(!decision(action, state, '*'));
  assert.equal(
    runtimeStateDocument('trust').Statement[0].Condition.StringLike[
      'sts:RoleSessionName'
    ],
    'vigil-d3f-*',
  );
});

test('D3F state capability is separate from the unchanged D3E state-read-only contract', () => {
  const run = randomUUID(),
    state = runtimeStateBackend(run),
    old = runtimePlanBackend(run);
  assert.equal(state.assume_role.role_arn, runtimeStateRoleArn);
  assert.equal(state.assume_role.duration, '1h');
  assertRuntimePlanBackend(state, run, 'D3F');
  assert.throws(() => assertRuntimePlanBackend(state, run));
  assert.throws(() => assertRuntimePlanBackend(old, run, 'D3F'));
  assert.throws(() => runtimePlanBackend(run, 'foreign' as 'D3F'));
  const log = `2026-10-28T00:00:00Z backend-s3.aws-base: rpc.method=GetCallerIdentity\n<Arn>arn:aws:sts::747240980964:assumed-role/VigilSydneyRuntimeStateRole/vigil-d3f-${run}</Arn>`;
  assert.equal(
    inspectRuntimeBackendIdentity(log, run, 'D3F').roleArn,
    runtimeStateRoleArn,
  );
  assert.throws(() => inspectRuntimeBackendIdentity(log, run));
});

test('Free Plan guard refuses foreign/paid/expired/unknown/low-credit states; exhausted credits do not disable approved cleanup', () => {
  const now = Date.now();
  const good = {
    accountId: '747240980964',
    accountPlanType: 'FREE',
    accountPlanStatus: 'ACTIVE',
    accountPlanExpirationDate: new Date(now + 5 * 3600000).toISOString(),
    accountPlanRemainingCredits: { amount: '2.000000001', unit: 'USD' },
  };
  assertFreePlan(good, false, now);
  for (const patch of [
    { accountId: '163596511125' },
    { accountPlanType: 'PAID' },
    { accountPlanStatus: 'EXPIRED' },
    { accountPlanStatus: 'UNKNOWN' },
    { accountPlanExpirationDate: new Date(now + 3600000).toISOString() },
    { accountPlanRemainingCredits: { amount: '1.999999999', unit: 'USD' } },
    { accountPlanRemainingCredits: { amount: 'NaN', unit: 'USD' } },
    { accountPlanRemainingCredits: { amount: '120', unit: 'AUD' } },
  ])
    assert.throws(() => assertFreePlan({ ...good, ...patch }, false, now));
  assertFreePlan(
    {
      ...good,
      accountPlanStatus: 'EXPIRED',
      accountPlanRemainingCredits: { amount: '0', unit: 'USD' },
    },
    true,
    now,
  );
});

test('review identifiers require exact fresh D3F plan hash, never the existing D3E binary', () => {
  const run = randomUUID(),
    digest = 'a'.repeat(64),
    id = `${run}:${digest}`,
    now = Date.now();
  assert.deepEqual(parseRuntimeReviewId(id), { run, sha256: digest });
  const receipt = {
    purpose: 'D3F',
    run,
    sha256: digest,
    createdAt: new Date(now).toISOString(),
  };
  assertFreshReview(receipt, id, now);
  for (const bad of [
    '',
    `${d3eBaselineRun}:${digest}`,
    `${run}:${d3eBaselineHash}`,
    '../foreign',
    id + '\n',
  ])
    assert.throws(() => parseRuntimeReviewId(bad));
  for (const patch of [
    { purpose: 'D3E' },
    { sha256: 'b'.repeat(64) },
    { run: randomUUID() },
    { createdAt: new Date(now - 900001).toISOString() },
    { createdAt: new Date(now + 1).toISOString() },
  ])
    assert.throws(() => assertFreshReview({ ...receipt, ...patch }, id, now));
});

test('complete plan/config matching blocks drift including computed-policy expression changes and rendered wildcard privileges', () => {
  const policies = expectedExecutionPolicies();
  const base: ReleasePlan = {
    configuration: { expressions: 'pinned unknown log ARN references' },
    resource_changes: Object.keys(policies).map((name) => ({
      address: `aws_iam_role_policy.execution["${name}"]`,
      mode: 'managed',
      type: 'aws_iam_role_policy',
      change: {
        actions: ['create'],
        after: { policy: JSON.stringify(policies[name]) },
      },
    })),
  };
  assertRuntimePlanMatch(base, structuredClone(base));
  const config = structuredClone(base);
  config.configuration = { expressions: 'foreign SSM resources' };
  assert.throws(() => assertRuntimePlanMatch(config, base));
  const bad = structuredClone(base);
  bad.resource_changes![0]!.change.after!['policy'] = JSON.stringify({
    Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }],
  });
  assert.throws(() => assertRuntimePlanMatch(bad, bad));
  const renamed = structuredClone(base);
  renamed.resource_changes![0]!.address = 'aws_iam_role_policy.extra';
  assert.throws(() => assertRuntimePlanMatch(renamed, renamed));
  assert.equal(Object.keys(policies).length, 5);
  for (const p of Object.values(policies)) {
    assert.deepEqual(p.Statement[0], {
      Effect: 'Allow',
      Action: ['ecr:GetAuthorizationToken'],
      Resource: '*',
    });
    assert(!JSON.stringify(p).includes('iam:'));
  }
});

test('teardown is a separately reviewed deletion-only subset of the same 75 resources', () => {
  const p: ReleasePlan = {
    resource_changes: [
      {
        address: 'aws_vpc.demo',
        type: 'aws_vpc',
        mode: 'managed',
        change: { actions: ['delete'], after: null },
      },
    ],
  };
  assert.equal(assertRuntimeTeardown(p).deletes, 1);
  for (const actions of [
    ['create'],
    ['update'],
    ['delete', 'create'],
    ['no-op'],
  ]) {
    const bad = structuredClone(p);
    bad.resource_changes![0]!.change.actions = actions;
    assert.throws(() => assertRuntimeTeardown(bad));
  }
  for (const address of [
    'aws_s3_bucket.state',
    'aws_iam_role.state_backend',
    'aws_route53_zone.demo',
  ]) {
    const bad = structuredClone(p);
    bad.resource_changes![0]!.address = address;
    assert.throws(() => assertRuntimeTeardown(bad));
  }
  const duplicate = structuredClone(p);
  duplicate.resource_changes!.push(duplicate.resource_changes![0]!);
  assert.throws(() => assertRuntimeTeardown(duplicate));
  assert.throws(() => assertRuntimeTeardown({ resource_changes: [] }));
});

test('deleted/hidden state versions cannot be mistaken for a never-initialized runtime', () => {
  assertEmptyRuntimeStateHistory({
    IsTruncated: false,
    Versions: [{ Key: 'demo/terraform.tfstate.tflock' }],
    DeleteMarkers: [{ Key: 'demo/terraform.tfstate.tflock' }],
  });
  for (const history of [
    { IsTruncated: true },
    { Versions: [{ Key: 'demo/terraform.tfstate' }] },
    { DeleteMarkers: [{ Key: 'demo/terraform.tfstate' }] },
  ])
    assert.throws(() => assertEmptyRuntimeStateHistory(history));
});

test('exclusive claims survive failed or unknown operations and synchronize competing invocations', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-d3f-claim-'));
  try {
    let calls = 0;
    const path = resolve(dir, 'attempt.json');
    const results = await Promise.allSettled(
      [0, 1].map(() =>
        claimRuntimeOperation(path, { review: 'fixture' }, () => {
          calls++;
          throw new Error('unknown commit');
        }),
      ),
    );
    assert.equal(calls, 1);
    assert(results.every((r) => r.status === 'rejected'));
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
      review: 'fixture',
    });
    await assert.rejects(
      () =>
        claimRuntimeOperation(path, {}, () => {
          calls++;
        }),
      /already claimed/,
    );
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fixed apply/teardown capabilities accept only saved plans and explicit review IDs', () => {
  const id = `${randomUUID()}:${'a'.repeat(64)}`;
  assert.equal(runtimeReleaseCommand(['plan', d3fPackageId]).operation, 'plan');
  assert.equal(
    runtimeReleaseCommand(['apply', '--reviewed', id]).operation,
    'apply',
  );
  for (const args of [
    [],
    ['apply'],
    ['apply', '--reviewed', `${d3eBaselineRun}:${d3eBaselineHash}`],
    ['plan', 'foreign'],
    ['apply', '--reviewed', id, '-auto-approve'],
    ['destroy'],
    ['force-unlock'],
  ])
    assert.throws(() => runtimeReleaseCommand(args));
  assert.deepEqual(
    runtimeReleaseArgs('apply', {
      plan: '/private/saved.tfplan',
      variables: '',
    }),
    [
      'apply',
      '-input=false',
      '-no-color',
      '-lock-timeout=30s',
      '/private/saved.tfplan',
    ],
  );
  assert(
    runtimeReleaseArgs('teardown-plan', {
      plan: '/private/deletion.tfplan',
      variables: '/private/vars',
    }).includes('-destroy'),
  );
  assert.throws(() =>
    runtimeReleaseArgs('destroy' as 'apply', { plan: '', variables: '' }),
  );
});

test('CLI rejects unreviewed execution, unsafe environment and overrides before AWS or Terraform', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-d3f-cli-')),
    trace = resolve(dir, 'trace');
  try {
    for (const name of ['aws', 'terraform'])
      await writeFile(
        resolve(dir, name),
        '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.MOCK_TRACE,"unexpected");process.exit(99);\n',
        { mode: 0o700 },
      );
    const run = (args: string[], extra = {}) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(__dirname, '../tools/runtime-release.ts'),
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
      ['apply', '--reviewed', `${d3eBaselineRun}:${d3eBaselineHash}`],
      ['inspect', '--region=foreign'],
      ['destroy'],
    ])
      assert.equal(run(args).status, 1);
    for (const extra of [
      { AWS_PROFILE: 'iamadmin-general' },
      { AWS_REGION: 'us-east-1' },
      { AWS_ACCESS_KEY_ID: 'fixture' },
      { TF_CLI_ARGS: '-auto-approve' },
    ])
      assert.equal(run(['inspect'], extra).status, 1);
    await assert.rejects(() => readFile(trace), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
