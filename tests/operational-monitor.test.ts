import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReadResult } from '@vigil/operations-read-postgres';
import { monitorReport, type MonitorReader } from '../tools/monitor-report';

const bookId = '11111111-1111-4111-8111-111111111111';
const evaluationId = '22222222-2222-4222-8222-222222222222';
function reader(
  options: {
    current?: boolean;
    terminal?: number;
    expired?: number;
    oldest?: string;
    missingOldest?: boolean;
    financial?: 'PASS' | 'FAIL' | 'UNKNOWN';
    missingCounts?: boolean;
    wrongEvaluation?: boolean;
  } = {},
): MonitorReader {
  return {
    async read(kind, _book, filters) {
      const result: ReadResult = {
        version: 'operations-read-v1',
        asOf: '2026-11-01T00:10:00.000Z',
        data: null,
        items: [],
        nextCursor: null,
      };
      if (kind === 'overview')
        result.data = {
          integrity: {
            integrity: 'PASS',
            financialAssurance: options.financial ?? 'UNKNOWN',
            work: {
              pending: 1,
              processing: 0,
              retryable: 0,
              terminal: options.terminal ?? 0,
              succeeded: 2,
              expiredRecoverable: options.expired ?? 0,
            },
          },
          evaluation: filters?.['evaluation']
            ? {
                id: options.wrongEvaluation ? bookId : evaluationId,
                current: options.current ?? true,
                currentReason: 'TEST_OBSERVATION',
              }
            : null,
        };
      else {
        const pending = filters?.['status'] === 'PENDING';
        result.data = options.missingCounts ? {} : { counts: { PENDING: '1' } };
        if (pending && !options.missingOldest)
          result.items = [
            { cursorTime: options.oldest ?? '2026-11-01T00:09:59.000Z' },
          ];
      }
      return result;
    },
  };
}
test('operational success preserves independent UNKNOWN financial assurance and declared snapshot times', async () => {
  const report = await monitorReport(reader(), { bookId, evaluationId });
  assert.equal(report.operationalStatus, 'PASS');
  assert.equal(report.attentionStatus, 'UNKNOWN');
  assert.equal(report.integrityObservation.financialAssurance, 'UNKNOWN');
  assert.equal(report.integrityObservation.succeeded, '2');
  assert.equal(report.workAgeObservations[0]!.oldestAgeMs, 1000);
  assert.equal(report.workAgeObservations[1]!.outstandingCount, '0');
});
test('authoritative financial FAIL demands attention even when processing is healthy', async () => {
  const report = await monitorReport(reader({ financial: 'FAIL' }), {
    bookId,
    evaluationId,
  });
  assert.equal(report.operationalStatus, 'PASS');
  assert.equal(report.attentionStatus, 'FAIL');
  assert.deepEqual(report.financialAlerts, [
    { code: 'FINANCIAL_ASSURANCE_FAIL', status: 'FAIL' },
  ]);
  await assert.rejects(
    monitorReport(reader({ missingCounts: true }), { bookId, evaluationId }),
  );
  await assert.rejects(
    monitorReport(reader({ wrongEvaluation: true }), { bookId, evaluationId }),
  );
});
test('absent or stale explicit evaluation is UNKNOWN, never selected by list order or promoted', async () => {
  for (const options of [{}, { evaluationId }]) {
    const report = await monitorReport(reader({ current: false }), {
      bookId,
      ...options,
    });
    assert.equal(report.operationalStatus, 'UNKNOWN');
    assert.equal(report.controlObservation.freshness, 'UNKNOWN');
  }
});
test('terminal failures, expired leases and excessive outstanding age remain visible without payloads', async () => {
  const report = await monitorReport(
    reader({ terminal: 1, expired: 1, oldest: '2026-11-01T00:00:00.000Z' }),
    { bookId, evaluationId },
  );
  assert.equal(report.operationalStatus, 'FAIL');
  assert.deepEqual(
    report.alerts.map((a) => a.code),
    ['TERMINAL_WORK_PRESENT', 'EXPIRED_WORK_LEASE', 'PENDING_WORK_AGE'],
  );
});
test('missing or future queue time is UNKNOWN; database read failure rejects instead of returning healthy', async () => {
  for (const options of [
    { missingOldest: true },
    { oldest: '2026-11-01T00:11:00.000Z' },
  ]) {
    const report = await monitorReport(reader(options), {
      bookId,
      evaluationId,
    });
    assert.equal(report.operationalStatus, 'UNKNOWN');
    assert.equal(report.workAgeObservations[0]!.oldestAgeMs, null);
  }
  await assert.rejects(
    monitorReport(
      {
        read: async () => {
          throw new Error('unavailable');
        },
      },
      { bookId },
    ),
  );
  await assert.rejects(
    monitorReport(reader(), { bookId, maxOutstandingAgeMs: 0 }),
  );
});
