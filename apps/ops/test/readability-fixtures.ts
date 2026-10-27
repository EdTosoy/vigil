import type { Model } from '../components/model';
import {
  workerEvidence,
  staleControlEvidence,
  evidenceBook,
} from './evidence-fixtures';

// Deterministic UI-only examples. No fixture is written to financial persistence.
export const readabilityBook = evidenceBook;
export const readabilityEvaluation = '33333333-3333-4333-8333-333333333333';
export const exactReference = '  Bank_REF-ABC_9.v2:/Trace?x=Y+Z#A.B  ';
export const comparisonEvidence: Model = {
  ...staleControlEvidence,
  data: {
    ...staleControlEvidence.data,
    evaluationId: readabilityEvaluation,
    key: 'bank_total:acct_ABC-9.v1/USD',
    type: 'BANK_TOTAL',
    unit: 'MINOR_UNITS',
    currency: 'USD',
    expected: '900719925474099300',
    observed: '900719925474099299',
    discrepancy: '-1',
    status: 'FAIL',
    scope: {
      bankAccountId: readabilityBook,
      currency: 'USD',
      reference: exactReference,
    },
    evidence: ['Evidence_ID.ABC-9_v2/' + 'Trace_SEGMENT-9.'.repeat(12)],
  },
  items: [
    {
      key: 'bank_total:acct_ABC-9.v1/USD',
      type: 'BANK_TOTAL',
      status: 'FAIL',
      expected: '900719925474099300',
      observed: '900719925474099299',
      discrepancy: '-1',
      unit: 'MINOR_UNITS',
      currency: 'USD',
      scope: { accountId: 'acct_ABC-9.v1' },
    },
    {
      key: 'processor_total:acct_PHP-2',
      type: 'PROCESSOR_TOTAL',
      status: 'PASS',
      expected: '0',
      observed: '0',
      discrepancy: '0',
      unit: 'MINOR_UNITS',
      currency: 'PHP',
    },
    {
      key: 'bank_total:acct_MISSING',
      type: 'BANK_TOTAL',
      status: 'UNKNOWN',
      expected: null,
      observed: null,
      discrepancy: null,
      unit: 'MINOR_UNITS',
      currency: 'USD',
    },
  ],
};
export const workerReadability: Model = {
  ...workerEvidence,
  data: {
    ...workerEvidence.data,
    createdAt: '2026-01-01T08:00:00.123456789+08:00',
    completedAt: '2026-01-01 00:00:01.123456+00',
  },
};
export const runReadability: Model = {
  ...workerEvidence,
  data: {
    id: evidenceBook,
    mappingId: readabilityEvaluation,
    ruleVersion: 'exact_settlement-bank.v1',
    state: 'COMPLETED',
    currency: 'USD',
    windowFrom: '2026-01-01T00:00:00Z',
    windowTo: '2026-01-02T00:00:00Z',
    frozenAt: '2026-01-02T00:00:00.123456Z',
    completedAt: '2026-01-02T00:00:01.123456Z',
    summary: {
      processorPopulation: '1',
      bankPopulation: '0',
      populationHash: 'SHA256_ABC-9.v1',
      matchedGroups: '0',
      outcomes: [{ side: 'PROCESSOR', outcome: 'UNMATCHED', count: '1' }],
    },
  },
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      side: 'PROCESSOR',
      outcome: 'UNMATCHED',
      reason: 'MISSING_BANK_MOVEMENT',
      processorEvidenceId:
        'Evidence_ID.ABC-9_v2/' + 'Trace_SEGMENT-9.'.repeat(12),
      bankEvidenceId: null,
      snapshot: {
        amountMinor: '500',
        currency: 'USD',
        evidenceId: 'payment_ABC-9.v1',
        sourceAccountId: 'acct_ABC-9.v1',
        revisionId: 'revision_ABC-9.v1',
        reference: exactReference,
        time: '2026-01-01T08:00:00.123456789+08:00',
        eligible: true,
        history: [],
        historyCount: 0,
        groupVariants: [],
      },
      cause: { exposureMinor: '500', exposureReason: 'MISSING_BANK_MOVEMENT' },
      cases: [],
    },
  ],
};
export const sparseRunReadability: Model = {
  ...runReadability,
  data: { id: evidenceBook },
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      outcome: 'UNKNOWN',
      snapshot: { time: '2026-01-01T12:30:00' },
    },
  ],
};
