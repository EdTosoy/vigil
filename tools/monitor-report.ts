import {
  identifier,
  type Operation,
  type ReadResult,
  type RecordJson,
} from '@vigil/operations-read-postgres';

type Status = 'PASS' | 'FAIL' | 'UNKNOWN';
type WorkState = 'PENDING' | 'PROCESSING' | 'RETRYABLE';
export interface MonitorOptions {
  bookId: string;
  evaluationId?: string;
  maxOutstandingAgeMs?: number;
}
export interface MonitorReader {
  read(
    kind: Operation,
    book: string,
    filters?: Record<string, string | undefined>,
  ): Promise<ReadResult>;
}
const object = (value: unknown): RecordJson => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Incomplete monitor observation');
  return value as RecordJson;
};
function count(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))
    return value;
  throw new Error('Incomplete monitor count');
}
function status(value: unknown): Status {
  if (value !== 'PASS' && value !== 'FAIL' && value !== 'UNKNOWN')
    throw new Error('Incomplete monitor assurance');
  return value;
}

/**
 * Observe existing authoritative reads. No new financial calculations, writes,
 * latest-run selection or claim that independent reads share one MVCC snapshot.
 */
export async function monitorReport(
  reader: MonitorReader,
  options: MonitorOptions,
) {
  const bookId = identifier(options.bookId);
  const evaluationId = options.evaluationId
    ? identifier(options.evaluationId)
    : undefined;
  const maxOutstandingAgeMs = options.maxOutstandingAgeMs ?? 300000;
  if (
    !Number.isSafeInteger(maxOutstandingAgeMs) ||
    maxOutstandingAgeMs < 1 ||
    maxOutstandingAgeMs > 604800000
  )
    throw new RangeError('Monitor age threshold must be 1..604800000 ms');
  const overview = await reader.read(
    'overview',
    bookId,
    evaluationId ? { evaluation: evaluationId } : {},
  );
  const data = object(overview.data);
  const integrity = object(data['integrity']);
  const work = object(integrity['work']);
  const alerts: { code: string; status: Exclude<Status, 'PASS'> }[] = [];
  const terminal = count(work['terminal']);
  const expiredRecoverable = count(work['expiredRecoverable']);
  const structuralIntegrity = status(integrity['integrity']);
  const financialAssurance = status(integrity['financialAssurance']);
  if (BigInt(terminal) > 0n)
    alerts.push({ code: 'TERMINAL_WORK_PRESENT', status: 'FAIL' });
  if (BigInt(expiredRecoverable) > 0n)
    alerts.push({ code: 'EXPIRED_WORK_LEASE', status: 'FAIL' });
  if (structuralIntegrity !== 'PASS')
    alerts.push({ code: 'STRUCTURAL_INTEGRITY', status: structuralIntegrity });
  const evaluation =
    data['evaluation'] === null ? null : object(data['evaluation']);
  if (evaluationId && evaluation?.['id'] !== evaluationId)
    throw new Error('Selected control evaluation was not returned');
  const controlsFreshness: Status =
    evaluation?.['current'] === true ? 'PASS' : 'UNKNOWN';
  if (controlsFreshness === 'UNKNOWN')
    alerts.push({
      code:
        evaluation === null
          ? 'CONTROL_EVALUATION_UNSELECTED'
          : 'CONTROL_EVALUATION_NOT_CURRENT',
      status: 'UNKNOWN',
    });
  const samples = [];
  for (const state of ['PENDING', 'PROCESSING', 'RETRYABLE'] as const) {
    const observed = await reader.read('workers', bookId, {
      status: state,
      limit: '1',
    });
    const workerData = object(observed.data);
    if (!Object.hasOwn(workerData, 'counts'))
      throw new Error('Incomplete worker count observation');
    const counts =
      workerData['counts'] === null ? {} : object(workerData['counts']);
    // The approved query groups the complete book population; a missing group is
    // a proven zero for this observation, unlike missing financial evidence.
    const total = count(counts[state] ?? '0');
    const oldest = observed.items?.[0]?.['cursorTime'];
    if (BigInt(total) === 0n && observed.items?.length)
      throw new Error('Inconsistent worker population observation');
    const observedAt = Date.parse(observed.asOf);
    const oldestAt = typeof oldest === 'string' ? Date.parse(oldest) : NaN;
    let ageMs: number | null = null;
    let ageStatus: Status = 'PASS';
    if (!Number.isFinite(observedAt))
      throw new Error('Invalid database observation time');
    if (BigInt(total) > 0n) {
      if (!Number.isFinite(oldestAt) || oldestAt > observedAt)
        ageStatus = 'UNKNOWN';
      else {
        ageMs = observedAt - oldestAt;
        if (ageMs > maxOutstandingAgeMs) ageStatus = 'FAIL';
      }
    }
    if (ageStatus !== 'PASS')
      alerts.push({ code: `${state}_WORK_AGE`, status: ageStatus });
    samples.push({
      state: state as WorkState,
      asOf: observed.asOf,
      outstandingCount: total,
      oldestCreatedAt: typeof oldest === 'string' ? oldest : null,
      oldestAgeMs: ageMs,
      status: ageStatus,
    });
  }
  const operationalStatus: Status = alerts.some((a) => a.status === 'FAIL')
    ? 'FAIL'
    : alerts.length
      ? 'UNKNOWN'
      : 'PASS';
  return {
    version: 'operational-monitor-v1' as const,
    bookId,
    operationalStatus,
    attentionStatus: (operationalStatus === 'FAIL' ||
    financialAssurance === 'FAIL'
      ? 'FAIL'
      : operationalStatus === 'UNKNOWN' || financialAssurance === 'UNKNOWN'
        ? 'UNKNOWN'
        : 'PASS') as Status,
    alerts,
    financialAlerts:
      financialAssurance === 'FAIL'
        ? [{ code: 'FINANCIAL_ASSURANCE_FAIL', status: 'FAIL' as const }]
        : [],
    policy: { maxOutstandingAgeMs },
    integrityObservation: {
      asOf: overview.asOf,
      structuralIntegrity,
      financialAssurance,
      pending: count(work['pending']),
      processing: count(work['processing']),
      retryable: count(work['retryable']),
      terminal,
      succeeded: count(work['succeeded']),
      expiredRecoverable,
    },
    controlObservation: {
      asOf: overview.asOf,
      evaluationId: evaluationId ?? null,
      freshness: controlsFreshness,
      currentReason:
        typeof evaluation?.['currentReason'] === 'string'
          ? evaluation['currentReason']
          : null,
    },
    workAgeObservations: samples,
  };
}
