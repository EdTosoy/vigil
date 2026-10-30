import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { chromium } from '@playwright/test';
const exec = promisify(execFile);
async function port() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((r) => server.close(() => r()));
  return address.port;
}

test(
  'Compose cold start: migration 014, scoped accounts, TLS login, private webhook and persisted sessions',
  { timeout: 180000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vigil-startup-smoke-'));
    await chmod(dir, 0o700);
    const project = 'vigil-startup-test-' + randomBytes(4).toString('hex');
    const tlsPort = await port(),
      httpPort = await port();
    const base = 'https://localhost:' + tlsPort;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const compose = async (...args: string[]) =>
      exec(
        'docker',
        ['compose', '-p', project, '-f', join(dir, 'compose.json'), ...args],
        { maxBuffer: 4 * 1024 * 1024, timeout: 120000 },
      );
    const password = () => randomBytes(32).toString('hex');
    const master = password(),
      adminPassword = password();
    const kinds = [
      'operations',
      'ingress',
      'stripeWorker',
      'ingestion',
      'processor',
      'bank',
      'reconciliation',
      'exceptions',
      'controls',
      'worker',
      'integrity',
      'auth',
      'authSeed',
    ];
    const passwords = Object.fromEntries(kinds.map((k) => [k, password()]));
    const db = (kind: string) =>
      `postgresql://flow_demo_${kind.toLowerCase()}:${passwords[kind]}@postgres:5432/vigil`;
    const envFile = async (name: string, values: Record<string, string>) => {
      await rm(join(dir, name + '.env'), { force: true });
      await writeFile(
        join(dir, name + '.env'),
        Object.entries(values)
          .map(
            ([k, v]) =>
              `${k}=${v.startsWith('{') ? "'" + v + "'" : JSON.stringify(v)}`,
          )
          .join('\n') + '\n',
        // The parent directory is 0700. Bind-mounted test files must be readable
        // by image UID 1000 even when the workstation uses a different UID.
        { mode: 0o444 },
      );
    };
    try {
      const model = JSON.parse(
        (
          await exec(
            'docker',
            [
              'compose',
              '--profile',
              'setup',
              '-f',
              'container/startup/compose.yaml',
              'config',
              '--format',
              'json',
            ],
            {
              env: {
                ...process.env,
                OPS_IMAGE: 'vigil-startup-ops:verify',
                ADMIN_IMAGE: 'vigil-startup-admin:verify',
                STRIPE_IMAGE: 'vigil-startup-stripe:verify',
                DOMAIN: 'localhost',
                ACME_EMAIL: 'local@example.com',
              },
            },
          )
        ).stdout,
      );
      // Local verification uses the actual service commands/secrets/health checks;
      // override only architecture, host ports and disposable storage.
      delete model.services['stripe-worker']; // Needs a real Stripe API key; never call Stripe in this test.
      model.name = project;
      for (const service of Object.values(model.services) as Record<
        string,
        unknown
      >[])
        service['platform'] = 'linux/amd64';
      model.services.postgres.volumes = [
        {
          type: 'volume',
          source: 'database-proof',
          target: '/var/lib/postgresql',
        },
      ];
      model.services.caddy.volumes = [
        {
          type: 'bind',
          source: resolve('container/startup/Caddyfile'),
          target: '/etc/caddy/Caddyfile',
          read_only: true,
        },
        { type: 'volume', source: 'caddy-proof', target: '/data' },
        { type: 'volume', source: 'caddy-config-proof', target: '/config' },
      ];
      model.services.caddy.ports = [
        {
          target: 80,
          published: String(httpPort),
          host_ip: '127.0.0.1',
          protocol: 'tcp',
        },
        {
          target: 443,
          published: String(tlsPort),
          host_ip: '127.0.0.1',
          protocol: 'tcp',
        },
      ];
      model.volumes = {
        'database-proof': {},
        'caddy-proof': {},
        'caddy-config-proof': {},
      };
      for (const [name, secret] of Object.entries(model.secrets) as [
        string,
        { file: string },
      ][])
        secret.file = join(
          dir,
          name === 'postgres-password' ? name : name + '.env',
        );
      await writeFile(join(dir, 'compose.json'), JSON.stringify(model), {
        mode: 0o600,
      });
      await writeFile(join(dir, 'postgres-password'), master, { mode: 0o400 });
      const configuration = {
        bookId: randomUUID(),
        accountId: 'acct_startupLocal',
        passwords,
      };
      const provisioningEnv = {
        DATABASE_ADMIN_URL: `postgresql://vigil_migrator:${master}@postgres:5432/vigil`,
        STRIPE_MODE: 'sandbox',
        VIGIL_APPLICATION_AUTH: 'true',
        VIGIL_ADMIN_EMAIL: 'admin@startup.example',
        VIGIL_SEED_PASSWORD: adminPassword,
        VIGIL_PROVISIONING_CONFIG: JSON.stringify(configuration),
      };
      await envFile('provision', provisioningEnv);
      await envFile('ops', {
        DATABASE_OPERATIONS_URL: db('operations'),
        DATABASE_AUTH_URL: db('auth'),
        BETTER_AUTH_URL: base,
        BETTER_AUTH_SECRET: password(),
      });
      await envFile('financial-worker', { DATABASE_WORKER_URL: db('worker') });
      await compose('up', '-d', '--wait', 'postgres');
      const provisioning = await compose(
        '--profile',
        'setup',
        'run',
        '--rm',
        'provision',
      );
      const receipt = JSON.parse(
        provisioning.stdout.trim().split('\n').at(-1)!,
      );
      assert.equal(receipt.outcome, 'PASS');
      assert.equal(receipt.migrations, 14);
      assert.notEqual(receipt.syntheticBookId, configuration.bookId);
      await envFile('ingress', {
        STRIPE_MODE: 'sandbox',
        STRIPE_ACCOUNT_ID: configuration.accountId,
        STRIPE_SOURCE_ACCOUNT_ID: receipt.sourceAccountId,
        STRIPE_INGRESS_DATABASE_URL: db('ingress'),
        STRIPE_WEBHOOK_SECRETS: 'whsec_localStartupTest',
      });
      await compose(
        'up',
        '-d',
        '--wait',
        'ops',
        'ingress',
        'financial-worker',
        'caddy',
      );
      let executablePath = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];
      if (!executablePath) {
        try {
          executablePath = (await exec('which', ['chromium'])).stdout.trim();
        } catch {
          /* managed Chromium */
        }
      }
      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
      });
      const page = await browser.newPage({ ignoreHTTPSErrors: true });
      await page.goto(base + '/sign-in');
      await page
        .getByLabel('Password', { exact: true })
        .fill('Vigil-Synthetic-Visitor-2026!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(base + '/');
      const booksText = await page.locator('main').innerText();
      assert(booksText.includes('ops-demo-'));
      assert(!booksText.includes('aws-stripe-sandbox'));
      assert.equal((await page.request.get(base + '/metrics')).status(), 404);
      assert.equal(
        (
          await page.request.post(base + '/webhooks/stripe', { data: '{}' })
        ).status(),
        400,
      );
      await page.getByRole('link', { name: /ops-demo-/ }).click();
      await page
        .getByRole('heading', { name: 'Financial operations', exact: true })
        .waitFor();
      const cookies = await page.context().cookies();
      assert(
        cookies.some(
          (c) =>
            c.secure &&
            c.httpOnly &&
            c.name === '__Secure-better-auth.session_token',
        ),
      );
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForURL(base + '/sign-in');
      await page
        .getByLabel('Email', { exact: true })
        .fill('admin@startup.example');
      await page.getByLabel('Password', { exact: true }).fill(adminPassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(base + '/');
      assert(
        (await page.locator('main').innerText()).includes('aws-stripe-sandbox'),
      );
      assert.equal((await page.request.get(base + '/metrics')).status(), 200);
      // Recreate the database container; durable tables and the authenticated session survive.
      await compose('up', '-d', '--force-recreate', '--wait', 'postgres');
      await page.reload();
      await page
        .getByRole('link', { name: /^aws-stripe-sandbox →$/ })
        .waitFor();
      await envFile('provision', {
        ...provisioningEnv,
        VIGIL_SEED_PASSWORD: password(),
      });
      const second = await compose(
        '--profile',
        'setup',
        'run',
        '--rm',
        'provision',
      );
      assert.equal(
        JSON.parse(second.stdout.trim().split('\n').at(-1)!).syntheticBookId,
        receipt.syntheticBookId,
      );
      // A different seed password must never reset the existing administrator.
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForURL(base + '/sign-in');
      await page
        .getByLabel('Email', { exact: true })
        .fill('admin@startup.example');
      await page.getByLabel('Password', { exact: true }).fill(adminPassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(base + '/');
      await page
        .getByRole('link', { name: /^aws-stripe-sandbox →$/ })
        .waitFor();

      // Simulate permission drift in this disposable auth fixture only. The
      // provisioner must refuse it and leave the grant absent for review.
      const authSQL = (sql: string) =>
        compose(
          'exec',
          '-T',
          'postgres',
          'psql',
          '-U',
          'vigil_migrator',
          '-d',
          'vigil',
          '-At',
          '-c',
          sql,
        );
      await authSQL(
        `DELETE FROM app_auth.book_grant WHERE book_id='${configuration.bookId}' AND user_id=(SELECT id FROM app_auth."user" WHERE email='admin@startup.example')`,
      );
      await assert.rejects(
        compose('--profile', 'setup', 'run', '--rm', 'provision'),
        (error: unknown) => {
          const failure = error as { code?: number; stderr?: string };
          return (
            failure.code === 1 &&
            Boolean(failure.stderr?.includes('"outcome":"FAILED"'))
          );
        },
      );
      assert.equal(
        (
          await authSQL(
            `SELECT count(*) FROM app_auth.book_grant WHERE book_id='${configuration.bookId}' AND user_id=(SELECT id FROM app_auth."user" WHERE email='admin@startup.example')`,
          )
        ).stdout.trim(),
        '0',
      );
      console.log(
        'STARTUP_COMPOSE: TLS, Admin/Viewer grants, webhook rejection, migration 014, worker health, session/password persistence and permission drift refusal PASS',
      );
    } finally {
      await browser?.close();
      await compose('down', '--volumes', '--remove-orphans').catch(
        () => undefined,
      );
      await rm(dir, { recursive: true, force: true });
    }
  },
);
