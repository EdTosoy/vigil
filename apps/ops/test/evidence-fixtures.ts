import type { Model } from '../components/model';

// Presentation-only fixtures. Never persisted or imported by runtime code.
export const evidenceBook = 'f264ba54-0070-4931-8492-d97d5f610435';
export const workerEvidence: Model = {
  version: 'operations-read-v1',
  asOf: '2026-01-02T00:00:00Z',
  data: {
    id: evidenceBook,
    state: 'SUCCEEDED',
    handler: 'stripe_evidence.v1-TEST',
    eventType: 'ingestion.normalization_requested',
    attempts: 1,
    createdAt: '2026-01-01T00:00:00.123456Z',
    completedAt: '2026-01-01T00:00:01.123456Z',
    nextAttemptAt: null,
    leaseExpiresAt: null,
    failureClass: null,
    failureCode: null,
  },
  items: [
    {
      id: 'b9170e74-1204-4591-819e-d94abef058ac',
      attempt: 1,
      kind: 'SUCCEEDED',
      failureClass: null,
      failureCode: null,
      cursorTime: '2026-01-01T00:00:01.123456Z',
    },
  ],
  nextCursor: null,
};

export const staleControlEvidence: Model = {
  version: 'operations-read-v1',
  asOf: workerEvidence.asOf,
  data: {
    key: 'SOURCE_PERIOD:acct_ABC-9.v1/PHP',
    evaluationId: evidenceBook,
    evaluationVersion: 'controls_v1.0-TEST',
    evaluatedAt: '2026-01-01T00:00:00Z',
    status: 'PASS',
    current: false,
    currentReason: 'INPUTS_CHANGED',
    type: 'SOURCE_PERIOD',
    scope: { sourceAccountId: 'acct_ABC-9.v1', currency: 'PHP' },
    expected: '12',
    observed: '12',
    discrepancy: '0',
    unit: 'COUNT',
    details: { reference: 'Bank_REF-42.v2:/ABC?x=Y+Z#OK' },
    evidence: ['receipt_ABC-9.v1'],
    caseIds: [],
  },
  items: [],
  nextCursor: null,
};
