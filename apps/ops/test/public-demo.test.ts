import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoAccess } from '../demo-access';
import {
  PUBLIC_DEMO_BOOK as book,
  PUBLIC_DEMO_EVALUATION as evaluation,
  readPublicDemo,
} from '../server/public-demo';
import { ReadUnavailable, InvalidRead } from '@vigil/operations-read-postgres';

test('public-demo has no login, retains auth on ordinary AWS demo', () => {
  assert.equal(demoAccess('/', null, { VIGIL_DEPLOYMENT_MODE: 'public-demo' }), 200);
  assert.equal(demoAccess('/', null, { VIGIL_DEPLOYMENT_MODE: 'demo' }), 503);
  assert.equal(demoAccess('/metrics', null, { VIGIL_DEPLOYMENT_MODE: 'public-demo' }), 401);
  assert.equal(demoAccess('/', null, { VIGIL_DEPLOYMENT_MODE: 'unknown' }), 503);
});

test('public demo is synthetic and never admits a different book', () => {
  const result = readPublicDemo('overview', book, { evaluation });
  assert.equal(result.data?.['book'] &&
    (result.data['book'] as Record<string, unknown>)['environment'], 'synthetic');
  assert.equal(result.checks?.ledger, 'UNKNOWN');
  assert.equal(result.checks?.workerRecoverability, 'UNKNOWN');
  const snapshot = JSON.stringify(result);
  assert(snapshot.includes('illustrative-synthetic'));
  assert(!snapshot.includes('acct_1UOVU2AoTLlql5uC'));
  assert.throws(() =>
    readPublicDemo('overview', '99999999-9999-4999-8999-999999999999'), ReadUnavailable);
});

test('public demo supports navigation but rejects unknown records and pagination', () => {
  assert.equal(readPublicDemo('books', null).items?.length, 1);
  assert.equal(readPublicDemo('exceptions', book).items?.length, 1);
  assert.equal(readPublicDemo('controls', book, { evaluation }).items?.length, 1);
  assert.equal(readPublicDemo('workers', book).items?.length, 1);
  assert.throws(() =>
    readPublicDemo('run', book, { id: '99999999-9999-4999-8999-999999999999' }), ReadUnavailable);
  assert.throws(() =>
    readPublicDemo('books', null, { cursor: 'invalid' }), InvalidRead);
});
