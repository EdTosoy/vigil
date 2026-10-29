import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  cp,
  writeFile,
  readFile,
  rm,
  lstat,
  readdir,
  chmod,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { deploymentSourceNames } from '../tools/deployment-sources';
import { deployment } from '../tools/deployment-guards';
import {
  runtimeCycle,
  runtimeCycleStore,
  runtimeCycleCommand,
  cycleHash,
  type CycleDriver,
} from '../tools/runtime-cycle';
import {
  assertCycleStart,
  assertCycleOperatorChecks,
  unverifiedBudgetAlertWarning,
  assertCycleState,
  assertCyclePlan,
  assertCycleBindings,
  cycleAddresses,
  cycleInstances,
  type CycleState,
  type CycleStage,
  type CyclePlan,
  type CycleBindings,
} from '../tools/runtime-cycle-review';
import type { RecoveryState } from '../tools/runtime-recovery-review';

const images = Object.fromEntries(
  ['admin', 'ops', 'stripe'].map((k) => [
    k,
    `${deployment.account}.dkr.ecr.${deployment.region}.amazonaws.com/flow-demo/${k}@sha256:${'a'.repeat(64)}`,
  ]),
);

test('UNKNOWN budget delivery requires explicit acknowledgement and preserves every operator cost gate', () => {
  const id = randomUUID(),
    now = Date.now();
  const approval = {
    cycle: id,
    observedAt: new Date(now).toISOString(),
    budgetAlertDeliveryStatus: 'UNKNOWN',
    budgetAlertDeliveryConfirmed: false,
    unverifiedBudgetAlertDeliveryAcknowledged: true,
    accountWideSpendReviewed: true,
    fourHourCleanupWindowConfirmed: true,
  };
  assert.equal(assertCycleOperatorChecks(approval, id, now), 'UNKNOWN');
  for (const patch of [
    { unverifiedBudgetAlertDeliveryAcknowledged: false },
    { unverifiedBudgetAlertDeliveryAcknowledged: 'true' },
    { budgetAlertDeliveryStatus: undefined },
    { budgetAlertDeliveryStatus: 'FAILED' },
    { budgetAlertDeliveryConfirmed: true },
    { accountWideSpendReviewed: false },
    { fourHourCleanupWindowConfirmed: false },
    { observedAt: new Date(now - 900001).toISOString() },
    { observedAt: new Date(now + 1).toISOString() },
    { observedAt: 'invalid' },
    { cycle: randomUUID() },
  ])
    assert.throws(() =>
      assertCycleOperatorChecks({ ...approval, ...patch }, id, now),
    );
  assert.equal(
    assertCycleOperatorChecks(
      {
        ...approval,
        budgetAlertDeliveryStatus: 'CONFIRMED',
        budgetAlertDeliveryConfirmed: true,
        unverifiedBudgetAlertDeliveryAcknowledged: false,
      },
      id,
      now,
    ),
    'CONFIRMED',
  );
  assert.equal(
    assertCycleOperatorChecks(
      {
        cycle: id,
        observedAt: approval.observedAt,
        budgetAlertDeliveryConfirmed: true,
        accountWideSpendReviewed: true,
        fourHourCleanupWindowConfirmed: true,
      },
      id,
      now,
    ),
    'CONFIRMED',
  );
  assert.match(unverifiedBudgetAlertWarning, /UNKNOWN/);
  assert.match(unverifiedBudgetAlertWarning, /do not cap spending/);
  assert.match(unverifiedBudgetAlertWarning, /four hours/);
});

test('operator CLI requires a deliberate delivery choice plus spend and four-hour acknowledgements', () => {
  const id = randomUUID();
  const args = [
    'operator-checks',
    id,
    '--acknowledge-unverified-budget-alert-delivery',
    '--account-spend-reviewed',
    '--cleanup-window-confirmed',
  ];
  const command = runtimeCycleCommand(args);
  assert.equal(command.operation, 'operator-checks');
  if (command.operation === 'operator-checks')
    assert.equal(command.deliveryStatus, 'UNKNOWN');
  for (const bad of [
    args.slice(0, -1),
    [...args, '--budget-alert-delivery-confirmed'],
    args.map((x) => (x === '--cleanup-window-confirmed' ? '--continuous' : x)),
    args.map((x) =>
      x === '--acknowledge-unverified-budget-alert-delivery'
        ? '--skip-alerts'
        : x,
    ),
  ])
    assert.throws(() => runtimeCycleCommand(bad));
});
const taskArn = `arn:aws:ecs:${deployment.region}:${deployment.account}:task/flow-demo/${'a'.repeat(32)}`;
const tags = {
  Project: 'vigil',
  Environment: 'demo',
  Lifecycle: 'ephemeral',
  DeploymentAccount: deployment.account,
  DeploymentRegion: deployment.region,
};
function attributes(
  address: string,
  stage: CycleStage,
  physical = 1,
): Record<string, unknown> {
  const base = address.split('[')[0]!,
    type = base.split('.')[0]!,
    key = address.includes('[')
      ? JSON.parse(address.slice(address.indexOf('[') + 1, -1))
      : '';
  const a: Record<string, unknown> = {
    id: `fixture-${physical}-${cycleHash(address).slice(0, 10)}`,
    tags_all: tags,
  };
  if (type === 'aws_iam_role')
    Object.assign(a, {
      name: `flow-demo-${key}-${base.endsWith('.execution') ? 'execution' : 'task'}`,
      id: `flow-demo-${key}-${base.endsWith('.execution') ? 'execution' : 'task'}`,
    });
  if (type === 'aws_iam_role_policy')
    Object.assign(a, {
      name: 'flow-demo-execution',
      role: `flow-demo-${key}-execution`,
    });
  if (type === 'aws_ssm_parameter')
    Object.assign(a, {
      name: `/flow/demo/${key}`,
      id: `/flow/demo/${key}`,
      type: 'SecureString',
      value: '',
    });
  if (type === 'aws_db_instance')
    Object.assign(a, {
      id: 'flow-demo',
      identifier: 'flow-demo',
      resource_id: `db-PHYSICAL${physical}`,
      address: `flow-demo.physical${physical}.ap-southeast-2.rds.amazonaws.com`,
      db_name: 'flow',
      publicly_accessible: false,
      multi_az: false,
      storage_encrypted: true,
      instance_class: 'db.t4g.micro',
      backup_retention_period: 0,
      deletion_protection: false,
      skip_final_snapshot: true,
    });
  if (type === 'aws_ecs_cluster')
    Object.assign(a, {
      name: 'flow-demo',
      arn: `arn:aws:ecs:${deployment.region}:${deployment.account}:cluster/flow-demo`,
    });
  if (type === 'aws_acm_certificate')
    Object.assign(a, {
      domain_name: deployment.domain,
      arn: `arn:aws:acm:${deployment.region}:${deployment.account}:certificate/${randomUUID()}`,
      status: 'PENDING_VALIDATION',
    });
  if (type === 'aws_lb')
    Object.assign(a, {
      name: 'flow-demo',
      arn: `arn:aws:elasticloadbalancing:${deployment.region}:${deployment.account}:loadbalancer/app/flow-demo/${physical}`,
      dns_name: `flow-demo-${physical}.ap-southeast-2.elb.amazonaws.com`,
    });
  if (type === 'aws_ecs_task_definition')
    Object.assign(a, {
      family: `flow-demo-${key}`,
      arn: `arn:aws:ecs:${deployment.region}:${deployment.account}:task-definition/flow-demo-${key}:${physical}`,
    });
  if (type === 'aws_ecs_service')
    Object.assign(a, {
      name: `flow-demo-${key}`,
      cluster: `arn:aws:ecs:${deployment.region}:${deployment.account}:cluster/flow-demo`,
      task_definition: `arn:aws:ecs:${deployment.region}:${deployment.account}:task-definition/flow-demo-${key}:${physical}`,
      desired_count: stage === 'active' ? 1 : 0,
    });
  if (type === 'aws_lb_listener')
    Object.assign(a, {
      load_balancer_arn: `arn:aws:elasticloadbalancing:${deployment.region}:${deployment.account}:loadbalancer/app/flow-demo/${physical}`,
      arn: `arn:aws:elasticloadbalancing:${deployment.region}:${deployment.account}:listener/app/flow-demo/${physical}/${base.endsWith('.https') ? 'https' : 'http'}`,
    });
  if (type === 'aws_lb_listener_rule')
    Object.assign(a, {
      listener_arn: `arn:aws:elasticloadbalancing:${deployment.region}:${deployment.account}:listener/app/flow-demo/${physical}/https`,
    });
  return a;
}
function snapshotFrom(
  rows: { address: string; attributes: Record<string, unknown> }[],
  serial = 1,
  lineage: string = randomUUID(),
): CycleState {
  const state: RecoveryState = { serial, lineage, resources: [] };
  for (const r of rows) {
    const [type, name] = r.address.split('[')[0]!.split('.');
    let group = state.resources.find((x) => x.type === type && x.name === name);
    if (!group) {
      group = {
        mode: 'managed',
        type: type!,
        name: name!,
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [],
      };
      state.resources.push(group);
    }
    group.instances.push({
      attributes: r.attributes,
      ...(r.address.includes('[')
        ? {
            index_key: JSON.parse(
              r.address.slice(r.address.indexOf('[') + 1, -1),
            ),
          }
        : {}),
    });
  }
  const json = JSON.stringify(state);
  return {
    versionId: `version-${serial}`,
    etag: `"etag-${serial}"`,
    sha256: cycleHash(json),
    state,
  };
}
function planFor(
  snapshot: CycleState,
  stage: CycleStage,
  physical = 1,
): CyclePlan {
  const old = cycleInstances(snapshot);
  const addresses =
    stage === 'teardown' ? old.map((r) => r.address) : cycleAddresses(stage);
  const cert =
    old.find((r) => r.address === 'aws_acm_certificate.demo')?.attributes ??
    attributes('aws_acm_certificate.demo', stage, physical);
  return {
    complete: true,
    resource_changes: addresses.map((address) => {
      const before = old.find((r) => r.address === address)?.attributes;
      const after = before
        ? structuredClone(before)
        : attributes(address, stage, physical);
      if (address === 'aws_acm_certificate.demo') Object.assign(after, cert);
      if (address === 'aws_acm_certificate_validation.demo[0]')
        after['certificate_arn'] = cert['arn'];
      if (address.startsWith('aws_ecs_service.'))
        after['desired_count'] = stage === 'active' ? 1 : 0;
      return {
        address,
        type: address.split('.')[0]!,
        mode: 'managed',
        change: {
          actions:
            stage === 'teardown'
              ? ['delete']
              : !before
                ? ['create']
                : JSON.stringify(after) !== JSON.stringify(before)
                  ? ['update']
                  : ['no-op'],
          before: before ?? null,
          after: stage === 'teardown' ? null : after,
        },
      };
    }),
  };
}
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'vigil-cycle-'));
  await mkdir(resolve(root, 'infra/demo/tests'), { recursive: true });
  await mkdir(resolve(root, 'tools'));
  await writeFile(resolve(root, 'tools/runtime-cycle.ts'), 'fixture executor');
  for (const n of deploymentSourceNames('demo'))
    await cp(
      resolve(__dirname, '../infra/demo', n),
      resolve(root, 'infra/demo', n),
    );
  let state = snapshotFrom([], 10),
    physical = 0,
    inventory: string[] = [],
    inputId = '';
  let failApply = false,
    loseAfterCommit = false,
    failBindings = false;
  let planSerial = 0;
  const plans = new Map<string, CyclePlan>();
  const calls: {
    operation: string;
    args?: string[];
    secrets?: Record<string, string>;
  }[] = [];
  const driver: CycleDriver = {
    readiness: async (cleanup) => {
      calls.push({ operation: cleanup ? 'cleanup-readiness' : 'readiness' });
    },
    snapshot: async () => structuredClone(state),
    inventory: async () => inventory,
    images: async () => structuredClone(images),
    account: async () => 'acct_current',
    async terraform(a, args, secrets) {
      calls.push({ operation: args[0]!, args, secrets });
      if (args[0] === 'plan') {
        const variables = JSON.parse(
          await readFile(
            args.find((v) => v.startsWith('-var-file='))!.slice(10),
            'utf8',
          ),
        );
        const stage: CycleStage = args.includes('-destroy')
          ? 'teardown'
          : variables.initial_infrastructure_only
            ? 'infrastructure'
            : variables.start_services
              ? 'active'
              : variables.certificate_dns_confirmed
                ? 'https'
                : 'provisioning';
        const plan = planFor(
          state,
          stage,
          stage === 'infrastructure' ? physical + 1 : physical,
        );
        const target = args.find((v) => v.startsWith('-out='))!.slice(5);
        plans.set(target, plan);
        await writeFile(target, `saved-plan-${++planSerial}`, { mode: 0o600 });
      }
      if (args[0] === 'show') return JSON.stringify(plans.get(args[2]!));
      if (args[0] === 'apply') {
        if (failApply) throw new Error('fixture before commit failure');
        const plan = plans.get(args.at(-1)!)!;
        const wasEmpty = cycleInstances(state).length === 0;
        const rows = plan
          .resource_changes!.filter((r) => r.change.after)
          .map((r) => ({ address: r.address, attributes: r.change.after! }));
        if (wasEmpty) physical++;
        state = snapshotFrom(rows, state.state.serial + 1, state.state.lineage);
        if (loseAfterCommit) throw new Error('fixture lost commit response');
      }
      return '';
    },
    dns: async () => {
      calls.push({ operation: 'dns' });
    },
    destination: async () => {
      calls.push({ operation: 'destination' });
    },
    registerDestination: async () => ({
      id: 'we_current',
      secret: 'whsec_' + 'b'.repeat(32),
    }),
    retireDestination: async () => {
      calls.push({ operation: 'retire-destination' });
    },
    oneShots: async () => ['fixture-owned-task'],
    stopOneShots: async (_s, tasks) => {
      assert.deepEqual(tasks, ['fixture-owned-task']);
      calls.push({ operation: 'stop-owned-one-shots' });
    },
    provision: async () => ({
      taskArn,
      receipt: {
        operation: 'cloud-provision',
        outcome: 'PASS',
        permissions: 'PASS',
        applicationAuth: 'PASS',
        stripeBookId: (await runtimeCycleStore(root, inputId).load()).bookId,
        sourceAccountId: randomUUID(),
        syntheticBookId: randomUUID(),
      },
    }),
    bindings: async () => {
      calls.push({ operation: 'bindings' });
      if (failBindings) throw new Error('Current binding check failed');
    },
    proof: async () => {
      calls.push({ operation: 'proof' });
    },
  };
  async function prepare() {
    const id = randomUUID(),
      store = runtimeCycleStore(root, id);
    await store.prepare();
    await store.set('admin_email', 'admin@example.test');
    await store.set('stripe_key', 'sk_test_' + 'a'.repeat(32));
    inputId = id;
    return { id, store, workflow: () => runtimeCycle(root, id, driver) };
  }
  return {
    root,
    driver,
    calls,
    prepare,
    state: () => state,
    setState: (s: CycleState) => {
      state = s;
    },
    setInventory: (v: string[]) => {
      inventory = v;
    },
    fail: (v: boolean) => {
      failApply = v;
    },
    lose: (v: boolean) => {
      loseAfterCommit = v;
    },
    failBindings: (v: boolean) => {
      failBindings = v;
    },
    plans,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('two full attended cycles retain one lineage, old claims and all activated teardown resources', async () => {
  const f = await fixture();
  try {
    const lineage = f.state().state.lineage,
      old = resolve(
        f.root,
        '.deployment/747240980964/ap-southeast-2/demo/first-runtime-apply-attempt.json',
      );
    await mkdir(resolve(old, '..'), { recursive: true, mode: 0o700 });
    await writeFile(old, 'historical-claim', { mode: 0o600 });
    const cycles: Awaited<ReturnType<typeof f.prepare>>[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await f.prepare();
      cycles.push(c);
      for (const stage of [
        'infrastructure',
        'provisioning',
        'https',
        'active',
      ] as const) {
        if (stage === 'https') await (await c.workflow()).provision();
        if (stage === 'active') {
          await (await c.workflow()).destination();
        }
        const review = await (await c.workflow()).plan(stage);
        await (await c.workflow()).apply(review.reviewId);
      }
      await (await c.workflow()).verify();
      const final = cycleInstances(f.state());
      assert.equal(final.length, 92);
      assert(
        final.some(
          (r) => r.address === 'aws_ssm_parameter.runtime["auth_url"]',
        ),
      );
      assert(final.some((r) => r.address === 'aws_lb_listener.https[0]'));
      const teardown = await (await c.workflow()).plan('teardown');
      assert.equal(teardown.deletes, final.length);
      await (await c.workflow()).apply(teardown.reviewId);
      await (await c.workflow()).verifyTeardown();
      await (await c.workflow()).retireDestination();
      assert.equal(cycleInstances(f.state()).length, 0);
      assert.equal(f.state().state.lineage, lineage);
      assert.equal(await readFile(old, 'utf8'), 'historical-claim');
    }
    assert.notEqual(cycles[0]!.id, cycles[1]!.id);
    const [first, second] = await Promise.all(
      cycles.map((c) => c.store.load()),
    );
    assert(first && second);
    assert.notEqual(first.bookId, second.bookId);
    assert.notEqual(first.values['auth_secret'], second.values['auth_secret']);
    assert.notEqual(
      first.values['admin_password'],
      second.values['admin_password'],
    );
    assert(!('database' in second) && !('bindings' in second));
    const claims = await readdir(
      resolve(
        f.root,
        '.deployment/747240980964/ap-southeast-2/demo/cycle-claims',
      ),
    );
    assert.equal(claims.length, 2);
    const destroyPlans = f.calls.filter(
      (c) => c.operation === 'plan' && c.args!.includes('-destroy'),
    );
    assert.equal(destroyPlans.length, 2);
    assert(
      destroyPlans.every((c) =>
        c.secrets!['webhook_secrets']?.startsWith('whsec_'),
      ),
      'teardown retains active ephemeral values',
    );
    assert(
      f.calls
        .filter((c) => c.operation === 'apply')
        .every(
          (c) =>
            c.args!.length === 4 &&
            !c.args!.some((a) => a.startsWith('-var') || a === '-auto-approve'),
        ),
    );
    assert.equal(
      (await lstat(cycles[0]!.store.path('inputs.json'))).mode & 0o777,
      0o600,
    );
    assert.equal(f.calls.filter((c) => c.operation === 'proof').length, 2);
  } finally {
    await f.cleanup();
  }
});

test('empty state history is accepted only with absent resources, and competing cycles cannot claim it', async () => {
  const f = await fixture();
  try {
    const c = await f.prepare();
    await chmod(c.store.context.path(`cycles/${c.id}`), 0o755);
    await assert.rejects(c.store.load(), /remain private/);
    await chmod(c.store.context.path(`cycles/${c.id}`), 0o700);
    f.setInventory(['orphan-runtime']);
    await assert.rejects(
      (await c.workflow()).plan('infrastructure'),
      /verified absent/,
    );
    f.setInventory([]);
    await (await c.workflow()).plan('infrastructure');
    const other = await f.prepare();
    await assert.rejects(
      (await other.workflow()).plan('infrastructure'),
      /already claimed/,
    );
    const replan = await (await c.workflow()).plan('infrastructure');
    assert(replan.reviewId);
    assertCycleStart(f.state(), []);
    assert.throws(() => assertCycleStart(f.state(), ['orphan']));
  } finally {
    await f.cleanup();
  }
});

test('competing saved plans consume one state claim and execute at most one apply', async () => {
  const f = await fixture();
  try {
    const c = await f.prepare();
    const first = await (await c.workflow()).plan('infrastructure');
    const second = await (await c.workflow()).plan('infrastructure');
    const snapshot = f.driver.snapshot;
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.driver.snapshot = async () => {
      const observed = await snapshot();
      arrivals++;
      if (arrivals <= 2) {
        if (arrivals === 2) release();
        await barrier;
      }
      return observed;
    };
    const outcomes = await Promise.allSettled([
      c.workflow().then((w) => w.apply(first.reviewId)),
      c.workflow().then((w) => w.apply(second.reviewId)),
    ]);
    assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(f.calls.filter((c) => c.operation === 'apply').length, 1);
    assert(
      arrivals >= 2,
      'Both contenders observed the same state before claiming',
    );
  } finally {
    await f.cleanup();
  }
});

test('state/lineage drift, expired reviews, changed inputs and changed source prevent apply', async () => {
  for (const problem of [
    'state',
    'lineage',
    'expiry',
    'inputs',
    'source',
    'backend',
    'plan',
  ]) {
    const f = await fixture();
    try {
      const c = await f.prepare(),
        p = await (await c.workflow()).plan('infrastructure');
      const run = p.reviewId.split(':')[0]!,
        prefix = resolve(c.store.context.base, 'plan-preparation', run);
      if (problem === 'state')
        f.setState({ ...f.state(), versionId: 'changed' });
      if (problem === 'lineage')
        f.setState({
          ...f.state(),
          state: { ...f.state().state, lineage: randomUUID() },
        });
      if (problem === 'expiry') {
        const p = resolve(prefix, 'cycle-review.json');
        const r = JSON.parse(await readFile(p, 'utf8'));
        r.createdAt = new Date(Date.now() - 900001).toISOString();
        await writeFile(p, JSON.stringify(r), { mode: 0o600 });
      }
      if (problem === 'inputs') {
        const c0 = await c.store.load();
        c0.values['auth_secret'] = 'z'.repeat(48);
        await writeFile(c.store.path('inputs.json'), JSON.stringify(c0), {
          mode: 0o600,
        });
      }
      if (problem === 'source')
        await writeFile(
          resolve(f.root, 'infra/demo/compute.tf'),
          'changed source',
        );
      if (problem === 'backend') {
        const p = resolve(prefix, 'backend.json');
        const r = JSON.parse(await readFile(p, 'utf8'));
        r.assume_role.role_arn = 'foreign';
        await writeFile(p, JSON.stringify(r), { mode: 0o600 });
      }
      if (problem === 'plan')
        await writeFile(resolve(prefix, 'cycle.tfplan'), 'changed saved plan', {
          mode: 0o600,
        });
      await assert.rejects((await c.workflow()).apply(p.reviewId));
      assert(!f.calls.some((c) => c.operation === 'apply'), problem);
    } finally {
      await f.cleanup();
    }
  }
});

test('unknown apply consumes its claim; cleanup plans actual partial/current state and can be separately re-reviewed', async () => {
  const f = await fixture();
  try {
    const c = await f.prepare(),
      p = await (await c.workflow()).plan('infrastructure');
    f.lose(true);
    await assert.rejects(
      (await c.workflow()).apply(p.reviewId),
      /outcome unknown/,
    );
    assert(cycleInstances(f.state()).length > 0);
    await assert.rejects((await c.workflow()).apply(p.reviewId));
    assert.equal(f.calls.filter((c) => c.operation === 'apply').length, 1);
    await assert.rejects(
      (await c.workflow()).plan('provisioning'),
      /did not complete/,
    );
    f.lose(false);
    f.fail(true);
    const d = await (await c.workflow()).plan('teardown');
    await assert.rejects(
      (await c.workflow()).apply(d.reviewId),
      /outcome unknown/,
    );
    await assert.rejects((await c.workflow()).apply(d.reviewId));
    f.fail(false);
    const fresh = await (await c.workflow()).plan('teardown');
    await (await c.workflow()).apply(fresh.reviewId);
    await (await c.workflow()).verifyTeardown();
    assert.equal(cycleInstances(f.state()).length, 0);
    const attempt = JSON.parse(
      await readFile(c.store.path('infrastructure-result.json'), 'utf8'),
    );
    assert.equal(attempt.status, 'FAILED_OR_UNKNOWN');
  } finally {
    await f.cleanup();
  }
});

test('activation requires current narrow binding proof and webhook inputs; no arbitrary UUID or old endpoint fallback', async () => {
  const f = await fixture();
  try {
    const c = await f.prepare();
    for (const stage of ['infrastructure', 'provisioning'] as const) {
      const p = await (await c.workflow()).plan(stage);
      await (await c.workflow()).apply(p.reviewId);
    }
    await assert.rejects((await c.workflow()).plan('active'));
    await assert.rejects((await c.workflow()).plan('https'), /ENOENT/);
    await (await c.workflow()).provision();
    f.failBindings(true);
    await assert.rejects(
      (await c.workflow()).plan('https'),
      /binding check failed/,
    );
    f.failBindings(false);
    const https = await (await c.workflow()).plan('https');
    await (await c.workflow()).apply(https.reviewId);
    await assert.rejects((await c.workflow()).plan('active'), /signing secret/);
    await c.store.set('webhook_endpoint', 'we_manual');
    await c.store.set('webhook_secrets', 'whsec_' + 'b'.repeat(32));
    await assert.rejects(
      (await c.workflow()).plan('active'),
      /ENOENT/,
      'Syntax alone does not establish signing-secret provenance',
    );
    const changed = structuredClone(f.state());
    const db = changed.state.resources.find(
      (r) => r.type === 'aws_db_instance',
    )!.instances[0]!.attributes;
    db['resource_id'] = 'db-REPLACED';
    f.setState(changed);
    await c.store.set('webhook_endpoint', 'we_current');
    await c.store.set('webhook_secrets', 'whsec_' + 'b'.repeat(32));
    await assert.rejects(
      (await c.workflow()).plan('active'),
      /Database was replaced/,
    );
    assert(!f.calls.some((c) => c.operation === 'destination'));
  } finally {
    await f.cleanup();
  }
});

test('complete teardown rejects omission, foreign/bootstrap IAM, replacement and refreshed physical identity', () => {
  const empty = snapshotFrom([]),
    p = planFor(empty, 'active');
  const s = snapshotFrom(
    p.resource_changes!.map((r) => ({
      address: r.address,
      attributes: r.change.after!,
    })),
  );
  const d = planFor(s, 'teardown');
  assert.equal(assertCyclePlan(d, s, 'teardown').deletes, 92);
  for (const modify of [
    (p: CyclePlan) => {
      p.resource_changes!.pop();
    },
    (p: CyclePlan) => {
      p.resource_changes![0]!.change.actions = ['delete', 'create'];
    },
    (p: CyclePlan) => {
      p.resource_changes![0]!.change.before = { id: 'foreign-id' };
    },
    (p: CyclePlan) => {
      p.resource_changes!.push({
        ...p.resource_changes![0]!,
        address: 'aws_s3_bucket.state',
        type: 'aws_s3_bucket',
      });
    },
    (p: CyclePlan) => {
      p.resource_changes!.push({
        ...p.resource_changes![0]!,
        address: 'aws_iam_role.state_backend',
        type: 'aws_iam_role',
      });
    },
    (p: CyclePlan) => {
      p.complete = false;
    },
  ]) {
    const bad = structuredClone(d);
    modify(bad);
    assert.throws(() => assertCyclePlan(bad, s, 'teardown'));
  }
  const drift = structuredClone(d);
  drift.resource_drift = [
    {
      address: 'aws_db_instance.demo',
      change: {
        actions: ['update'],
        before: { id: 'flow-demo' },
        after: { id: 'foreign' },
      },
    },
  ];
  assert.throws(() => assertCyclePlan(drift, s, 'teardown'));
  const certDrift = structuredClone(d);
  certDrift.resource_drift = [
    {
      address: 'aws_acm_certificate.demo',
      change: {
        actions: ['update'],
        before: { id: 'same', status: 'PENDING_VALIDATION' },
        after: { id: 'same', status: 'ISSUED' },
      },
    },
  ];
  assertCyclePlan(certDrift, s, 'teardown');
  assert.throws(() => assertCycleState(s, { ...s, versionId: 'other' }));
});

test('a provisioning receipt must bind the current RDS physical identity, state, source and distinct books', () => {
  const p = planFor(snapshotFrom([]), 'provisioning');
  const s = snapshotFrom(
    p.resource_changes!.map((r) => ({
      address: r.address,
      attributes: r.change.after!,
    })),
  );
  const b: CycleBindings = {
    state: { versionId: s.versionId, etag: s.etag, sha256: s.sha256 },
    databaseId: 'flow-demo',
    databaseResourceId: 'db-PHYSICAL1',
    databaseAddress: 'flow-demo.physical1.ap-southeast-2.rds.amazonaws.com',
    taskArn,
    taskDefinition: `arn:aws:ecs:${deployment.region}:${deployment.account}:task-definition/flow-demo-admin:1`,
    stripeBookId: randomUUID(),
    sourceAccountId: randomUUID(),
    syntheticBookId: randomUUID(),
    accountId: 'acct_current',
    applicationAuth: 'PASS',
  };
  assertCycleBindings(b, s, b.stripeBookId, b.accountId);
  for (const patch of [
    { databaseResourceId: 'db-OLD' },
    { databaseAddress: 'flow-demo.old.us-east-1.rds.amazonaws.com' },
    { state: { ...b.state, versionId: 'old' } },
    { applicationAuth: 'NOT_CONFIGURED' },
    { syntheticBookId: b.stripeBookId },
    { accountId: 'acct_old' },
    { sourceAccountId: 'invented' },
    { taskArn: taskArn.replace(deployment.account, '163596511125') },
  ])
    assert.throws(() =>
      assertCycleBindings(
        { ...b, ...patch } as CycleBindings,
        s,
        b.stripeBookId,
        b.accountId,
      ),
    );
});

test('CLI declines cloud actions and unsafe environments before any AWS, Terraform, secret or publication operation', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-cycle-cli-')),
    trace = resolve(dir, 'trace');
  try {
    for (const name of ['aws', 'terraform', 'docker'])
      await writeFile(
        resolve(dir, name),
        '#!/bin/sh\nprintf called >> "$MOCK_TRACE"\nexit 99\n',
        { mode: 0o700 },
      );
    const env = {
      PATH: `${dir}:${process.env['PATH']}`,
      HOME: process.env['HOME'],
      AWS_PROFILE: 'edtosoy',
      AWS_REGION: 'ap-southeast-2',
      MOCK_TRACE: trace,
    };
    for (const args of [
      [],
      ['plan', randomUUID(), 'infrastructure'],
      [
        'apply',
        randomUUID(),
        '--reviewed',
        `${randomUUID()}:${'a'.repeat(64)}`,
      ],
      ['destroy'],
      ['force-unlock'],
    ]) {
      assert.throws(() => runtimeCycleCommand(args));
      const r = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(__dirname, '../tools/runtime-cycle.ts'),
          ...args,
        ],
        { env, encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(r.status, 1);
      assert.doesNotMatch(r.stdout, /password|sk_test_|whsec_/);
    }
    for (const override of [
      { AWS_PROFILE: 'iamadmin-general' },
      { AWS_REGION: 'us-east-1' },
      { AWS_ACCESS_KEY_ID: 'fixture' },
      { TF_CLI_ARGS: '-lock=false' },
    ]) {
      const r = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(__dirname, '../tools/runtime-cycle.ts'),
          'plan',
          randomUUID(),
          'infrastructure',
          '--cloud-approved',
        ],
        { env: { ...env, ...override }, encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(r.status, 1);
    }
    await assert.rejects(readFile(trace), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
