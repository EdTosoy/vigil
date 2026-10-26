import assert from 'node:assert/strict';
import { test } from 'node:test';
import { navigation } from '../server/navigation';
import {
  detailUrl,
  originUrl,
  recordAnchor,
  url,
  type Search,
} from '../components/navigation';

const book = '11111111-1111-4111-8111-111111111111';
const otherBook = '22222222-2222-4222-8222-222222222222';
const evaluation = '33333333-3333-4333-8333-333333333333';
const record = '44444444-4444-4444-8444-444444444444';
const cursor = Buffer.from(
  JSON.stringify({ time: '2026-01-01T00:00:00.123456Z', id: record }),
).toString('base64url');
const query = (href: string): Search =>
  Object.fromEntries(new URL(href, 'http://local').searchParams);

test('filtered page -> detail -> originating results preserves scope, filters, cursor and row', () => {
  const filters = { status: 'SUCCEEDED', cursor, limit: '1', id: record };
  const href = detailUrl('workers', book, evaluation, record, filters);
  const detail = navigation(query(href), 'workers', record);
  assert.deepEqual(detail.issues, []);
  assert.deepEqual(detail.filters, { evaluation, id: record });
  assert.deepEqual(detail.origin?.filters, filters);
  const returned = new URL(originUrl(detail.origin!), 'http://local');
  assert.equal(returned.searchParams.get('status'), 'SUCCEEDED');
  assert.equal(returned.searchParams.get('cursor'), cursor);
  assert.equal(returned.searchParams.get('evaluation'), evaluation);
  assert.equal(
    decodeURIComponent(returned.hash.slice(1)),
    recordAnchor(record),
  );
});

test('related evidence retains the original results without applying another route filters', () => {
  const from = query(
    detailUrl('exceptions', book, evaluation, record, {
      status: 'OPEN',
      category: 'AMOUNT_MISMATCH',
    }),
  )['from'] as string;
  const href = url('reconciliation', book, evaluation, record, { from });
  const next = navigation(query(href), 'reconciliation', record);
  assert.deepEqual(next.issues, []);
  assert.equal(next.origin?.section, 'exceptions');
  assert.equal(next.origin?.filters['status'], 'OPEN');
  assert.equal(next.filters['status'], undefined);
  assert.equal(next.evaluation, evaluation);
});

test('an explicit empty book overrides a configured default and clears scope on selection links', () => {
  assert.equal(navigation({}, 'workers', undefined, book).book, book);
  const selection = navigation(
    query(url('workers', null)),
    'workers',
    undefined,
    book,
  );
  assert.equal(selection.book, null);
  assert.deepEqual(selection.issues, []);
  const switched = new URL(url('workers', otherBook), 'http://local');
  assert.deepEqual([...switched.searchParams], [['book', otherBook]]);
  assert.equal(
    navigation({ book: 'bad' }, 'workers', undefined, book).book,
    null,
  );
});

test('deep-link parsing is deterministic across refreshes and control keys remain opaque', () => {
  const key = 'SOURCE_PERIOD:acct_ABC-9.v1/REF?x=Y+Z';
  const href = detailUrl(
    'controls',
    book,
    evaluation,
    'result',
    { status: 'UNKNOWN' },
    undefined,
    { key },
  );
  const search = query(href);
  assert.deepEqual(
    navigation(search, 'controls', 'result'),
    navigation(search, 'controls', 'result'),
  );
  const parsed = navigation(search, 'controls', 'result');
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.filters['key'], key);
  assert.equal(parsed.origin?.record, key);
});

test('malformed identifiers keep valid scope and correction values without a valid read selection', () => {
  const parsed = navigation(
    { book, evaluation, status: 'SUCCEEDED', id: 'not-a-uuid', limit: '1' },
    'workers',
  );
  assert.equal(parsed.book, book);
  assert.equal(parsed.evaluation, evaluation);
  assert.equal(parsed.values['id'], 'not-a-uuid');
  assert.equal(parsed.filters['id'], undefined);
  assert.equal(parsed.filters['status'], 'SUCCEEDED');
  assert(parsed.issues.some((issue) => issue.field === 'id'));
  const corrected = navigation(
    { book, evaluation, status: 'SUCCEEDED', id: record },
    'workers',
  );
  assert.deepEqual(corrected.issues, []);
  assert.equal(corrected.filters['id'], record);
});

test('malformed evaluation and duplicate parameters do not erase valid book/filter recovery context', () => {
  const parsed = navigation(
    { book, evaluation: 'bad', status: 'SUCCEEDED', id: [record, record] },
    'workers',
  );
  assert.equal(parsed.book, book);
  assert.equal(parsed.values['evaluation'], 'bad');
  assert.equal(parsed.evaluation, undefined);
  assert.equal(parsed.filters['status'], 'SUCCEEDED');
  assert.equal(parsed.issues.length, 2);
});

test('page-specific and detail-specific query contracts reject unrelated state', () => {
  for (const [section, id, extra] of [
    ['workers', undefined, { currency: 'USD' }],
    ['integrity', undefined, { status: 'PASS' }],
    ['overview', undefined, { id: record }],
    ['workers', record, { status: 'SUCCEEDED' }],
    ['exceptions', record, { id: record }],
    ['controls', 'other', { key: 'valid', evaluation }],
    ['workers', undefined, { returnTo: 'https://example.com' }],
  ] as const)
    assert(navigation({ book, ...extra }, section, id).issues.length > 0);
});

test('origin contexts are bounded, closed, validated and bound to the selected book', () => {
  const valid = {
    book,
    section: 'workers',
    evaluation,
    filters: { status: 'SUCCEEDED', cursor, limit: '1' },
    record,
  };
  for (const value of [
    { ...valid, book: otherBook },
    { ...valid, section: 'https://example.com' },
    { ...valid, path: '//example.com' },
    { ...valid, filters: { category: 'SOURCE' } },
    { ...valid, filters: { status: 'OPEN' } },
    { ...valid, filters: { limit: '101' } },
    { ...valid, filters: { cursor: 'bad' } },
    { ...valid, filters: { from: JSON.stringify(valid) } },
    { ...valid, record: 'not-a-uuid' },
    { ...valid, evaluation: 'not-a-uuid' },
    [],
    null,
  ]) {
    const parsed = navigation(
      { book, from: JSON.stringify(value) },
      'workers',
      record,
    );
    assert.equal(parsed.origin, undefined);
    assert(parsed.issues.some((issue) => issue.field === 'from'));
  }
  assert(
    navigation({ book, from: 'x'.repeat(4097) }, 'workers', record).issues
      .length > 0,
  );
});

test('URL extras cannot replace the selected book or evaluation', () => {
  const parsed = query(
    url('workers', book, evaluation, record, {
      book: otherBook,
      evaluation: record,
    }),
  );
  assert.equal(parsed['book'], book);
  assert.equal(parsed['evaluation'], evaluation);
  for (const destination of [
    '//example.com',
    'https://example.com',
    '../workers',
  ])
    assert.throws(() => url(destination, book));
});
