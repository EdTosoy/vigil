import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialRuntimeAddresses } from '../tools/runtime-plan';
import { assertRuntimeTeardown } from '../tools/runtime-apply-review';
import {
  recoveryAddresses,
  validateRecoveryState,
  validateRecoveryPlan,
  assertRecoveryFresh,
  type RecoveryState,
} from '../tools/runtime-recovery-review';
import { recoveryCommand } from '../tools/runtime-recovery';

function fixture() {
  const state: RecoveryState = {
    serial: 5,
    lineage: 'fixture-lineage',
    resources: recoveryAddresses().map((address) => {
      const m = /^([^.]+)\.([^[]+)(?:\[(.*)\])?$/.exec(address)!;
      const key = m[3] === undefined ? undefined : JSON.parse(m[3]);
      const a: Record<string, unknown> = { id: address };
      if (m[1] === 'aws_ssm_parameter') {
        a['name'] = `/flow/demo/${key}`;
        a['id'] = a['name'];
      }
      if (m[1] === 'aws_ecs_task_definition') {
        a['family'] = `flow-demo-${key}`;
        a['arn'] =
          `arn:aws:ecs:ap-southeast-2:747240980964:task-definition/flow-demo-${key}:3`;
      }
      if (m[1] === 'aws_ecs_cluster')
        a['arn'] = 'arn:aws:ecs:ap-southeast-2:747240980964:cluster/flow-demo';
      if (m[1] === 'aws_lb')
        a['arn'] =
          'arn:aws:elasticloadbalancing:ap-southeast-2:747240980964:loadbalancer/app/flow-demo/fixture';
      if (m[1] === 'aws_acm_certificate')
        a['arn'] =
          'arn:aws:acm:ap-southeast-2:747240980964:certificate/fixture';
      if (m[1] === 'aws_ecs_service') {
        a['name'] = `flow-demo-${key}`;
        a['cluster'] =
          'arn:aws:ecs:ap-southeast-2:747240980964:cluster/flow-demo';
        a['task_definition'] =
          `arn:aws:ecs:ap-southeast-2:747240980964:task-definition/flow-demo-${key}:3`;
      }
      if (m[1] === 'aws_lb_listener') {
        a['arn'] =
          `arn:aws:elasticloadbalancing:ap-southeast-2:747240980964:listener/app/flow-demo/fixture/${m[2]}`;
        a['load_balancer_arn'] =
          'arn:aws:elasticloadbalancing:ap-southeast-2:747240980964:loadbalancer/app/flow-demo/fixture';
      }
      if (m[1] === 'aws_lb_listener_rule')
        a['listener_arn'] =
          'arn:aws:elasticloadbalancing:ap-southeast-2:747240980964:listener/app/flow-demo/fixture/https';
      if (m[1] === 'aws_acm_certificate_validation')
        a['certificate_arn'] =
          'arn:aws:acm:ap-southeast-2:747240980964:certificate/fixture';
      return {
        mode: 'managed',
        type: m[1]!,
        name: m[2]!,
        provider: 'provider["registry.terraform.io/hashicorp/aws"]',
        instances: [
          { ...(key === undefined ? {} : { index_key: key }), attributes: a },
        ],
      };
    }),
  };
  const original = structuredClone(state);
  original.serial = 3;
  original.resources = original.resources.filter((r) =>
    initialRuntimeAddresses().includes(
      `${r.type}.${r.name}${r.instances[0]!.index_key === undefined ? '' : `[${JSON.stringify(r.instances[0]!.index_key)}]`}`,
    ),
  );
  return { state, original };
}
test('only explicit same-lineage 75 serial-3 to 90 serial-5 recovery is accepted; old guard remains closed', () => {
  const { state, original } = fixture();
  assert.equal(validateRecoveryState(state, original).length, 90);
  const plan = {
    resource_changes: recoveryAddresses().map((address) => ({
      address,
      type: address.split('.')[0]!,
      mode: 'managed',
      change: { actions: ['delete'], before: { id: 'fixture' }, after: null },
    })),
  };
  assert.throws(() => assertRuntimeTeardown(plan));
  for (const patch of [{ serial: 6 }, { lineage: 'foreign' }])
    assert.throws(() =>
      validateRecoveryState({ ...state, ...patch }, original),
    );
  const extra = structuredClone(state);
  extra.resources.push({
    ...extra.resources[0]!,
    type: 'aws_s3_bucket',
    name: 'bootstrap',
  });
  assert.throws(() => validateRecoveryState(extra, original));
});
test('foreign IDs/accounts/regions, modules, tainted and unrelated services/parameters are rejected', () => {
  const { state, original } = fixture();
  for (const mutate of [
    (s: RecoveryState) => {
      s.resources[0]!.module = 'module.foreign';
    },
    (s: RecoveryState) => {
      s.resources[0]!.instances[0]!.attributes['id'] = 'replaced';
    },
    (s: RecoveryState) => {
      s.resources[0]!.instances[0]!.deposed = 'old';
    },
    (s: RecoveryState) => {
      s.resources.find(
        (r) => r.type === 'aws_ecs_service',
      )!.instances[0]!.attributes['cluster'] = 'foreign';
    },
    (s: RecoveryState) => {
      s.resources.find(
        (r) => r.type === 'aws_ecs_task_definition',
      )!.instances[0]!.attributes['arn'] =
        'arn:aws:ecs:us-east-1:163596511125:task-definition/flow-demo-admin:3';
    },
    (s: RecoveryState) => {
      s.resources.find(
        (r) => r.type === 'aws_ssm_parameter',
      )!.instances[0]!.attributes['name'] = '/other/secret';
    },
  ]) {
    const bad = structuredClone(state);
    mutate(bad);
    assert.throws(() => validateRecoveryState(bad, original));
  }
});
test('destroy plans must delete exactly the frozen physical inventory, not create, replace or omit resources', () => {
  const { state, original } = fixture();
  const rows = validateRecoveryState(state, original);
  const plan = {
    resource_changes: rows.map((r) => ({
      address: r.address,
      type: r.type,
      mode: 'managed',
      change: { actions: ['delete'], before: r.attributes },
    })),
  };
  assert.equal(validateRecoveryPlan(plan, state).deletes, 90);
  for (const action of [
    ['create'],
    ['update'],
    ['no-op'],
    ['delete', 'create'],
  ]) {
    const bad = structuredClone(plan);
    bad.resource_changes[0]!.change.actions = action;
    assert.throws(() => validateRecoveryPlan(bad, state));
  }
  const drift = structuredClone(plan);
  drift.resource_changes[0]!.change.before['id'] = 'foreign';
  assert.throws(() => validateRecoveryPlan(drift, state));
  assert.throws(() =>
    validateRecoveryPlan(
      { resource_changes: plan.resource_changes.slice(1) },
      state,
    ),
  );
});
test('stale/future reviews and changed state versions are refused; CLI has no execution capability', () => {
  const now = Date.now(),
    version = { versionId: 'v5', etag: 'same' };
  assertRecoveryFresh(new Date(now).toISOString(), version, version, now);
  for (const time of [now - 900001, now + 1])
    assert.throws(() =>
      assertRecoveryFresh(new Date(time).toISOString(), version, version, now),
    );
  assert.throws(() =>
    assertRecoveryFresh(
      new Date(now).toISOString(),
      version,
      { versionId: 'v6' },
      now,
    ),
  );
  assert.equal(recoveryCommand(['plan']).operation, 'plan');
  for (const cmd of [
    [],
    ['apply'],
    ['destroy'],
    ['plan', '-lock=false'],
    ['review', '--reviewed', '../../foreign'],
  ])
    assert.throws(() => recoveryCommand(cmd));
});
