/**
 * Public portfolio snapshot. All records are hand-authored illustrative examples.
 * Never read AWS, Stripe, PostgreSQL, local credentials or simulator oracle data.
 * This is not current financial evidence.
 */
import {
  InvalidRead,
  ReadUnavailable,
  parameters,
  type Operation,
  type ReadResult,
  type RecordJson,
} from '@vigil/operations-read-postgres';

export const PUBLIC_DEMO_BOOK = '11111111-1111-4111-8111-111111111111';
export const PUBLIC_DEMO_EVALUATION = '22222222-2222-4222-8222-222222222222';
const RUN = '44444444-4444-4444-8444-444444444444';
const CASE = '55555555-5555-4555-8555-555555555555';
const WORK = '66666666-6666-4666-8666-666666666666';
const CONTROL = 'SOURCE_PERIOD:PUBLIC_SYNTHETIC/PHP';
const SNAPSHOT = '2026-10-26T00:10:00Z';
const FROZEN = '2026-10-26T00:00:00Z';
const book: RecordJson = {
  id: PUBLIC_DEMO_BOOK,
  code: 'illustrative-synthetic',
  environment: 'synthetic',
};
const evaluation: RecordJson = {
  id: PUBLIC_DEMO_EVALUATION,
  bookId: PUBLIC_DEMO_BOOK,
  version: 'illustrative-financial-controls-v1',
  state: 'COMPLETED',
  frozenAt: FROZEN,
  completedAt: '2026-10-26T00:01:00Z',
  assurance: 'FAIL',
  current: false,
  currentReason: 'EVALUATION_EXPIRED',
  exposure: [{
    scope: { mappingId: RUN, reconciliationRunId: RUN },
    currency: 'PHP',
    unreconciledMinor: '125004325',
    acceptedRiskMinor: '100',
    processorClaimMinor: '125004325',
    bankClaimMinor: '0',
    pairResidualMinor: '0',
    unknownCount: '0',
  }],
  reconciliation: [{ scope: { reconciliationRunId: RUN }, status: 'UNKNOWN' }],
  cases: [{ key: CONTROL, caseId: CASE }],
};
const integrity: RecordJson = {
  version: 'illustrative-static-snapshot-v1',
  bookId: PUBLIC_DEMO_BOOK,
  asOf: SNAPSHOT,
  financialAssurance: 'UNKNOWN',
  integrity: 'UNKNOWN',
  open: { exceptions: 1, unknownControls: 1 },
  work: {
    pending: 0, processing: 0, retryable: 0,
    terminal: 1, succeeded: 1, expiredRecoverable: 0,
  },
  controls: [],
  violations: [],
};
const checks: NonNullable<ReadResult['checks']> = {
  ledger: 'UNKNOWN',
  sourceCompleteness: 'UNKNOWN',
  processingCompleteness: 'UNKNOWN',
  processorControls: 'UNKNOWN',
  bankControls: 'UNKNOWN',
  reconciliationCoverage: 'UNKNOWN',
  allocationIntegrity: 'UNKNOWN',
  exposureIntegrity: 'UNKNOWN',
  workerRecoverability: 'UNKNOWN',
};
const run: RecordJson = {
  id: RUN,
  mappingId: 'illustrative-processor-bank',
  currency: 'PHP',
  ruleVersion: 'illustrative-v1',
  state: 'COMPLETED',
  frozenAt: FROZEN,
  completedAt: SNAPSHOT,
  exactGroups: '0',
  groupedGroups: '0',
  summary: {
    processorPopulation: '2',
    bankPopulation: '1',
    matchedGroups: '0',
    outcomes: [{ side: 'PROCESSOR', outcome: 'UNMATCHED', count: '1' }],
    current: [{ status: 'UNKNOWN', count: '1' }],
  },
};
const incident: RecordJson = {
  id: CASE,
  state: 'OPEN',
  resolution: null,
  currentlyReconciled: false,
  classification: 'MISSING_BANK_MOVEMENT',
  side: 'PROCESSOR',
  currency: 'PHP',
  assigneeId: null,
  exposure: { amountMinor: '125004325' },
  evidenceRunId: RUN,
  createdAt: FROZEN,
  updatedAt: SNAPSHOT,
};
const control: RecordJson = {
  key: CONTROL,
  cursorKey: CONTROL,
  type: 'SOURCE_PERIOD',
  status: 'UNKNOWN',
  evaluationId: PUBLIC_DEMO_EVALUATION,
  evaluationVersion: 'illustrative-financial-controls-v1',
  evaluatedAt: FROZEN,
  current: false,
  currentReason: 'EVALUATION_EXPIRED',
  scope: { sourceAccountId: 'PUBLIC_SYNTHETIC', currency: 'PHP' },
  expected: null,
  observed: null,
  discrepancy: null,
  unit: 'COUNT',
  currency: 'PHP',
  evidence: [],
  caseIds: [CASE],
};
const work: RecordJson = {
  id: WORK,
  state: 'FAILED_TERMINAL',
  handler: 'illustrative-evidence-worker',
  eventType: 'ingestion.normalization_requested',
  attempts: 3,
  createdAt: FROZEN,
  completedAt: SNAPSHOT,
  nextAttemptAt: null,
  leaseExpiresAt: null,
  failureClass: 'UNSUPPORTED',
  failureCode: 'ILLUSTRATIVE_EVIDENCE_GAP',
};

function result(
  data: RecordJson | null = null,
  items: RecordJson[] | null = null,
  suppliedChecks?: ReadResult['checks'],
): ReadResult {
  return {
    version: 'operations-read-v1',
    asOf: SNAPSHOT,
    data,
    items,
    nextCursor: null,
    ...(suppliedChecks ? { checks: suppliedChecks } : {}),
  };
}

/** This closed catalog is the only read port in public-demo mode. */
export function readPublicDemo(
  kind: Operation,
  bookId: string | null,
  filters: Record<string, string | undefined> = {},
): ReadResult {
  if (kind !== 'books' && bookId !== PUBLIC_DEMO_BOOK)
    throw new ReadUnavailable('NOT_FOUND');
  const opts = parameters(kind, filters);
  // A fixed snapshot has no cursor-backed pagination.
  if (filters['cursor']) throw new InvalidRead();
  const chosenEvaluation = filters['evaluation'] === PUBLIC_DEMO_EVALUATION;
  if (kind === 'overview')
    return result(
      {
        book,
        latestEvaluationAt: SNAPSHOT,
        integrity,
        evaluation: chosenEvaluation ? evaluation : null,
      },
      null,
      checks,
    );
  if (kind === 'integrity') return result({ integrity }, null, checks);
  if (kind === 'run' || kind === 'case' || kind === 'work' || kind === 'control') {
    const expected = kind === 'run' ? RUN
      : kind === 'case' ? CASE
      : kind === 'work' ? WORK
      : CONTROL;
    const supplied = kind === 'control' ? filters['key'] : filters['id'];
    if (supplied !== expected) throw new ReadUnavailable('NOT_FOUND');
    return kind === 'run'
      ? result(run, [{
          id: '77777777-7777-4777-8777-777777777777',
          side: 'PROCESSOR',
          outcome: 'UNMATCHED',
          reason: 'MISSING_BANK_EVIDENCE',
          snapshot: { reference: 'PUBLIC-DEMO-ONLY' },
        }])
      : result(kind === 'case' ? incident : kind === 'work' ? work : control, []);
  }
  if (![
    'books', 'evaluations', 'reconciliation',
    'exceptions', 'controls', 'workers',
  ].includes(kind)) throw new InvalidRead();
  const catalog: Partial<Record<Operation, RecordJson[]>> = {
    books: [book],
    evaluations: [{
      id: PUBLIC_DEMO_EVALUATION,
      version: 'illustrative-financial-controls-v1',
      state: 'COMPLETED',
      frozenAt: FROZEN,
      completedAt: '2026-10-26T00:01:00Z',
    }],
    reconciliation: [run],
    exceptions: [incident],
    controls: [control],
    workers: [work],
  };
  const rows = (catalog[kind] ?? []).filter((item) => {
    if (opts['id'] && item['id'] !== opts['id']) return false;
    if (opts['status'] && (item['status'] ?? item['state']) !== opts['status'])
      return false;
    if (opts['currency'] && item['currency'] !== opts['currency']) return false;
    if (opts['category'] &&
      (item['classification'] ?? item['type']) !== opts['category'])
      return false;
    return true;
  }).slice(0, opts['limit'] as number);
  if (kind === 'controls')
    return result({ evaluation: chosenEvaluation ? evaluation : null }, rows);
  if (kind === 'workers')
    return result({
      counts: { PENDING: 0, PROCESSING: 0, RETRYABLE: 0,
        FAILED_TERMINAL: 1, SUCCEEDED: 1 },
      oldestPendingAt: null,
    }, rows);
  return result(null, rows);
}
