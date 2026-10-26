import type { Model } from '../components/model';

// UI-only, deterministic contract examples. Never persisted or imported by runtime.
export const overviewBook = '11111111-1111-4111-8111-111111111111';
export const overviewEvaluation = '22222222-2222-4222-8222-222222222222';
export const alternateEvaluation = '33333333-3333-4333-8333-333333333333';
export const overviewRun = '44444444-4444-4444-8444-444444444444';
export const overviewCase = '55555555-5555-4555-8555-555555555555';
export const overviewChoices: Model = {
  version: 'operations-read-v1',
  asOf: '2026-10-26T00:10:00Z',
  items: [overviewEvaluation, alternateEvaluation].map((id) => ({
    id,
    version: 'financial-controls-v1',
    state: 'COMPLETED',
    frozenAt: '2026-10-26T00:00:00.123456Z',
    completedAt: '2026-10-26T00:01:00Z',
  })),
  data: null,
  nextCursor: null,
};
export function overviewFixture(): Model {
  return {
    version: 'operations-read-v1',
    asOf: '2026-10-26T00:10:00Z',
    items: null,
    nextCursor: null,
    data: {
      book: {
        id: overviewBook,
        code: 'UI-fixture-book',
        environment: 'synthetic',
      },
      latestEvaluationAt: '2026-10-26T00:01:00Z',
      integrity: {
        version: 'system-integrity-v1',
        bookId: overviewBook,
        asOf: '2026-10-26T00:10:00Z',
        financialAssurance: 'FAIL',
        integrity: 'PASS',
        open: { exceptions: 2, unknownControls: 1 },
        work: {
          pending: 0,
          processing: 0,
          retryable: 1,
          terminal: 1,
          succeeded: 3,
          expiredRecoverable: 0,
        },
        controls: [],
        violations: [],
      },
      evaluation: {
        id: overviewEvaluation,
        bookId: overviewBook,
        version: 'financial-controls-v1',
        state: 'COMPLETED',
        frozenAt: '2026-10-26T00:00:00.123456Z',
        completedAt: '2026-10-26T00:01:00Z',
        assurance: 'FAIL',
        current: true,
        currentReason: 'UNCHANGED_INPUTS',
        exposure: [
          {
            scope: { mappingId: overviewRun, reconciliationRunId: overviewRun },
            currency: 'PHP',
            unreconciledMinor: '125004325',
            acceptedRiskMinor: '100',
            processorClaimMinor: '125004325',
            bankClaimMinor: '0',
            pairResidualMinor: '0',
            unknownCount: '0',
          },
        ],
        reconciliation: [
          { scope: { reconciliationRunId: overviewRun }, status: 'PASS' },
        ],
        cases: [
          { key: 'SOURCE_PERIOD:acct_ABC-9.v1/PHP', caseId: overviewCase },
        ],
      },
    },
    checks: {
      ledger: 'PASS',
      sourceCompleteness: 'UNKNOWN',
      processingCompleteness: 'PASS',
      processorControls: 'PASS',
      bankControls: 'PASS',
      reconciliationCoverage: 'UNKNOWN',
      allocationIntegrity: 'PASS',
      exposureIntegrity: 'FAIL',
      workerRecoverability: 'FAIL',
    },
  };
}
