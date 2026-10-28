/** Pure D3F review: exact D3E equivalence, narrow workload IAM, fresh approval IDs. */
import { isDeepStrictEqual } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { DeploymentSafetyError } from './deployment-context';
import { deployment, type BootstrapPlan } from './deployment-guards';
import {
  initialRuntimeAddresses,
  inspectInitialRuntimePlan,
} from './runtime-plan';

export const d3eBaselineRun = '726aa12d-e639-4970-b9c6-c91dda0f8d18';
export const d3eBaselineHash =
  '4a5044f18c3c22b8672a26d4cf3bdbcdba72c49d6193e1a876da107fba1cf186';
export const d3fPackageId = `vigil-sydney-d3f-${d3eBaselineHash.slice(0, 16)}`;
export type ReleasePlan = BootstrapPlan & {
  configuration?: unknown;
  variables?: Record<string, { value: unknown }>;
};
export function releaseProof(ok: unknown, message: string): asserts ok {
  if (!ok) throw new DeploymentSafetyError(message);
}

export function expectedExecutionPolicies() {
  const parameters = {
    ops: ['operations_url', 'demo_password', 'demo_username'],
    ingress: ['ingress_url', 'webhook_secrets'],
    worker: ['stripe_key', 'stripeworker_url'],
    admin: ['admin_url', 'provisioning'],
    verify: ['ingress_url', 'stripe_key', 'stripeworker_url'],
  };
  return Object.fromEntries(
    Object.entries(parameters).map(([name, names]) => [
      name,
      {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['ecr:GetAuthorizationToken'],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: [
              'ecr:BatchCheckLayerAvailability',
              'ecr:GetDownloadUrlForLayer',
              'ecr:BatchGetImage',
            ],
            Resource: `arn:aws:ecr:${deployment.region}:${deployment.account}:repository/flow-demo/${name === 'ingress' || name === 'worker' ? 'stripe' : name === 'verify' ? 'admin' : name}`,
          },
          {
            Effect: 'Allow',
            Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: `arn:aws:logs:${deployment.region}:${deployment.account}:log-group:/flow/demo/${name}:*`,
          },
          {
            Effect: 'Allow',
            Action: ['ssm:GetParameters'],
            Resource: names.map(
              (n) =>
                `arn:aws:ssm:${deployment.region}:${deployment.account}:parameter/flow/demo/${n}`,
            ),
          },
        ],
      },
    ]),
  );
}

export function assertRuntimeEquivalent(
  current: ReleasePlan,
  baseline: ReleasePlan,
  variables: Record<string, unknown>,
) {
  const summary = inspectInitialRuntimePlan(current, variables);
  assertRuntimePlanMatch(current, baseline);
  return summary;
}

export function assertRuntimePlanMatch(
  current: ReleasePlan,
  baseline: ReleasePlan,
) {
  const project = (p: ReleasePlan) =>
    p.resource_changes
      ?.map((r) => ({
        address: r.address,
        mode: r.mode,
        type: r.type,
        change: r.change,
      }))
      .sort((a, b) => a.address.localeCompare(b.address));
  releaseProof(
    isDeepStrictEqual(project(current), project(baseline)) &&
      isDeepStrictEqual(current.configuration, baseline.configuration),
    'Fresh infrastructure/configuration differs from the reviewed D3E baseline',
  );
  // Computed documents are acceptable only with the complete configuration and
  // source hashes pinned to the reviewed baseline by the caller.
  const expected = expectedExecutionPolicies();
  for (const r of current.resource_changes ?? []) {
    if (r.type !== 'aws_iam_role_policy') continue;
    const name =
      /^aws_iam_role_policy\.execution\["(ops|ingress|worker|admin|verify)"\]$/.exec(
        r.address,
      )?.[1];
    releaseProof(name, 'Unexpected execution policy');
    if (r.change.after?.['policy'] != null)
      releaseProof(
        isDeepStrictEqual(
          JSON.parse(String(r.change.after['policy'])),
          expected[name],
        ),
        'Materialized execution policy differs from reviewed least-privilege projection',
      );
  }
}

export function parseRuntimeReviewId(id: string) {
  const m =
    /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):([a-f0-9]{64})$/.exec(
      id,
    );
  releaseProof(
    m && m[1] !== d3eBaselineRun && m[2] !== d3eBaselineHash,
    'An explicit fresh D3F run:SHA256 review ID is required; D3E is never applicable',
  );
  return { run: m[1]!, sha256: m[2]! };
}

export function assertFreshReview(
  receipt: {
    purpose?: unknown;
    createdAt?: unknown;
    sha256?: unknown;
    run?: unknown;
  },
  id: string,
  now = Date.now(),
) {
  const expected = parseRuntimeReviewId(id);
  const age = now - Date.parse(String(receipt.createdAt));
  releaseProof(
    receipt.purpose === 'D3F' &&
      receipt.run === expected.run &&
      receipt.sha256 === expected.sha256 &&
      Number.isFinite(age) &&
      age >= 0 &&
      age <= 15 * 60000,
    'Foreign, tampered or older-than-15-minute D3F plan review',
  );
  return expected;
}

export function assertFreePlan(
  value: Record<string, unknown>,
  cleanup = false,
  now = Date.now(),
) {
  releaseProof(
    value['accountId'] === deployment.account &&
      value['accountPlanType'] === 'FREE' &&
      ['ACTIVE', 'EXPIRED', 'NOT_STARTED'].includes(
        String(value['accountPlanStatus']),
      ),
    'Expected-account Free Plan required; never upgrade or substitute accounts',
  );
  if (cleanup) return; // Credit exhaustion must not itself prevent approved cleanup.
  const credit = value['accountPlanRemainingCredits'] as
    { amount?: unknown; unit?: unknown } | undefined;
  const amount = String(credit?.amount);
  const m = /^(\d+)(?:\.(\d{1,9}))?$/.exec(amount);
  releaseProof(
    m && credit?.unit === 'USD',
    'Unknown remaining Free Plan credits',
  );
  const exact =
    BigInt(m[1]!) * 1000000000n + BigInt((m[2] ?? '').padEnd(9, '0'));
  releaseProof(
    value['accountPlanStatus'] === 'ACTIVE' &&
      exact >= 2000000000n &&
      Date.parse(String(value['accountPlanExpirationDate'])) >
        now + 4 * 3600000,
    'Active Free Plan, USD 2 credit headroom and four-hour expiry margin required',
  );
}

export function assertRuntimeTeardown(plan: ReleasePlan) {
  const allowed = new Set(initialRuntimeAddresses());
  releaseProof(
    Array.isArray(plan.resource_changes),
    'Complete deletion proposal required',
  );
  releaseProof(
    plan.resource_changes.length > 0 &&
      new Set(plan.resource_changes.map((r) => r.address)).size ===
        plan.resource_changes.length &&
      plan.resource_changes.every(
        (r) =>
          r.mode === 'managed' &&
          allowed.has(r.address) &&
          r.address.startsWith(r.type + '.') &&
          isDeepStrictEqual(r.change.actions, ['delete']),
      ),
    'Teardown permits only reviewed initial-runtime deletions; no creates, updates or bootstrap/IAM-foundation deletion',
  );
  return { deletes: plan.resource_changes.length };
}

export function assertEmptyRuntimeStateHistory(history: {
  IsTruncated?: boolean;
  Versions?: { Key: string }[];
  DeleteMarkers?: { Key: string }[];
}) {
  releaseProof(
    !history.IsTruncated &&
      [...(history.Versions ?? []), ...(history.DeleteMarkers ?? [])].every(
        (v) => v.Key !== 'demo/terraform.tfstate',
      ),
    'Hidden/historical state payload detected after plan review; first apply refused',
  );
}

export function runtimeReleaseArgs(
  operation: 'apply' | 'teardown' | 'teardown-plan',
  paths: { plan: string; variables: string },
) {
  if (operation === 'teardown-plan')
    return [
      'plan',
      '-destroy',
      '-input=false',
      '-no-color',
      '-lock-timeout=30s',
      `-var-file=${paths.variables}`,
      `-out=${paths.plan}`,
    ];
  releaseProof(
    operation === 'apply' || operation === 'teardown',
    'Unsupported runtime release command',
  );
  return [
    'apply',
    '-input=false',
    '-no-color',
    '-lock-timeout=30s',
    paths.plan,
  ];
}

/** A failed/unknown operation consumes its claim just as a successful one does. */
export async function claimRuntimeOperation<T>(
  path: string,
  details: unknown,
  operation: () => T,
): Promise<T> {
  try {
    await writeFile(path, JSON.stringify(details, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST')
      throw new DeploymentSafetyError(
        'Operation already claimed; retain state and obtain recovery review, never retry automatically',
      );
    throw e;
  }
  return operation();
}
