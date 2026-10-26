import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Case,
  Control,
  Controls,
  Exceptions,
  Reconciliation,
  Workers,
} from '../components/views';
import type { Model } from '../components/model';
import { evidenceBook as book, workerEvidence } from './evidence-fixtures';

const evaluation = '33333333-3333-4333-8333-333333333333';
const record = '44444444-4444-4444-8444-444444444444';
const links = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map(
    (match) => new URL(match[1]!.replaceAll('&amp;', '&'), 'http://local'),
  );

test('all four list detail links carry only their validated originating view state', () => {
  for (const [View, section, status] of [
    [Workers, 'workers', 'SUCCEEDED'],
    [Exceptions, 'exceptions', 'OPEN'],
    [Reconciliation, 'reconciliation', 'COMPLETED'],
    [Controls, 'controls', 'UNKNOWN'],
  ] as const) {
    const model: Model = {
      ...workerEvidence,
      items: [
        {
          id: record,
          key: 'SOURCE_PERIOD:acct_ABC',
          state: status,
          evidenceRunId: record,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <View
        model={model}
        book={book}
        evaluation={evaluation}
        filters={{ status, limit: '1', unrelated: 'discard' }}
      />,
    );
    const href = links(html).find((link) =>
      link.pathname.startsWith('/' + section + '/'),
    )!;
    assert(href);
    assert.equal(href.searchParams.get('book'), book);
    assert.equal(href.searchParams.get('evaluation'), evaluation);
    assert.equal(href.searchParams.has('status'), false);
    const origin = JSON.parse(href.searchParams.get('from')!);
    assert.equal(origin.section, section);
    assert.deepEqual(origin.filters, { status, limit: '1' });
    assert(html.includes('id="record-'));
    if (section === 'controls')
      assert.match(html, /class="identifier"[^>]*>SOURCE_PERIOD:acct_ABC<\/a>/);
  }
});

test('control-to-case links keep selected evaluation and an existing results origin', () => {
  const from = JSON.stringify({
    book,
    section: 'controls',
    evaluation,
    filters: { status: 'FAIL' },
    record: 'SOURCE_PERIOD:acct_ABC',
  });
  const html = renderToStaticMarkup(
    <Control
      model={{ ...workerEvidence, data: { caseIds: [record] } }}
      book={book}
      evaluation={evaluation}
      from={from}
    />,
  );
  const href = links(html).find(
    (link) => link.pathname === '/exceptions/' + record,
  )!;
  assert.equal(href.searchParams.get('evaluation'), evaluation);
  assert.equal(href.searchParams.get('from'), from);
});

test('related run and control links identify their record and preserve origin while using target evaluation', () => {
  const from = JSON.stringify({
    book,
    section: 'exceptions',
    evaluation,
    filters: { status: 'OPEN' },
    record,
  });
  const targetEvaluation = '55555555-5555-4555-8555-555555555555';
  const html = renderToStaticMarkup(
    <Case
      model={{
        ...workerEvidence,
        data: {
          id: record,
          evidenceRunId: record,
          linkedControls: [
            { evaluation: targetEvaluation, key: 'BANK_TOTAL:acct_X' },
          ],
        },
        items: [],
      }}
      book={book}
      evaluation={evaluation}
      from={from}
    />,
  );
  const targets = links(html);
  const run = targets.find(
    (link) => link.pathname === '/reconciliation/' + record,
  )!;
  assert.equal(run.searchParams.get('from'), from);
  assert.equal(run.searchParams.get('evaluation'), evaluation);
  assert(html.includes('Inspect linked reconciliation run ' + record));
  const control = targets.find((link) => link.pathname === '/controls/result')!;
  assert.equal(control.searchParams.get('evaluation'), targetEvaluation);
  assert.equal(control.searchParams.get('from'), from);
  assert.equal(control.searchParams.get('key'), 'BANK_TOTAL:acct_X');
  assert.equal(control.searchParams.has('status'), false);
});
