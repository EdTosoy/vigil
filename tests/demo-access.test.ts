import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { demoAccess } from '../apps/ops/demo-access';

test('CSP permits React debugging eval only in development and preserves production policy', async () => {
  const config = (
    await import(pathToFileURL(resolve('apps/ops/next.config.mjs')).href)
  ).default as {
    headers(): Promise<
      Array<{ source: string; headers: Array<{ key: string; value: string }> }>
    >;
  };
  const productionPolicy =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
  const originalMode = process.env['NODE_ENV'];
  try {
    for (const mode of ['production', 'test', undefined, 'development']) {
      if (mode === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = mode;
      const rules = await config.headers();
      const rule = rules[0];
      assert.ok(rule);
      assert.equal(rule.source, '/:path*');
      const policy = rule.headers.find(
        (header) => header.key === 'Content-Security-Policy',
      )?.value;
      assert.equal(
        policy,
        mode === 'development'
          ? productionPolicy.replace(
              "script-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            )
          : productionPolicy,
      );
    }
  } finally {
    if (originalMode === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalMode;
  }
});

test('hosted demo access is fail-closed and protects financial routes and metrics', () => {
  const env = {
    FLOW_DEPLOYMENT_MODE: 'demo',
    FLOW_DEMO_USERNAME: 'demo',
    FLOW_DEMO_PASSWORD: 'a'.repeat(48),
  };
  const basic = (value: string) =>
    'Basic ' + Buffer.from(value).toString('base64');
  for (const path of [
    '/',
    '/controls',
    '/metrics',
    '/health/ready/extra',
    '/overview',
    '/_next/data/x',
  ]) {
    assert.equal(demoAccess(path, null, env), 401);
    assert.equal(demoAccess(path, basic('demo:wrong'), env), 401);
    assert.equal(
      demoAccess(path, basic('demo:' + env.FLOW_DEMO_PASSWORD), env),
      200,
    );
    assert.equal(demoAccess(path, null, { FLOW_DEPLOYMENT_MODE: 'demo' }), 503);
  }
  assert.equal(
    demoAccess('/', basic('demo:' + env.FLOW_DEMO_PASSWORD), {
      ...env,
      FLOW_DEPLOYMENT_MODE: 'unknown',
    }),
    503,
  );
  assert.equal(demoAccess('/', 'Basic ' + 'a'.repeat(2000), env), 401);
  assert.equal(demoAccess('/health/live', null, env), 200);
  assert.equal(demoAccess('/health/ready', null, env), 200);
  assert.equal(demoAccess('/', null, {}), 200); // Existing explicitly local workflow.
});

test('Vigil demo configuration supports legacy fallbacks without bypassing access checks', () => {
  const env = {
    VIGIL_DEPLOYMENT_MODE: 'demo',
    VIGIL_DEMO_USERNAME: 'vigil-demo',
    VIGIL_DEMO_PASSWORD: 'v'.repeat(48),
    FLOW_DEPLOYMENT_MODE: 'demo',
    FLOW_DEMO_USERNAME: 'legacy-demo',
    FLOW_DEMO_PASSWORD: 'l'.repeat(48),
  };
  const basic = (user: string, password: string) =>
    'Basic ' + Buffer.from(user + ':' + password).toString('base64');
  const current = basic(env.VIGIL_DEMO_USERNAME, env.VIGIL_DEMO_PASSWORD);
  const legacy = basic(env.FLOW_DEMO_USERNAME, env.FLOW_DEMO_PASSWORD);
  assert.equal(demoAccess('/', null, env), 401);
  assert.equal(demoAccess('/', current, env), 200);
  assert.equal(demoAccess('/', legacy, env), 401);
  assert.equal(
    demoAccess('/', current, { ...env, VIGIL_DEPLOYMENT_MODE: 'invalid' }),
    503,
  );
  assert.equal(
    demoAccess('/', current, { ...env, VIGIL_DEMO_PASSWORD: '' }),
    503,
  );
  assert.equal(
    demoAccess('/', legacy, {
      FLOW_DEPLOYMENT_MODE: env.FLOW_DEPLOYMENT_MODE,
      FLOW_DEMO_USERNAME: env.FLOW_DEMO_USERNAME,
      FLOW_DEMO_PASSWORD: env.FLOW_DEMO_PASSWORD,
    }),
    200,
  );
  assert.equal(
    demoAccess('/', legacy, {
      VIGIL_DEPLOYMENT_MODE: 'demo',
      FLOW_DEMO_USERNAME: env.FLOW_DEMO_USERNAME,
      FLOW_DEMO_PASSWORD: env.FLOW_DEMO_PASSWORD,
    }),
    200,
  );
});

test('Vigil build IDs preserve legacy image revision fallback', async () => {
  const config = (
    await import(pathToFileURL(resolve('apps/ops/next.config.mjs')).href)
  ).default as { generateBuildId(): Promise<string | null> };
  const current = process.env['VIGIL_IMAGE_REVISION'];
  const legacy = process.env['FLOW_IMAGE_REVISION'];
  try {
    delete process.env['VIGIL_IMAGE_REVISION'];
    process.env['FLOW_IMAGE_REVISION'] = 'legacy-image';
    assert.equal(await config.generateBuildId(), 'legacy-image');
    process.env['VIGIL_IMAGE_REVISION'] = 'vigil-image';
    assert.equal(await config.generateBuildId(), 'vigil-image');
    delete process.env['VIGIL_IMAGE_REVISION'];
    delete process.env['FLOW_IMAGE_REVISION'];
    assert.equal(await config.generateBuildId(), null);
  } finally {
    if (current === undefined) delete process.env['VIGIL_IMAGE_REVISION'];
    else process.env['VIGIL_IMAGE_REVISION'] = current;
    if (legacy === undefined) delete process.env['FLOW_IMAGE_REVISION'];
    else process.env['FLOW_IMAGE_REVISION'] = legacy;
  }
});
