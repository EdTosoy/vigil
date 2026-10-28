import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { proxy, config } from '../proxy';
// The constant matcher is a regex; next build also validates its framework compilation.
const matchesProxy = ({
  url,
}: {
  config: typeof config;
  nextConfig: Record<string, never>;
  url: string;
}) => new RegExp('^' + config.matcher[0] + '$').test(new URL(url).pathname);
import { demoAccess } from '../demo-access';
import {
  PUBLIC_DEMO_BOOK as book,
  PUBLIC_DEMO_EVALUATION as evaluation,
  readPublicDemo,
} from '../server/public-demo';
import { ReadUnavailable, InvalidRead } from '@vigil/operations-read-postgres';

test('public-demo has no login, retains auth on ordinary AWS demo', () => {
  assert.equal(
    demoAccess('/', null, {
      NODE_ENV: 'test',
      VIGIL_DEPLOYMENT_MODE: 'public-demo',
    }),
    200,
  );
  assert.equal(
    demoAccess('/', null, { NODE_ENV: 'test', VIGIL_DEPLOYMENT_MODE: 'demo' }),
    503,
  );
  assert.equal(
    demoAccess('/metrics', null, {
      NODE_ENV: 'test',
      VIGIL_DEPLOYMENT_MODE: 'public-demo',
    }),
    404,
  );
  assert.equal(
    demoAccess('/', null, {
      NODE_ENV: 'test',
      VIGIL_DEPLOYMENT_MODE: 'unknown',
    }),
    503,
  );
});

test('public demo is synthetic and never admits a different book', () => {
  const result = readPublicDemo('overview', book, { evaluation });
  assert.equal(
    result.data?.['book'] &&
      (result.data['book'] as Record<string, unknown>)['environment'],
    'synthetic',
  );
  assert.equal(result.checks?.ledger, 'UNKNOWN');
  assert.equal(result.checks?.workerRecoverability, 'UNKNOWN');
  const snapshot = JSON.stringify(result);
  assert(snapshot.includes('illustrative-synthetic'));
  assert(!snapshot.includes('acct_1UOVU2AoTLlql5uC'));
  assert.throws(
    () => readPublicDemo('overview', '99999999-9999-4999-8999-999999999999'),
    ReadUnavailable,
  );
});

test('public demo supports navigation but rejects unknown records and pagination', () => {
  assert.equal(readPublicDemo('books', null).items?.length, 1);
  assert.equal(readPublicDemo('exceptions', book).items?.length, 1);
  assert.equal(
    readPublicDemo('controls', book, { evaluation }).items?.length,
    1,
  );
  assert.equal(readPublicDemo('workers', book).items?.length, 1);
  assert.throws(
    () =>
      readPublicDemo('run', book, {
        id: '99999999-9999-4999-8999-999999999999',
      }),
    ReadUnavailable,
  );
  assert.throws(
    () => readPublicDemo('books', null, { cursor: 'invalid' }),
    InvalidRead,
  );
});

const publicEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  VIGIL_DEPLOYMENT_MODE: 'public-demo',
};
const detailPaths = () => [
  ...(['reconciliation', 'exceptions', 'workers'] as const).map(
    (section) =>
      `/${section}/${readPublicDemo(section, book).items![0]!['id']}`,
  ),
  `/controls/${encodeURIComponent(String(readPublicDemo('controls', book, { evaluation }).items![0]!['key']))}`,
];
const deniedPaths = [
  '/metrics',
  '/metrics/extra',
  '/webhooks/stripe',
  '/api',
  '/api/records',
  '/admin',
  '/private',
  '/login',
  '/unknown',
  '/overview/private',
  '/integrity/private',
  '/controls/key/extra',
  '/workers/not-a-uuid',
  '/health/ready/extra',
  '/favicon.ico/private',
  '/_next/image-private',
  '/_next/static-private',
  '/controls/%00',
  '/controls/%ZZ',
];

test('closed public allowlist permits only dashboard lists, supported detail shapes and exact probes', () => {
  for (const path of [
    '/',
    '/overview',
    '/reconciliation',
    '/exceptions',
    '/controls',
    '/workers',
    '/integrity',
    '/health/live',
    '/health/ready',
    ...detailPaths(),
  ]) {
    for (const method of ['GET', 'HEAD'])
      assert.equal(demoAccess(path, null, publicEnv, method), 200, path);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
      assert.equal(demoAccess(path, null, publicEnv, method), 404, path);
  }
  for (const path of deniedPaths) {
    assert.equal(demoAccess(path, null, publicEnv), 404, path);
    assert.equal(demoAccess(path, 'Basic ignored', publicEnv), 404, path);
  }
});

test('proxy returns plain public 404s without Basic challenges and keeps framework asset exclusions exact', () => {
  const previous = process.env['VIGIL_DEPLOYMENT_MODE'];
  try {
    process.env['VIGIL_DEPLOYMENT_MODE'] = 'public-demo';
    for (const path of deniedPaths) {
      assert(
        matchesProxy({
          config,
          nextConfig: {},
          url: `https://demo.invalid${path}`,
        }),
        path,
      );
      const response = proxy(new NextRequest(`https://demo.invalid${path}`));
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get('www-authenticate'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    for (const path of ['/', '/controls?book=' + book, ...detailPaths()]) {
      const response = proxy(new NextRequest(`https://demo.invalid${path}`));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('www-authenticate'), null);
    }
    assert.equal(
      proxy(
        new NextRequest('https://demo.invalid/controls', { method: 'POST' }),
      ).status,
      404,
    );
    for (const path of [
      '/_next/static/chunk.js',
      '/_next/image',
      '/favicon.ico',
    ])
      assert.equal(
        matchesProxy({
          config,
          nextConfig: {},
          url: `https://demo.invalid${path}`,
        }),
        false,
        path,
      );
  } finally {
    if (previous === undefined) delete process.env['VIGIL_DEPLOYMENT_MODE'];
    else process.env['VIGIL_DEPLOYMENT_MODE'] = previous;
  }
});

test('AWS demo proxy retains Basic challenges and authorized access, including metrics', () => {
  const names = [
    'VIGIL_DEPLOYMENT_MODE',
    'VIGIL_DEMO_USERNAME',
    'VIGIL_DEMO_PASSWORD',
  ];
  const previous = names.map((name) => process.env[name]);
  try {
    process.env['VIGIL_DEPLOYMENT_MODE'] = 'demo';
    process.env['VIGIL_DEMO_USERNAME'] = 'fixture';
    process.env['VIGIL_DEMO_PASSWORD'] = 'x'.repeat(48);
    for (const path of ['/', '/metrics', '/private']) {
      const denied = proxy(new NextRequest(`https://demo.invalid${path}`));
      assert.equal(denied.status, 401);
      assert.match(denied.headers.get('www-authenticate')!, /^Basic /);
      const allowed = proxy(
        new NextRequest(`https://demo.invalid${path}`, {
          headers: {
            authorization:
              'Basic ' +
              Buffer.from('fixture:' + 'x'.repeat(48)).toString('base64'),
          },
        }),
      );
      assert.equal(allowed.status, 200);
    }
  } finally {
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    });
  }
});

test('legacy-only public mode cannot open the PostgreSQL-backed reader', () => {
  assert.equal(
    demoAccess('/', null, {
      NODE_ENV: 'test',
      FLOW_DEPLOYMENT_MODE: 'public-demo',
    }),
    404,
  );
});

test('public server dispatch ignores configured database credentials and rejects foreign books', async () => {
  const { read, ready } = await import('../server/read');
  const names = ['VIGIL_DEPLOYMENT_MODE', 'DATABASE_OPERATIONS_URL'];
  const previous = names.map((name) => process.env[name]);
  try {
    process.env['VIGIL_DEPLOYMENT_MODE'] = 'public-demo';
    process.env['DATABASE_OPERATIONS_URL'] =
      'postgresql://fixture:synthetic-only-sentinel@127.0.0.1:1/unreachable';
    await ready();
    const snapshot = JSON.stringify(
      await read('overview', book, { evaluation }),
    );
    assert(snapshot.includes('illustrative-synthetic'));
    assert(!snapshot.includes('synthetic-only-sentinel'));
    await assert.rejects(
      () => read('overview', '99999999-9999-4999-8999-999999999999'),
      ReadUnavailable,
    );
  } finally {
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    });
  }
});
