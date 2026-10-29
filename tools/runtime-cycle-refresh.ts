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

// aws_route.internet is the authoritative separately managed default route.
// aws_route_table.public refreshes it as a nested `cidr_block` entry, not
// `destination_cidr_block`. Do not trust arbitrary new route-table entries.
function matchesRoutes(value: unknown, tableId: string, live: readonly LiveResource[]) {
  if (!Array.isArray(value) || value.length !== 1 || !record(value[0])) return false;
  const route = live.find((r) => r.address === 'aws_route.internet')?.attributes;
  const gateway = live.find((r) => r.address === 'aws_internet_gateway.demo')?.attributes;
  if (!route || !gateway ||
      route['route_table_id'] !== tableId ||
      route['destination_cidr_block'] !== '0.0.0.0/0' ||
      typeof gateway['id'] !== 'string' ||
      !/^igw-[0-9a-f]+$/.test(gateway['id']) ||
      route['gateway_id'] !== gateway['id']) return false;

  const nested = value[0];
  if (nested['cidr_block'] !== route['destination_cidr_block'] ||
      nested['gateway_id'] !== gateway['id']) return false;
  const emptyFields = new Set([
    'carrier_gateway_id', 'core_network_arn', 'destination_prefix_list_id',
    'egress_only_gateway_id', 'ipv6_cidr_block', 'local_gateway_id',
    'nat_gateway_id', 'network_interface_id', 'odb_network_arn',
    'transit_gateway_id', 'vpc_endpoint_id', 'vpc_peering_connection_id',
  ]);
  return Object.entries(nested).every(([key, field]) =>
    key === 'cidr_block' || key === 'gateway_id' ||
    (emptyFields.has(key) && (field === '' || field == null)));
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
    const timestampsPresent =
      after['not_before'] !== before['not_before'] ||
      after['not_after'] !== before['not_after'];
    if (timestampsPresent) {
      // ACM initially persists empty-string dates while validation is pending.
      // Only both strictly formatted issued validity dates may materialize.
      const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
      const notBefore = after['not_before'];
      const notAfter = after['not_after'];
      if (typeof notBefore !== 'string' || typeof notAfter !== 'string' ||
          !iso.test(notBefore) || !iso.test(notAfter) ||
          !Number.isFinite(Date.parse(notBefore)) ||
          !Number.isFinite(Date.parse(notAfter)) ||
          Date.parse(notAfter) <= Date.parse(notBefore) ||
          ![null, undefined, ''].some((value) => value === before['not_before']) ||
          ![null, undefined, ''].some((value) => value === before['not_after'])) return false;
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
