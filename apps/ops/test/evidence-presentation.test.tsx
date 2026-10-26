import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Status } from '../components/common';
import {
  Case,
  Control,
  Evaluation,
  Run,
  Work,
  Workers,
} from '../components/views';
import type { Model, Row } from '../components/model';
import {
  evidenceBook,
  staleControlEvidence,
  workerEvidence,
} from './evidence-fixtures';

const work = (data: Row, items: Row[] = []) =>
  renderToStaticMarkup(
    <Work model={{ ...workerEvidence, data, items }} book={evidenceBook} />,
  );
const control = (data: Row) =>
  renderToStaticMarkup(
    <Control model={{ ...staleControlEvidence, data }} book={evidenceBook} />,
  );

test('field labels are readable while all evidence scalars remain verbatim', () => {
  const values = {
    eventType: 'ingestion.normalization_requested',
    evidenceId: 'Evidence_ABC-9.v1:/ID',
    sourceReference: 'Bank_REF-42.v2:/ABC?x=Y+Z#OK',
    workerId: 'Worker_ABC-9.v1',
    controlId: 'CONTROL_ABC-9.v1',
    reconciliationId: 'Run_ABC-9.v1',
    idempotencyKey: 'Command_ABC-9.v1:/Retry_1',
    transactionReference: 'Txn_ABC-9.v1',
    machineStatus: 'AWAITING_EVIDENCE',
    technicalMetadata: '  Keep__CASE.-: /  ',
  };
  const data = { ...workerEvidence.data, ...values };
  const original = JSON.stringify(data);
  const html = work(data);
  assert(html.includes('<dt>event Type</dt>'));
  for (const value of Object.values(values))
    assert(html.includes(value), value);
  assert(!html.includes('ingestion.normalization requested'));
  assert.equal(JSON.stringify(data), original);
});

test('nested evidence, control keys and run references remain exact', () => {
  const html = control(staleControlEvidence.data!);
  assert(html.includes('SOURCE_PERIOD:acct_ABC-9.v1/PHP'));
  assert(html.includes('Bank_REF-42.v2:/ABC?x=Y+Z#OK'));
  assert(html.includes('receipt_ABC-9.v1'));
  const run = renderToStaticMarkup(
    <Run
      book={evidenceBook}
      model={{
        ...workerEvidence,
        data: { id: evidenceBook, currency: 'PHP' },
        items: [
          {
            id: 'Item_ABC-9.v1',
            side: 'PROCESSOR',
            outcome: 'UNMATCHED',
            reason: 'Reference_MISSING.v1-TEST',
            snapshot: { reference: 'Payout_REF-9.v1:/ABC' },
          },
        ],
      }}
    />,
  );
  assert(run.includes('Payout_REF-9.v1:/ABC'));
  assert(run.includes('Reference_MISSING.v1-TEST'));
});

test('status values remain exact and adverse statuses are not neutral', () => {
  for (const value of ['FAIL', 'FAILED', 'FAILED_TERMINAL']) {
    const html = renderToStaticMarkup(<Status value={value} />);
    assert(html.includes(value));
    assert(html.includes('class="status fail"'), value);
  }
  for (const value of [
    'UNKNOWN',
    'STALE',
    'INCOMPLETE',
    'RETRYABLE',
    'EXPIRED',
    'FENCED',
    'CONFLICT',
    'NOT CURRENT',
    'STALE / INVALIDATED',
  ]) {
    const html = renderToStaticMarkup(<Status value={value} />);
    assert(html.includes(value));
    assert(html.includes('class="status unknown"'), value);
    assert(!html.includes('class="status fail"'), value);
  }
  assert(
    renderToStaticMarkup(<Status value="AWAITING_EVIDENCE" />).includes(
      'AWAITING_EVIDENCE',
    ),
  );
});

test('a historical PASS is labelled frozen and separate from stale applicability', () => {
  const html = control(staleControlEvidence.data!);
  assert(html.includes('Frozen evaluation result'));
  assert(html.includes('PASS'));
  assert(html.includes('Current applicability'));
  assert(html.includes('STALE'));
  assert(html.includes('INPUTS_CHANGED'));
  assert(html.includes('does not establish current assurance'));
});

test('current, incomplete and unsupported evaluations retain their distinct meanings', () => {
  for (const [current, currentReason, expected] of [
    [true, 'UNCHANGED_INPUTS', 'CURRENT'],
    [false, 'INCOMPLETE', 'INCOMPLETE'],
    [false, 'CURRENT_POPULATION_UNSUPPORTED', 'UNKNOWN'],
    [false, 'EVALUATION_EXPIRED', 'STALE'],
  ] as const) {
    const html = control({
      ...staleControlEvidence.data,
      current,
      currentReason,
    });
    assert(html.includes(currentReason));
    assert(html.includes(renderToStaticMarkup(<Status value={expected} />)));
    assert(html.includes('Frozen evaluation result'));
  }
});

test('missing currentness is UNKNOWN even with PASS, a reason or recent timestamps', () => {
  const data = { ...staleControlEvidence.data! };
  delete data['current'];
  data['currentReason'] = 'UNCHANGED_INPUTS';
  data['evaluatedAt'] = '2099-01-01T00:00:00Z';
  for (const current of [undefined, null, 'true']) {
    const supplied = { ...data };
    if (current !== undefined) supplied['current'] = current;
    const html = control(supplied);
    assert(html.includes('Current applicability'));
    assert(html.includes('UNKNOWN'));
    assert(html.includes('currentness flag was not supplied'));
    assert(!html.includes(renderToStaticMarkup(<Status value="CURRENT" />)));
  }
  const evaluation = renderToStaticMarkup(<Evaluation data={data} />);
  assert(evaluation.includes('UNKNOWN'));
  assert(!evaluation.includes('STALE / INCOMPLETE'));
});

test('allocation currentness does not label absent proof as stale or invalidated', () => {
  const model: Model = {
    ...workerEvidence,
    data: { id: evidenceBook, currency: 'PHP' },
    items: [{ id: evidenceBook, allocation: { id: evidenceBook } }],
  };
  const html = renderToStaticMarkup(<Run model={model} book={evidenceBook} />);
  assert(html.includes('currentness flag was not supplied'));
  assert(!html.includes('STALE / INVALIDATED'));
});

test('explicitly absent successful-work failure metadata is contextual, not UNKNOWN', () => {
  const html = work(workerEvidence.data!, workerEvidence.items!);
  assert(html.includes('No failure recorded'));
  assert(html.includes('No retry scheduled'));
  assert(html.includes('No active lease'));
  assert(!html.includes('UNKNOWN'));
  assert(html.includes('ingestion.normalization_requested'));
  const historicalFailure = work({
    ...workerEvidence.data,
    failureClass: 'TRANSIENT',
    failureCode: 'UPSTREAM_TIMEOUT',
  });
  assert(historicalFailure.includes('UPSTREAM_TIMEOUT'));
  assert(!historicalFailure.includes('No failure recorded'));
});

test('failed work and unavailable failure metadata cannot become no-failure claims', () => {
  const failed = work({
    ...workerEvidence.data,
    state: 'FAILED_TERMINAL',
    failureClass: 'DOMAIN_REJECTION',
    failureCode: 'DEMO_POISON',
  });
  assert(failed.includes('FAILED_TERMINAL'));
  assert(failed.includes('class="status fail"'));
  assert(failed.includes('DOMAIN_REJECTION'));
  assert(failed.includes('DEMO_POISON'));
  for (const data of [
    { ...workerEvidence.data!, state: 'FAILED_TERMINAL' },
    { state: 'SUCCEEDED' },
    { failureClass: null, failureCode: null },
  ]) {
    const html = work(data);
    assert(!html.includes('No failure recorded'));
    assert(html.includes('UNKNOWN') || html.includes('not supplied'));
  }
});

test('no pending work requires supplied aggregate evidence, not missing fields', () => {
  const render = (data: Row) =>
    renderToStaticMarkup(
      <Workers
        model={{ ...workerEvidence, data, items: [] }}
        book={evidenceBook}
      />,
    );
  assert(
    render({ counts: {}, oldestPendingAt: null }).includes('No pending work'),
  );
  assert(!render({}).includes('No pending work'));
  assert(
    !render({ counts: { PENDING: '1' }, oldestPendingAt: null }).includes(
      'No pending work',
    ),
  );
  assert(render({}).includes('UNKNOWN'));
});

test('not-applicable worker times require a known state and explicit null', () => {
  const pending = work({
    ...workerEvidence.data,
    state: 'PENDING',
    completedAt: null,
  });
  assert(pending.includes('Not completed'));
  const retryable = work({
    ...workerEvidence.data,
    state: 'RETRYABLE',
    nextAttemptAt: null,
  });
  assert(!retryable.includes('No retry scheduled'));
  const processing = work({
    ...workerEvidence.data,
    state: 'PROCESSING',
    leaseExpiresAt: null,
  });
  assert(!processing.includes('No active lease'));
  const unavailable = work({ state: 'SUCCEEDED' });
  assert(unavailable.includes('Unavailable (not supplied)'));
  assert(!unavailable.includes('No retry scheduled'));
});

test('case absence is contextual without inventing financial reconciliation', () => {
  const render = (data: Row) =>
    renderToStaticMarkup(
      <Case
        model={{ ...workerEvidence, data, items: [] }}
        book={evidenceBook}
      />,
    );
  const open = render({ state: 'OPEN', resolution: null, assigneeId: null });
  assert(open.includes('Not resolved'));
  assert(open.includes('Unassigned'));
  assert(!open.includes(renderToStaticMarkup(<Status value="UNRECONCILED" />)));
  const missing = render({ state: 'OPEN' });
  assert(!missing.includes('Not resolved'));
  assert(!missing.includes('Unassigned'));
  const resolved = render({
    state: 'RESOLVED',
    resolution: 'ACCEPTED_RISK',
    currentlyReconciled: false,
  });
  assert(resolved.includes('ACCEPTED_RISK'));
  assert(resolved.includes('UNRECONCILED'));
});
