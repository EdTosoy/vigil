/** Sydney cycle rules. No AWS calls, state writes or financial interpretation. */
import { isDeepStrictEqual } from 'node:util';
import {
  deployment,
  assertDemoPlan,
  assertDeploymentImage,
} from './deployment-guards';
import { initialRuntimeAddresses } from './runtime-plan';
import { releaseProof as proof } from './runtime-apply-review';
import { stateInstances, type RecoveryState } from './runtime-recovery-review';

export const unverifiedBudgetAlertWarning =
  'WARNING: AWS budget email delivery is UNKNOWN. AWS budget alerts do not cap spending. Monitor gross spend and complete manual teardown within four hours.';

export function assertCycleOperatorChecks(
  approval: Record<string, unknown>,
  id: string,
  now = Date.now(),
) {
  const age = now - Date.parse(String(approval['observedAt']));
  const status =
    approval['budgetAlertDeliveryStatus'] ??
    (approval['budgetAlertDeliveryConfirmed'] === true
      ? 'CONFIRMED'
      : undefined);
  const deliveryAccepted =
    status === 'CONFIRMED'
      ? approval['budgetAlertDeliveryConfirmed'] === true
      : status === 'UNKNOWN' &&
        approval['budgetAlertDeliveryConfirmed'] !== true &&
        approval['unverifiedBudgetAlertDeliveryAcknowledged'] === true;
  proof(
    approval['cycle'] === id &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= 900000 &&
      deliveryAccepted &&
      approval['accountWideSpendReviewed'] === true &&
      approval['fourHourCleanupWindowConfirmed'] === true,
    'Fresh operator alert-delivery status/acknowledgement, spend review and four-hour cleanup checks required',
  );
  return status as 'CONFIRMED' | 'UNKNOWN';
}

export type CycleStage =
  'infrastructure' | 'provisioning' | 'https' | 'active' | 'teardown';
export const cycleStages: CycleStage[] = [
  'infrastructure',
  'provisioning',
  'https',
  'active',
  'teardown',
];
export const cycleParameters = [
  'admin_url',
  'provisioning',
  'stripe_key',
  'webhook_secrets',
  'operations_url',
  'ingress_url',
  'stripeworker_url',
  'auth_url',
  'auth_secret',
  'admin_email',
  'seed_password',
];
export const cycleCapabilities = [
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
  'auth',
  'authSeed',
];
export const cycleTarget = {
  account: deployment.account,
  region: deployment.region,
  profile: deployment.profile,
  hostname: deployment.domain,
};
export const cycleUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export function cycleId(id: string) {
  proof(cycleUuid(id), 'Exact cycle UUID required');
  return id;
}

export interface CycleState {
  versionId: string;
  etag: string;
  sha256: string;
  state: RecoveryState;
}
export interface CycleBindings {
  state: Pick<CycleState, 'versionId' | 'etag' | 'sha256'>;
  databaseId: string;
  databaseResourceId: string;
  databaseAddress: string;
  taskArn: string;
  taskDefinition: string;
  stripeBookId: string;
  sourceAccountId: string;
  syntheticBookId: string;
  accountId: string;
  applicationAuth: 'PASS';
}
export function cycleAddresses(stage: CycleStage) {
  const addresses = initialRuntimeAddresses();
  if (stage !== 'infrastructure') {
    addresses.push(
      ...cycleParameters
        .filter(
          (k) =>
            k !== 'admin_url' &&
            (stage === 'active' ||
              stage === 'teardown' ||
              k !== 'webhook_secrets'),
        )
        .map((k) => `aws_ssm_parameter.runtime["${k}"]`),
    );
  }
  if (['https', 'active', 'teardown'].includes(stage))
    addresses.push(
      ...['ops', 'ingress', 'worker'].map((k) => `aws_ecs_service.app["${k}"]`),
      'aws_acm_certificate_validation.demo[0]',
      'aws_lb_listener.http[0]',
      'aws_lb_listener.https[0]',
      'aws_lb_listener_rule.stripe[0]',
    );
  return addresses.sort();
}
export function cycleInstances(snapshot: CycleState) {
  proof(
    snapshot.versionId &&
      snapshot.etag &&
      /^[a-f0-9]{64}$/.test(snapshot.sha256) &&
      cycleUuid(snapshot.state.lineage) &&
      Number.isSafeInteger(snapshot.state.serial) &&
      snapshot.state.serial >= 0,
    'Versioned state, lineage and serial required',
  );
  const instances = stateInstances(snapshot.state);
  const allowed = new Set(cycleAddresses('teardown'));
  proof(
    new Set(instances.map((r) => r.address)).size === instances.length,
    'Duplicate physical state instance',
  );
  const indexed = Object.fromEntries(
    instances.map((r) => [r.address, r.attributes]),
  );
  for (const r of instances) {
    const a = r.attributes;
    proof(
      allowed.has(r.address) &&
        r.address.startsWith(r.type + '.') &&
        typeof a['id'] === 'string' &&
        a['id'],
      'Foreign runtime address or missing physical identity',
    );
    for (const key of ['arn', 'certificate_arn']) {
      if (typeof a[key] !== 'string' || !a[key].startsWith('arn:')) continue;
      const m = /^arn:aws:([^:]+):([^:]*):(\d{12}):/.exec(a[key]);
      proof(
        m &&
          m[3] === deployment.account &&
          m[2] === (m[1] === 'iam' ? '' : deployment.region),
        'Foreign runtime account/region',
      );
    }
    const untagged = [
      'aws_iam_role_policy',
      'aws_route',
      'aws_route_table_association',
      'aws_acm_certificate_validation',
    ].includes(r.type);
    if (!untagged || a['tags_all']) {
      proof(a['tags_all'], 'Missing runtime ownership tags');
      const t = a['tags_all'] as Record<string, string>;
      proof(
        t['Project'] === 'vigil' &&
          t['Environment'] === 'demo' &&
          t['Lifecycle'] === 'ephemeral' &&
          t['DeploymentAccount'] === deployment.account &&
          t['DeploymentRegion'] === deployment.region,
        'Foreign runtime ownership',
      );
    }
    if (r.type === 'aws_iam_role')
      proof(
        /^flow-demo-(ops|ingress|worker|admin|verify)-(execution|task)$/.test(
          String(a['name']),
        ) && a['id'] === a['name'],
        'Foundation IAM role refused',
      );
    if (r.type === 'aws_iam_role_policy')
      proof(
        /^flow-demo-(ops|ingress|worker|admin|verify)-execution$/.test(
          String(a['role']),
        ) && a['name'] === 'flow-demo-execution',
        'Foreign inline IAM policy',
      );
    if (r.type === 'aws_ssm_parameter') {
      const key = JSON.parse(r.address.slice(r.address.indexOf('[') + 1, -1));
      proof(
        cycleParameters.includes(key) &&
          a['name'] === `/flow/demo/${key}` &&
          a['id'] === a['name'],
        'Foreign SSM parameter',
      );
    }
    if (r.type === 'aws_db_instance')
      proof(
        a['identifier'] === 'flow-demo' && a['db_name'] === 'flow',
        'Foreign database',
      );
    if (r.type === 'aws_ecs_cluster')
      proof(a['name'] === 'flow-demo', 'Foreign cluster');
    if (r.type === 'aws_acm_certificate')
      proof(a['domain_name'] === deployment.domain, 'Foreign certificate');
    if (r.type === 'aws_lb')
      proof(a['name'] === 'flow-demo', 'Foreign load balancer');
    if (r.type === 'aws_ecs_service') {
      const key = JSON.parse(r.address.slice(r.address.indexOf('[') + 1, -1));
      proof(
        a['name'] === `flow-demo-${key}` &&
          a['cluster'] === indexed['aws_ecs_cluster.demo']?.['arn'] &&
          a['task_definition'] ===
            indexed[`aws_ecs_task_definition.app["${key}"]`]?.['arn'],
        'Foreign service/task relationship',
      );
    }
    if (r.type === 'aws_ecs_task_definition') {
      const key = JSON.parse(r.address.slice(r.address.indexOf('[') + 1, -1));
      proof(
        a['family'] === `flow-demo-${key}` &&
          new RegExp(
            `^arn:aws:ecs:${deployment.region}:${deployment.account}:task-definition/flow-demo-${key}:[1-9][0-9]*$`,
          ).test(String(a['arn'])),
        'Foreign task family',
      );
    }
    if (r.type === 'aws_lb_listener')
      proof(
        a['load_balancer_arn'] === indexed['aws_lb.demo']?.['arn'],
        'Foreign listener',
      );
    if (r.type === 'aws_lb_listener_rule')
      proof(
        a['listener_arn'] === indexed['aws_lb_listener.https[0]']?.['arn'],
        'Foreign listener rule',
      );
    if (r.type === 'aws_acm_certificate_validation')
      proof(
        a['certificate_arn'] === indexed['aws_acm_certificate.demo']?.['arn'],
        'Foreign certificate validation',
      );
  }
  return instances;
}
export function assertCycleStart(snapshot: CycleState, inventory: string[]) {
  proof(
    cycleInstances(snapshot).length === 0 && inventory.length === 0,
    'A new cycle requires both empty current state and verified absent runtime inventory; retain state/history and recover first',
  );
}
export function assertCycleState(expected: CycleState, current: CycleState) {
  cycleInstances(current);
  proof(
    isDeepStrictEqual(expected, current),
    'State version, lineage, serial or physical inventory changed; obtain a fresh review',
  );
}
export function assertCycleBindings(
  b: CycleBindings,
  snapshot: CycleState,
  bookId: string,
  accountId: string,
) {
  const instances = cycleInstances(snapshot);
  const db = instances.find(
    (r) => r.address === 'aws_db_instance.demo',
  )?.attributes;
  const task = instances.find(
    (r) => r.address === 'aws_ecs_task_definition.app["admin"]',
  )?.attributes;
  proof(
    db &&
      task &&
      b.databaseId === db['id'] &&
      b.databaseResourceId === db['resource_id'] &&
      /^db-[A-Z0-9]+$/.test(b.databaseResourceId) &&
      b.databaseAddress === db['address'] &&
      /^flow-demo\.[a-z0-9.-]+\.ap-southeast-2\.rds\.amazonaws\.com$/.test(
        b.databaseAddress,
      ),
    'Bindings do not identify the current database',
  );
  proof(
    b.state.versionId === snapshot.versionId &&
      b.state.etag === snapshot.etag &&
      b.state.sha256 === snapshot.sha256 &&
      b.taskDefinition === task['arn'] &&
      new RegExp(
        `^arn:aws:ecs:${deployment.region}:${deployment.account}:task/flow-demo/[a-f0-9]{32}$`,
      ).test(b.taskArn),
    'Provisioning evidence is stale or belongs to another task',
  );
  proof(
    [b.stripeBookId, b.sourceAccountId, b.syntheticBookId].every(cycleUuid) &&
      b.stripeBookId === bookId &&
      b.stripeBookId !== b.syntheticBookId &&
      b.accountId === accountId &&
      b.applicationAuth === 'PASS',
    'Current source, distinct books and application-auth provisioning proof required',
  );
}
export interface CyclePlan {
  resource_changes?: {
    address: string;
    type: string;
    mode: string;
    change: {
      actions: string[];
      before?: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    };
  }[];
  resource_drift?: {
    address: string;
    change: {
      actions: string[];
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    };
  }[];
  deferred_changes?: unknown[];
  complete?: boolean;
  errored?: boolean;
}
export function assertCyclePlan(
  plan: CyclePlan,
  snapshot: CycleState,
  stage: CycleStage,
) {
  const live = cycleInstances(snapshot);
  proof(
    plan.complete === true &&
      plan.errored !== true &&
      !plan.deferred_changes?.length &&
      !plan.resource_drift?.some((r) => {
        if (isDeepStrictEqual(r.change.actions, ['no-op'])) return false;
        // ACM issues a certificate after the independently verified DNS checkpoint.
        // Only this expected computed lifecycle field may refresh without a new state.
        const before = { ...r.change.before },
          after = { ...r.change.after };
        const issued =
          before['status'] === 'PENDING_VALIDATION' &&
          after['status'] === 'ISSUED';
        delete before['status'];
        delete after['status'];
        return !(
          r.address === 'aws_acm_certificate.demo' &&
          ['https', 'active', 'teardown'].includes(stage) &&
          issued &&
          isDeepStrictEqual(r.change.actions, ['update']) &&
          isDeepStrictEqual(before, after)
        );
      }),
    'Incomplete or refreshed/drifting plan refused',
  );
  assertDemoPlan(plan, stage === 'teardown');
  const changes = plan.resource_changes!;
  proof(
    new Set(changes.map((r) => r.address)).size === changes.length,
    'Duplicate plan address',
  );
  const expected =
    stage === 'teardown'
      ? live.map((r) => r.address).sort()
      : cycleAddresses(stage);
  proof(
    isDeepStrictEqual(changes.map((r) => r.address).sort(), expected) &&
      changes.length > 0,
    'Plan must cover the complete current stage inventory, without bootstrap/foundation/foreign resources',
  );
  for (const c of changes) {
    const old = live.find((r) => r.address === c.address);
    proof(
      c.mode === 'managed' &&
        c.address.startsWith(c.type + '.') &&
        (old
          ? c.change.before?.['id'] === old.attributes['id']
          : c.change.before == null),
      'Refreshed physical identity differs from reviewed state',
    );
    if (stage === 'teardown')
      proof(
        old &&
          c.type === old.type &&
          isDeepStrictEqual(c.change.actions, ['delete']),
        'Teardown must delete every actual runtime instance exactly once',
      );
    else {
      if (!old)
        proof(
          isDeepStrictEqual(c.change.actions, ['create']),
          'New resources must be creates',
        );
      else
        proof(
          c.change.actions.every((a) => ['no-op', 'update'].includes(a)) ||
            (c.type === 'aws_ecs_task_definition' &&
              isDeepStrictEqual(c.change.actions, ['create', 'delete'])),
          'Unexpected replacement or deletion before teardown',
        );
      if (c.type === 'aws_ecs_service')
        proof(
          c.change.after?.['desired_count'] === (stage === 'active' ? 1 : 0),
          'Only activation may start services',
        );
    }
  }
  return {
    creates: changes.filter((c) => c.change.actions.includes('create')).length,
    deletes: changes.filter((c) => c.change.actions.includes('delete')).length,
    updates: changes.filter((c) => c.change.actions.includes('update')).length,
    resources: changes.length,
  };
}
export function assertCycleImages(images: Record<string, string>) {
  proof(
    isDeepStrictEqual(Object.keys(images).sort(), ['admin', 'ops', 'stripe']),
    'A coherent three-image publication is required',
  );
  for (const [name, uri] of Object.entries(images)) {
    assertDeploymentImage(uri);
    proof(uri.includes(`/flow-demo/${name}@`), 'Image repository mismatch');
  }
}
