import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { Pool } from 'pg';
import { createAuthRuntime } from '../server/auth-runtime';

const env = () => ({
  NODE_ENV: 'test' as const,
  VIGIL_DEPLOYMENT_MODE: 'application',
  DATABASE_AUTH_URL: 'postgresql://auth_runtime@127.0.0.1:1/test',
  BETTER_AUTH_SECRET: 'test-only-authentication-secret-with-sufficient-length',
  BETTER_AUTH_URL: 'http://127.0.0.1:3000',
});

test('a failed startup check recovers after backoff without new pools or concurrent duplicate checks', async () => {
  const pool = new Pool();
  let pools = 0;
  let checks = 0;
  const query = mock.method(pool, 'query', async () => {
    checks++;
    if (checks === 1) throw new Error('test-only transient database failure');
    return { rows: [{ safe: true, ready: true }] };
  });
  const runtime = createAuthRuntime(env(), () => {
    pools++;
    return pool;
  });
  try {
    const failures = await Promise.allSettled(
      Array.from({ length: 8 }, () => runtime.service()),
    );
    assert(failures.every((result) => result.status === 'rejected'));
    assert.equal(checks, 1);
    await assert.rejects(runtime.service());
    assert.equal(
      checks,
      1,
      'requests during backoff must not hit the database',
    );
    await new Promise((resolve) => setTimeout(resolve, 1050));
    const services = await Promise.all(
      Array.from({ length: 8 }, () => runtime.service()),
    );
    assert(services.every((service) => service === services[0]));
    assert.equal(pools, 1);
    assert.equal(
      checks,
      5,
      'one shared credential/schema/permission/book-authorization check for recovery',
    );
  } finally {
    query.mock.restore();
    await pool.end();
  }
});

test('public snapshot authentication refuses initialization without allocating a pool', async () => {
  const runtime = createAuthRuntime(
    { NODE_ENV: 'test', VIGIL_DEPLOYMENT_MODE: 'public-demo' },
    () => {
      throw new Error('Public snapshot must not allocate a pool');
    },
  );
  await assert.rejects(runtime.service(), /disabled/);
  await assert.rejects(runtime.ready(), /disabled/);
});

test('readiness rechecks permissions and invalidates initialization after a later outage', async () => {
  const pool = new Pool();
  let unavailable: Promise<never> | undefined;
  const query = mock.method(pool, 'query', async () => {
    if (unavailable) await unavailable;
    return { rows: [{ safe: true, ready: true }] };
  });
  const runtime = createAuthRuntime(env(), () => pool);
  try {
    await runtime.service();
    let failProbe!: (error: Error) => void;
    unavailable = new Promise<never>((_resolve, reject) => {
      failProbe = reject;
    });
    const denied = Promise.allSettled([runtime.ready(), runtime.service()]);
    failProbe(new Error('test-only later database outage'));
    assert((await denied).every((result) => result.status === 'rejected'));
    unavailable = undefined;
    await assert.rejects(runtime.service(), /backoff/);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await runtime.ready();
    await runtime.service();
  } finally {
    query.mock.restore();
    await pool.end();
  }
});

test('invalid configuration fails before allocating a scoped pool', async () => {
  let allocations = 0;
  const runtime = createAuthRuntime(
    { ...env(), BETTER_AUTH_SECRET: '' },
    () => {
      allocations++;
      return new Pool();
    },
  );
  await assert.rejects(runtime.service(), /BETTER_AUTH_SECRET/);
  assert.equal(allocations, 0);
});
