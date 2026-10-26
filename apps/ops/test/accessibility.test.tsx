import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Table, Status } from '../components/common';
import { Controls, Exceptions, Workers } from '../components/views';
import type { Model } from '../components/model';

const id = 'Evidence_ID.Mixed-case:2026_10-27';
const model: Model = {
  version: 'operations-read-v1',
  asOf: '2026-10-27T00:00:00Z',
  nextCursor: null,
  data: null,
  items: [
    {
      id,
      key: id,
      type: 'SOURCE_PERIOD',
      state: 'FAILED_TERMINAL',
      status: 'UNKNOWN',
      currentlyReconciled: false,
      eventType: 'ingestion.normalization_requested',
      scope: {},
      exposure: {},
    },
  ],
};
test('financial tables retain named regions, captions and scoped column headings', () => {
  const html = renderToStaticMarkup(
    <Table
      label="Exact comparison"
      headers={['Evidence', 'Amount']}
      numeric={[1]}
      identity
    >
      <tr>
        <th scope="row">{id}</th>
        <td>PHP -90,071,992,547,409.93</td>
      </tr>
    </Table>,
  );
  assert(html.includes('role="region" aria-label="Exact comparison"'));
  assert(html.includes('<caption class="sr-only">Exact comparison</caption>'));
  assert(html.includes('scope="col" class="numeric">Amount'));
  assert(html.includes('tabindex="0"'));
  assert(html.includes(id));
  assert(html.includes('PHP -90,071,992,547,409.93'));
});
test('record row headers retain identity and distinct textual state during horizontal scrolling', () => {
  for (const View of [Controls, Exceptions, Workers]) {
    const html = renderToStaticMarkup(
      <View model={model} book="f264ba54-0070-4931-8492-d97d5f610435" />,
    );
    const rowHeader = html.match(/<th scope="row">([\s\S]*?)<\/th>/)?.[1];
    assert(rowHeader?.includes(id));
    assert(rowHeader?.includes('class="status'));
    assert(!rowHeader?.includes('normalization requested'));
    if (View === Exceptions) {
      assert(rowHeader?.includes('Financial state'));
      assert(rowHeader?.includes('Operational state'));
      assert(rowHeader?.includes('UNRECONCILED'));
    }
  }
});
test('assurance and adverse status text remains available without icons or color', () => {
  for (const value of [
    'CURRENT',
    'STALE',
    'INCOMPLETE',
    'UNKNOWN',
    'FAIL',
    'FAILED_TERMINAL',
  ]) {
    const html = renderToStaticMarkup(<Status value={value} />);
    assert(html.includes('aria-hidden="true"'));
    assert(html.endsWith(` ${value}</span>`));
  }
});
