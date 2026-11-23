import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  demoArguments,
  demoEnvironment,
  demoContainerName,
  LOCAL_DOCKER,
} from '../tools/local-demo-config';

test('help and strict arguments cannot choose an existing financial target or invoke setup', () => {
  assert.deepEqual(demoArguments(['--help']), { help: true, smoke: false });
  assert.deepEqual(demoArguments([]), { help: false, smoke: false });
  assert.deepEqual(demoArguments(['--smoke']), { help: false, smoke: true });
  for (const args of [
    ['--database', 'postgresql://existing'],
    ['--port', '5432'],
    ['--smoke', '--smoke'],
    ['--help', '--smoke'],
  ])
    assert.throws(() => demoArguments(args));
  const output = execFileSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      'tools/local-demo.ts',
      '--help',
    ],
    { encoding: 'utf8', env: { PATH: process.env['PATH']! } },
  );
  assert(output.includes('Usage: pnpm demo:local'));
  assert(!output.includes('VIGIL_LOCAL_DEMO_READY'));
});
test('child environment is explicit and rejects existing database/cloud/auth targets and preloads', () => {
  const env = {
    PATH: '/usr/bin',
    HOME: '/private',
    SECRET: 'not-for-child',
    NODE_OPTIONS: '--inspect',
  };
  assert.deepEqual(demoEnvironment(env), {
    PATH: '/usr/bin',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
  });
  for (const key of [
    'DATABASE_ADMIN_URL',
    'DATABASE_AUTH_URL',
    'STRIPE_SECRET_KEY',
    'AWS_PROFILE',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'BETTER_AUTH_SECRET',
    'OPS_BOOK_ID',
    'VIGIL_DEPLOYMENT_MODE',
    'FLOW_DEPLOYMENT_MODE',
  ])
    assert.throws(() =>
      demoEnvironment({ ...env, [key]: 'example-private-value' }),
    );
  assert.throws(() => demoEnvironment({}));
});
test('cleanup ownership is restricted to fresh local-demo names and a fixed local Docker socket', () => {
  assert.equal(
    demoContainerName('11111111-1111-4111-8111-111111111111'),
    'vigil-local-demo-11111111-1111-4111-8111-111111111111',
  );
  for (const value of ['postgres', '../../existing', '--force', ''])
    assert.throws(() => demoContainerName(value));
  assert.deepEqual(LOCAL_DOCKER, ['--host', 'unix:///var/run/docker.sock']);
});
