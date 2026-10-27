import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EvidenceValue, Table, Time } from '../components/common';
import {
  timestamp,
  timestampPresentation,
  money,
  age,
} from '../components/format';
import {
  Case,
  Control,
  Controls,
  Run,
  Work,
  Integrity,
} from '../components/views';
import {
  comparisonEvidence,
  exactReference,
  readabilityBook as book,
  readabilityEvaluation as evaluation,
  runReadability,
  sparseRunReadability,
  workerReadability,
} from './readability-fixtures';

test('only supplied exact evidence strings receive opt-in copy controls', () => {
  for (const value of [
    'ingestion.normalization_requested',
    'Evidence_ABC-9.v1:/ID',
    exactReference,
    'UNKNOWN',
    'Åß_ID__Ref.v2',
  ] as const) {
    const html = renderToStaticMarkup(
      <EvidenceValue value={value} label="reference" copy />,
    );
    assert(html.includes(value));
    assert(html.includes('aria-label="Copy reference"'));
    assert(html.includes('type="button"'));
    assert(html.includes('aria-live="polite"'));
  }
  for (const value of [null, undefined, '', 0, false])
    assert(
      !renderToStaticMarkup(
        <EvidenceValue value={value} label="reference" copy />,
      ).includes('<button'),
    );
  assert(
    !renderToStaticMarkup(
      <EvidenceValue value="valid_ID" label="reference" />,
    ).includes('<button'),
  );
});

test('financial comparisons retain exact signs, zero, unsupported currency and large aggregate strings', () => {
  const original = JSON.stringify(comparisonEvidence);
  const html = renderToStaticMarkup(
    <Controls model={comparisonEvidence} book={book} evaluation={evaluation} />,
  );
  for (const value of [
    'USD 9,007,199,254,740,993.00',
    'USD 9,007,199,254,740,992.99',
    'USD -0.01',
    'PHP 0.00',
    'UNKNOWN',
  ])
    assert(html.includes(value), value);
  assert.equal(
    money('-900719925474099300', 'USD'),
    'USD -9,007,199,254,740,993.00',
  );
  assert.equal(money('100', 'PHP'), 'PHP 1.00');
  assert.equal(money('100', 'USD'), 'USD 1.00');
  assert.equal(money('100', 'JPY'), 'UNKNOWN');
  assert.equal(money(100, 'USD'), 'UNKNOWN');
  assert.equal(money(undefined, 'USD'), 'UNKNOWN');
  assert.equal(JSON.stringify(comparisonEvidence), original);
  assert.match(html, /scope="col" class="numeric">Expected/);
  assert.match(html, /scope="col" class="numeric">Observed/);
  assert.match(html, /scope="col" class="numeric">Discrepancy/);
  assert(html.includes('aria-label="Frozen control comparisons"'));
  assert(!html.includes('1.2K'));
});

test('UTC presentation preserves all supplied fractional digits and the original source value', () => {
  for (const [source, utc] of [
    [
      '2026-01-01T08:00:00.123456789+08:00',
      '2026-01-01 00:00:00.123456789 UTC',
    ],
    ['2026-01-01 00:00:01.123456+00', '2026-01-01 00:00:01.123456 UTC'],
    ['2026-01-01T00:30:00.000000-0130', '2026-01-01 02:00:00.000000 UTC'],
    ['2026-01-01T00:00:00Z', '2026-01-01 00:00:00 UTC'],
    ['2024-03-01T00:30:00.1+01:00', '2024-02-29 23:30:00.1 UTC'],
  ] as const) {
    assert.equal(timestamp(source), utc);
    const html = renderToStaticMarkup(
      <Time value={source} source label="event timestamp" />,
    );
    assert(html.includes(utc));
    assert(html.includes(source));
    if (/\.\d{4,}/.test(source)) assert(!html.includes('<time '));
    else assert(html.includes('<time '));
    assert(html.includes('aria-label="Copy event timestamp"'));
  }
});

test('missing, unsupported and ambiguous timestamps never gain an inferred timezone or instant', () => {
  assert.equal(timestamp(null), 'Not recorded');
  assert.equal(timestamp(undefined), 'Unavailable (not supplied)');
  for (const source of ['2026-01-01', '2026-01-01T12:30:00']) {
    const html = renderToStaticMarkup(<Time value={source} source />);
    assert(html.includes('Timezone not supplied; UTC not inferred'));
    assert(html.includes(source));
    assert(!html.includes('<time'));
    assert.equal(timestampPresentation(source).epochMs, undefined);
  }
  for (const source of [
    '2026-02-30T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:00+24:00',
    '2016-12-31T23:59:60Z',
    'not-a-timestamp',
  ]) {
    const html = renderToStaticMarkup(<Time value={source} source />);
    assert(html.includes('cannot be interpreted safely'));
    assert(html.includes(source));
    assert(!html.includes('<time'));
  }
  const unknownLocal = timestampPresentation('2026-01-01T00:00:00-00:00');
  assert.equal(unknownLocal.text, '2026-01-01 00:00:00 UTC');
  assert(unknownLocal.note?.includes('local offset is unknown'));
  assert(
    !renderToStaticMarkup(<Time value={null} source />).includes('<button'),
  );
  assert(!renderToStaticMarkup(<Time value={''} source />).includes('<button'));
});

test('timestamp output is independent of host timezone and ages refuse ambiguous inputs', () => {
  const previous = process.env['TZ'];
  try {
    for (const zone of ['UTC', 'Asia/Manila', 'America/New_York']) {
      process.env['TZ'] = zone;
      assert.equal(
        timestamp('2026-01-01T08:00:00.123456+08:00'),
        '2026-01-01 00:00:00.123456 UTC',
      );
      assert.equal(age('2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z'), '1m');
      assert.equal(
        age('2026-01-01T00:00:00', '2026-01-01T00:01:00Z'),
        'UNKNOWN',
      );
    }
  } finally {
    if (previous === undefined) delete process.env['TZ'];
    else process.env['TZ'] = previous;
  }
});

test('structured details retain primary outcome, full raw records and exact identifiers', () => {
  for (const [View, model, sections] of [
    [
      Run,
      runReadability,
      [
        'Identity and financial scope',
        'Frozen population',
        'Window and processing times',
        'Identity and source',
        'Source time and eligibility',
      ],
    ],
    [
      Control,
      comparisonEvidence,
      [
        'Identity and evaluation',
        'Expected, observed and discrepancy',
        'Financial scope and evaluation time',
        'Supporting evidence',
      ],
    ],
    [
      Work,
      workerReadability,
      [
        'Identity and source',
        'Operational failure metadata',
        'Work timestamps',
      ],
    ],
  ] as const) {
    const original = JSON.stringify(model);
    const html = renderToStaticMarkup(
      <View model={model} book={book} evaluation={evaluation} />,
    );
    for (const section of sections) assert(html.includes(section), section);
    assert(html.includes('Raw approved read evidence'));
    assert(html.includes('Copy '));
    assert.equal(JSON.stringify(model), original);
  }
  const html = renderToStaticMarkup(
    <Run model={runReadability} book={book} evaluation={evaluation} />,
  );
  assert(html.includes(exactReference));
  assert(
    html.indexOf('MISSING_BANK_MOVEMENT') <
      html.indexOf('Frozen provenance, revision history and declarations'),
  );
  assert(html.includes('Trace_SEGMENT-9.'));
  assert(!html.includes('Trace SEGMENT'));
});

test('sparse detail evidence remains unavailable or UNKNOWN without copyable placeholders', () => {
  const html = renderToStaticMarkup(
    <Run model={sparseRunReadability} book={book} />,
  );
  assert(html.includes('Unavailable (not supplied)'));
  assert(html.includes('UNKNOWN'));
  assert(html.includes('Timezone not supplied; UTC not inferred'));
  assert(!html.includes('USD 0.00'));
  const empty = renderToStaticMarkup(
    <Control model={{ ...comparisonEvidence, data: {} }} book={book} />,
  );
  assert(!empty.includes('<button'));
  assert(empty.includes('UNKNOWN'));
  const integrity = renderToStaticMarkup(
    <Integrity
      model={{ ...comparisonEvidence, data: { integrity: {} } }}
      book={book}
    />,
  );
  assert(integrity.includes('Structural violation evidence unavailable'));
  assert(!integrity.includes('No structural violations detected'));
});

test('structured case relationships preserve scope and explicitly qualify accepted risk', () => {
  const from = JSON.stringify({
    book,
    section: 'exceptions',
    filters: { status: 'RESOLVED' },
  });
  const html = renderToStaticMarkup(
    <Case
      model={{
        ...workerReadability,
        data: {
          id: book,
          itemId: evaluation,
          state: 'RESOLVED',
          resolution: 'ACCEPTED_RISK',
          currentlyReconciled: false,
          currency: 'USD',
          exposure: { amountMinor: '500' },
          evidenceRunId: evaluation,
          createdAt: '2026-01-01T00:00:00.123456Z',
        },
      }}
      book={book}
      evaluation={evaluation}
      from={from}
    />,
  );
  assert(html.includes('Identity and financial scope'));
  assert(html.includes('Case timestamps'));
  assert(html.includes('UNRECONCILED'));
  assert(html.includes('Accepted risk is an operational disposition'));
  const href = [...html.matchAll(/href="([^"]+)"/g)]
    .map((m) => new URL(m[1]!.replaceAll('&amp;', '&'), 'http://local'))
    .find((url) => url.pathname.startsWith('/reconciliation/'))!;
  assert.equal(href.searchParams.get('book'), book);
  assert.equal(href.searchParams.get('evaluation'), evaluation);
  assert.equal(href.searchParams.get('from'), from);
});

test('named comparison regions and numeric headers retain semantic table structure', () => {
  const html = renderToStaticMarkup(
    <Table
      label="Exact allocation contributions"
      numeric={[1]}
      headers={['Identity', 'Contribution']}
    >
      <tr>
        <td>REF_ABC</td>
        <td className="money">USD -0.01</td>
      </tr>
    </Table>,
  );
  assert(
    html.includes('role="region" aria-label="Exact allocation contributions"'),
  );
  assert(html.includes('tabIndex="0"') || html.includes('tabindex="0"'));
  assert(html.includes('scope="col" class="numeric">Contribution'));
  assert(html.includes('<tbody>'));
});

test('an absent related run does not create a link to a placeholder entity', () => {
  const html = renderToStaticMarkup(
    <Case
      model={{ ...workerReadability, data: { id: book, state: 'OPEN' } }}
      book={book}
      evaluation={evaluation}
    />,
  );
  assert(html.includes('Related reconciliation run unavailable'));
  assert(!html.includes('/reconciliation/UNKNOWN'));
  assert(!html.includes('/reconciliation/undefined'));
});
