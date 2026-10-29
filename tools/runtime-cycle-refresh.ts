/** Validate only explainable post-create provider refresh. No Terraform state mutation. */
import { isDeepStrictEqual } from 'node:util';

interface LiveResource {
  address: string;
  attributes: Record<string, unknown>;
}
interface Drift {
  address: string;
  change: {
    actions: string[];
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  };
}

const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const empty = (x: unknown) => x == null || (Array.isArray(x) && x.length === 0);
const sameEmptyTags = (before: unknown, after: unknown) =>
  before == null && record(after) && Object.keys(after).length === 0;

// This compares effective access, not AWS-generated descriptions/metadata.
function ruleKey(
  protocol: unknown,
  from: unknown,
  to: unknown,
  peerType: string,
  peer: unknown,
): string | null {
  if (
    !['tcp', 'udp', 'icmp', 'icmpv6', '-1'].includes(String(protocol)) ||
    typeof peer !== 'string' ||
    !peer.length ||
    (from != null && !Number.isInteger(from)) ||
    (to != null && !Number.isInteger(to))
  ) return null;
  return JSON.stringify([String(protocol), from ?? null, to ?? null, peerType, peer]);
}

function inlineRuleKeys(input: unknown, groupId: string): string[] | null {
  if (!Array.isArray(input)) return null;
  const keys: string[] = [];
  for (const rule of input) {
    if (!record(rule)) return null;
    const peers: [string, unknown][] = [];
    for (const [field, type] of [
      ['cidr_blocks', 'ipv4'],
      ['ipv6_cidr_blocks', 'ipv6'],
      ['prefix_list_ids', 'prefix'],
      ['security_groups', 'security-group'],
    ] as const) {
      const values = rule[field];
      if (values != null && !Array.isArray(values)) return null;
      for (const value of values ?? []) peers.push([type, value]);
    }
    if (rule['self'] === true) peers.push(['security-group', groupId]);
    if (!peers.length) return null;
    for (const [type, peer] of peers) {
      const key = ruleKey(rule['protocol'], rule['from_port'], rule['to_port'], type, peer);
      if (!key) return null;
      keys.push(key);
    }
  }
  return keys.sort();
}

function standaloneRuleKeys(
  live: readonly LiveResource[],
  groupId: string,
  direction: 'ingress' | 'egress',
): string[] | null {
  const resources = live.filter(
    (r) => r.address.startsWith(`aws_vpc_security_group_${direction}_rule.`) &&
      r.attributes['security_group_id'] === groupId,
  );
  if (!resources.length) return null;
  const keys: string[] = [];
  for (const { attributes: a } of resources) {
    const peers = [
      ['ipv4', a['cidr_ipv4']],
      ['ipv6', a['cidr_ipv6']],
      ['prefix', a['prefix_list_id']],
      ['security-group', a['referenced_security_group_id']],
    ] as const;
    const defined = peers.filter(([, v]) => v != null);
    if (defined.length !== 1) return null;
    const [kind, peer] = defined[0]!;
    const key = ruleKey(a['ip_protocol'], a['from_port'], a['to_port'], kind, peer);
    if (!key) return null;
    keys.push(key);
  }
  return keys.sort();
}

function readPolicy(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return record(parsed) ? parsed : null;
  } catch { return null; }
}

function matchesInlinePolicies(
  value: unknown,
  roleName: string,
  live: readonly LiveResource[],
): boolean {
  if (!Array.isArray(value)) return false;
  const owned = live.filter((r) =>
    r.address.startsWith('aws_iam_role_policy.execution[') &&
    r.attributes['role'] === roleName,
  );
  if (!owned.length || value.length !== owned.length) return false;
  const expected = owned.map((r) => ({
    name: r.attributes['name'], policy: readPolicy(r.attributes['policy']),
  }));
  const actual = value.map((p: unknown) =>
    record(p) ? { name: p['name'], policy: readPolicy(p['policy']) } : null,
  );
  if ([...expected, ...actual].some((p) => p == null || !p.policy || typeof p.name !== 'string')) return false;
  const byName = (a: {name: unknown}) => String(a.name);
  return isDeepStrictEqual(expected.sort((a, b) => byName(a).localeCompare(byName(b))),
    actual.sort((a, b) => byName(a!).localeCompare(byName(b!))));
}

const routeFields = [
  'destination_cidr_block', 'destination_ipv6_cidr_block', 'destination_prefix_list_id',
  'gateway_id', 'nat_gateway_id', 'transit_gateway_id', 'vpc_endpoint_id',
  'network_interface_id', 'instance_id', 'egress_only_gateway_id',
  'local_gateway_id', 'carrier_gateway_id', 'core_network_arn',
] as const;
function routeKey(a: Record<string, unknown>) {
  return JSON.stringify(routeFields.map((key) => a[key] ?? null));
}
function matchesRoutes(value: unknown, tableId: string, live: readonly LiveResource[]) {
  if (!Array.isArray(value)) return false;
  const owned = live.filter((r) => r.address.startsWith('aws_route.') &&
    r.attributes['route_table_id'] === tableId);
  if (!owned.length || value.length !== owned.length || !value.every(record)) return false;
  return isDeepStrictEqual(
    owned.map((r) => routeKey(r.attributes)).sort(),
    value.map((r) => routeKey(r)).sort(),
  );
}

/** Fail closed for unfamiliar changes; explicitly reconcile only managed child mirrors. */
export function expectedCycleRefresh(
  drift: Drift,
  live: readonly LiveResource[],
  stage: string,
): boolean {
  const { before: originalBefore, after: originalAfter, actions } = drift.change;
  if (isDeepStrictEqual(actions, ['no-op']))
    return isDeepStrictEqual(originalBefore, originalAfter);
  if (!isDeepStrictEqual(actions, ['update']) ||
      !record(originalBefore) || !record(originalAfter) ||
      !Object.prototype.hasOwnProperty.call(originalBefore, 'id') ||
      originalBefore['id'] !== originalAfter['id'] ||
      !live.some((r) => r.address === drift.address && r.attributes['id'] === originalBefore['id']))
    return false;

  const before = { ...originalBefore };
  const after = { ...originalAfter };
  if (!isDeepStrictEqual(before['tags'], after['tags'])) {
    if (!sameEmptyTags(before['tags'], after['tags'])) return false;
    before['tags'] = after['tags'];
  }
  if (drift.address === 'aws_db_instance.demo') {
    for (const key of ['domain_dns_ips', 'enabled_cloudwatch_logs_exports']) {
      if (!isDeepStrictEqual(before[key], after[key])) {
        if (!empty(before[key]) || !Array.isArray(after[key]) || after[key].length !== 0)
          return false;
        before[key] = after[key];
      }
    }
  }
  if (drift.address === 'aws_acm_certificate.demo' && stage !== 'infrastructure' &&
      before['status'] === 'PENDING_VALIDATION' && after['status'] === 'ISSUED') {
    // Certificate validity timestamps only materialize on issuance.
    const timestampsPresent = after['not_before'] != null || after['not_after'] != null;
    if (timestampsPresent) {
      const start = Date.parse(String(after['not_before']));
      const end = Date.parse(String(after['not_after']));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start ||
          (before['not_before'] != null && before['not_before'] !== after['not_before']) ||
          (before['not_after'] != null && before['not_after'] !== after['not_after'])) return false;
    }
    before['status'] = after['status'];
    if ('not_before' in after) before['not_before'] = after['not_before'];
    if ('not_after' in after) before['not_after'] = after['not_after'];
  }
  if (/^aws_iam_role\.execution\["[^\"]+"\]$/.test(drift.address) &&
      !isDeepStrictEqual(before['inline_policy'], after['inline_policy'])) {
    if (!empty(before['inline_policy']) ||
        !matchesInlinePolicies(after['inline_policy'], String(before['name']), live)) return false;
    before['inline_policy'] = after['inline_policy'];
  }
  if (drift.address === 'aws_route_table.public' &&
      !isDeepStrictEqual(before['route'], after['route'])) {
    if (!empty(before['route']) || !matchesRoutes(after['route'], String(before['id']), live)) return false;
    before['route'] = after['route'];
  }
  if (drift.address.startsWith('aws_security_group.') &&
      !isDeepStrictEqual(before, after)) {
    for (const direction of ['ingress', 'egress'] as const) {
      if (isDeepStrictEqual(before[direction], after[direction])) continue;
      const planned = standaloneRuleKeys(live, String(before['id']), direction);
      const refreshed = inlineRuleKeys(after[direction], String(before['id']));
      if (!empty(before[direction]) || !planned || !refreshed ||
          !isDeepStrictEqual(planned, refreshed)) return false;
      before[direction] = after[direction];
    }
  }
  return isDeepStrictEqual(before, after);
}
