import { isDeepStrictEqual } from 'node:util';
import { initialRuntimeAddresses } from './runtime-plan';
import { deployment } from './deployment-guards';
import { releaseProof as proof } from './runtime-apply-review';

export interface RecoveryInstance {
  index_key?: string | number;
  deposed?: unknown;
  status?: string;
  attributes: Record<string, unknown>;
}
export interface RecoveryState {
  serial: number;
  lineage: string;
  resources: {
    module?: string;
    mode: string;
    type: string;
    name: string;
    provider: string;
    instances: RecoveryInstance[];
  }[];
}
export function recoveryAddresses() {
  return [
    ...initialRuntimeAddresses(),
    ...[
      'provisioning',
      'stripe_key',
      'webhook_secrets',
      'demo_username',
      'demo_password',
      'operations_url',
      'ingress_url',
      'stripeworker_url',
    ].map((k) => `aws_ssm_parameter.runtime["${k}"]`),
    ...['ops', 'ingress', 'worker'].map((k) => `aws_ecs_service.app["${k}"]`),
    'aws_acm_certificate_validation.demo[0]',
    'aws_lb_listener.http[0]',
    'aws_lb_listener.https[0]',
    'aws_lb_listener_rule.stripe[0]',
  ].sort();
}
export function stateInstances(state: RecoveryState) {
  proof(Array.isArray(state.resources), 'Invalid state resources');
  return state.resources.flatMap((r) => {
    proof(
      !r.module &&
        r.mode === 'managed' &&
        r.provider === 'provider["registry.terraform.io/hashicorp/aws"]',
      'Foreign module/provider/data resource',
    );
    return r.instances.map((i) => {
      proof(
        !i.deposed && (!i.status || i.status === 'ready'),
        'Deposed/tainted state requires separate review',
      );
      return {
        address: `${r.type}.${r.name}${i.index_key === undefined ? '' : `[${JSON.stringify(i.index_key)}]`}`,
        type: r.type,
        attributes: i.attributes,
      };
    });
  });
}
export function validateRecoveryState(
  live: RecoveryState,
  original: RecoveryState,
) {
  const now = stateInstances(live),
    old = stateInstances(original);
  proof(
    original.serial === 3 &&
      live.serial === 5 &&
      original.lineage &&
      live.lineage === original.lineage,
    'Unapproved serial or lineage transition',
  );
  proof(
    isDeepStrictEqual(
      old.map((r) => r.address).sort(),
      initialRuntimeAddresses(),
    ) &&
      isDeepStrictEqual(now.map((r) => r.address).sort(), recoveryAddresses()),
    'State differs from explicit 75-to-90 runtime allowlist',
  );
  const indexed = Object.fromEntries(now.map((r) => [r.address, r.attributes]));
  for (const r of now) {
    const a = r.attributes;
    proof(typeof a['id'] === 'string' && a['id'], 'Missing physical identity');
    const previous = old.find((o) => o.address === r.address);
    if (previous && r.type !== 'aws_ecs_task_definition')
      proof(
        a['id'] === previous.attributes['id'],
        'Original runtime physical identity changed',
      );
    for (const key of ['arn', 'certificate_arn'])
      if (typeof a[key] === 'string' && String(a[key]).startsWith('arn:')) {
        const m = /^arn:aws:([^:]+):([^:]*):(\d{12}):/.exec(String(a[key]));
        proof(
          m &&
            m[3] === deployment.account &&
            (m[1] === 'iam' ? m[2] === '' : m[2] === deployment.region),
          'Foreign account/region ARN',
        );
      }
    if (a['tags_all']) {
      const t = a['tags_all'] as Record<string, string>;
      proof(
        t['Project'] === 'vigil' &&
          t['Environment'] === 'demo' &&
          t['DeploymentAccount'] === deployment.account &&
          t['DeploymentRegion'] === deployment.region,
        'Runtime ownership tags differ',
      );
    }
    if (r.type === 'aws_ssm_parameter') {
      const key = JSON.parse(r.address.slice(r.address.indexOf('[') + 1, -1));
      proof(
        a['name'] === `/flow/demo/${key}` && a['id'] === a['name'],
        'Foreign SSM parameter',
      );
    }
    if (r.type === 'aws_ecs_task_definition') {
      const key = JSON.parse(r.address.slice(r.address.indexOf('[') + 1, -1));
      proof(
        a['family'] === `flow-demo-${key}` &&
          new RegExp(
            `^arn:aws:ecs:${deployment.region}:${deployment.account}:task-definition/flow-demo-${key}:[1-9][0-9]*$`,
          ).test(String(a['arn'])),
        'Foreign task family/revision',
      );
    }
    if (r.type === 'aws_ecs_service') {
      const key = JSON.parse(r.address.slice(r.address.indexOf('[') + 1, -1));
      proof(
        a['name'] === `flow-demo-${key}` &&
          a['cluster'] === indexed['aws_ecs_cluster.demo']?.['arn'] &&
          a['task_definition'] ===
            indexed[`aws_ecs_task_definition.app["${key}"]`]?.['arn'],
        'Foreign service/cluster/task definition',
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
  return now;
}
export function validateRecoveryPlan(
  plan: {
    resource_changes?: {
      address: string;
      type: string;
      mode: string;
      change: { actions: string[]; before?: Record<string, unknown> | null };
    }[];
  },
  state: RecoveryState,
) {
  const instances = stateInstances(state),
    changes = plan.resource_changes;
  proof(
    Array.isArray(changes) &&
      isDeepStrictEqual(
        changes.map((r) => r.address).sort(),
        recoveryAddresses(),
      ),
    'Destroy plan inventory differs from approved live snapshot',
  );
  const counts: Record<string, number> = {};
  for (const c of changes) {
    const match = instances.find((i) => i.address === c.address);
    proof(
      match &&
        c.type === match.type &&
        c.mode === 'managed' &&
        isDeepStrictEqual(c.change.actions, ['delete']) &&
        c.change.before?.['id'] === match.attributes['id'],
      'Unapproved action or refreshed resource identity drift',
    );
    counts[c.type] = (counts[c.type] ?? 0) + 1;
  }
  return { deletes: changes.length, resourceTypes: counts };
}
export function assertRecoveryFresh(
  createdAt: string,
  expectedVersion: unknown,
  liveVersion: unknown,
  now = Date.now(),
) {
  const age = now - Date.parse(createdAt);
  proof(
    Number.isFinite(age) &&
      age >= 0 &&
      age <= 15 * 60000 &&
      isDeepStrictEqual(expectedVersion, liveVersion),
    'Stale recovery review or remote state drift',
  );
}
