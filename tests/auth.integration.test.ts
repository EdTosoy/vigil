import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import { chromium } from '@playwright/test';
import {
  authPool,
  checkAuthCredential,
  createAuthService,
  permits,
} from '../apps/ops/server/auth-service';
import { seedAccount } from '../apps/ops/server/seed-account';
import { visitor } from '../apps/ops/visitor';
import { PostgresIngestion } from '@vigil/ingestion-postgres';
import { verifyCycleBindings } from '../tools/cloud-cycle-bindings';

const adminURL = process.env['VIGIL_TEST_ADMIN_URL'];
if (!adminURL)
  throw new Error('Run pnpm test:integration tests/auth.integration.test.ts');
const admin = new Pool({ connectionString: adminURL });
const runtimeURL = adminURL.replace('flow_test_admin@', 'flow_test_auth@');
const seedURL = adminURL.replace('flow_test_admin@', 'flow_test_auth_seed@');
const runtime = authPool(runtimeURL),
  seed = authPool(seedURL);
const books = [randomUUID(), randomUUID(), randomUUID()];
let visitorId: string;
const env = {
  NODE_ENV: 'test',
  BETTER_AUTH_URL: 'http://127.0.0.1:3000',
  BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
} as NodeJS.ProcessEnv;
const service = createAuthService(runtime, env);
const request = (
  path: string,
  body?: unknown,
  cookie?: string,
  origin = env['BETTER_AUTH_URL']!,
) =>
  new Request(env['BETTER_AUTH_URL'] + '/api/auth/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      origin,
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function login() {
  const response = await service.auth.handler(
    request('sign-in/email', {
      email: visitor.email,
      password: visitor.password,
    }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  assert(cookie.includes('session_token='));
  return cookie;
}
before(async () => {
  for (let i = 0; i < books.length; i++)
    await admin.query(
      'INSERT INTO ledger.book(id,code,environment) VALUES($1,$2,$3)',
      [books[i], 'auth-' + books[i], i === 2 ? 'test' : 'synthetic'],
    );
  visitorId = await seedAccount(seed, {
    ...visitor,
    role: 'Viewer',
    books: [books[0]!],
    visitor: true,
  });
});
after(async () => {
  await Promise.all([admin, runtime, seed].map((p) => p.end()));
});

test('deployment binding verification uses current source and exact Admin/Viewer grants with owner-free logins', async () => {
  const email = `cycle-${randomUUID()}@example.test`;
  const loginName = 'flow_cycle_worker_' + randomUUID().replaceAll('-', '');
  const accountId = 'acct_cycle_demo';
  const sourceAccountId = await new PostgresIngestion(admin).registerSource({
    bookId: books[2]!,
    environment: 'test',
    provider: 'stripe',
    externalAccountId: accountId,
  });
  await admin.query(
    `CREATE ROLE ${loginName} LOGIN IN ROLE flow_stripe_worker`,
  );
  await admin.query("SELECT stripe.configure($1,$2,$3,'worker')", [
    sourceAccountId,
    accountId,
    loginName,
  ]);
  await seedAccount(seed, {
    email,
    name: 'Deployment administrator',
    password: randomUUID() + randomUUID(),
    role: 'Admin',
    books: [books[0]!, books[2]!],
  });
  const worker = new Pool({
    connectionString: adminURL.replace('flow_test_admin@', loginName + '@'),
  });
  const input = {
    stripeBookId: books[2]!,
    syntheticBookId: books[0]!,
    sourceAccountId,
    accountId,
  };
  try {
    await verifyCycleBindings(worker, runtime, input, email);
    await assert.rejects(
      verifyCycleBindings(
        worker,
        runtime,
        { ...input, sourceAccountId: randomUUID() },
        email,
      ),
      /source binding not proven/,
    );
    await assert.rejects(
      verifyCycleBindings(
        worker,
        runtime,
        { ...input, syntheticBookId: books[1]! },
        email,
      ),
      /book grants not proven/,
    );
    await assert.rejects(
      verifyCycleBindings(worker, admin, input, email),
      /Unsafe auth/,
    );
    await assert.rejects(worker.query('DELETE FROM ledger.book WHERE false'), {
      code: '42501',
    });
  } finally {
    await worker.end();
  }
});

test('scoped auth credentials cannot read financial tables or change grants; owner/read/seed credentials are refused', async () => {
  await checkAuthCredential(runtime);
  await assert.rejects(checkAuthCredential(admin), /Unsafe/);
  await assert.rejects(checkAuthCredential(seed), /Unsafe/);
  const ops = new Pool({
    connectionString: process.env['VIGIL_TEST_OPERATIONS_URL'],
  });
  try {
    await assert.rejects(checkAuthCredential(ops), /Unsafe/);
  } finally {
    await ops.end();
  }
  for (const sql of [
    'SELECT * FROM ledger.book',
    "UPDATE app_auth.principal SET role='Admin'",
    'DELETE FROM app_auth.book_grant',
    "SELECT operations.read_v1(NULL,'books')",
  ])
    await assert.rejects(runtime.query(sql), { code: '42501' });
  await assert.rejects(seed.query('SELECT * FROM ledger.book'), {
    code: '42501',
  });
  await admin.query(
    'CREATE ROLE flow_test_unsafe_auth LOGIN IN ROLE flow_auth_runtime; GRANT flow_ledger_owner TO flow_test_unsafe_auth WITH INHERIT FALSE',
  );
  const unsafe = authPool(
    adminURL.replace('flow_test_admin@', 'flow_test_unsafe_auth@'),
  );
  try {
    await assert.rejects(checkAuthCredential(unsafe), /Unsafe/);
  } finally {
    await unsafe.end();
  }
});
test('password login persists an HttpOnly session; invalid, expired and signed-out sessions are rejected', async () => {
  assert.equal(await service.principal(new Headers()), null);
  assert.equal(
    await service.principal(
      new Headers({ cookie: 'better-auth.session_token=invalid' }),
    ),
    null,
  );
  const bad = await service.auth.handler(
    request('sign-in/email', {
      email: visitor.email,
      password: 'incorrect-password',
    }),
  );
  assert.equal(bad.status, 401);
  const cookie = await login();
  const principal = await service.principal(new Headers({ cookie }));
  assert.deepEqual(principal, {
    id: visitorId,
    role: 'Viewer',
    syntheticOnly: true,
  });
  await admin.query(
    'UPDATE app_auth.session SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',
    [visitorId],
  );
  assert.equal(await service.principal(new Headers({ cookie })), null);
  const fresh = await login();
  const signedOut = await service.auth.handler(request('sign-out', {}, fresh));
  assert.equal(signedOut.status, 200);
  assert.equal(await service.principal(new Headers({ cookie: fresh })), null);
});
test('roles default deny; book grants, revocation, pagination and synthetic environment are authoritative', async () => {
  for (const role of ['Admin', 'Operator', 'Viewer'])
    assert(permits(role, 'read'));
  assert(permits('Admin', 'metrics'));
  assert(!permits('Viewer', 'metrics'));
  assert(!permits('Operator', 'metrics'));
  assert(!permits('unknown', 'read'));
  assert(!permits('Admin', 'write' as 'read'));
  const p = { id: visitorId, role: 'Viewer' as const, syntheticOnly: true };
  assert.equal(await service.canRead(p, books[0]!), true);
  assert.equal(await service.canRead(p, books[1]!), false);
  assert.equal(await service.canRead(p, 'invalid'), false);
  // Defense in depth: even an accidentally inserted grant cannot expose test/live data.
  await admin.query('INSERT INTO app_auth.book_grant VALUES($1,$2)', [
    visitorId,
    books[2],
  ]);
  assert.equal(await service.canRead(p, books[2]!), false);
  assert.deepEqual(
    (await service.books(p)).items?.map((b) => b['id']),
    [books[0]],
  );
  await admin.query('INSERT INTO app_auth.book_grant VALUES($1,$2)', [
    visitorId,
    books[1],
  ]);
  const page = await service.books(p, { limit: '1' });
  assert.equal(page.items?.length, 1);
  assert(page.nextCursor);
  const next = await service.books(p, { limit: '1', cursor: page.nextCursor });
  assert.notEqual(next.items?.[0]?.['id'], page.items?.[0]?.['id']);
  await admin.query(
    'DELETE FROM app_auth.book_grant WHERE user_id=$1 AND book_id=$2',
    [visitorId, books[1]],
  );
  assert.equal(await service.canRead(p, books[1]!), false);
});
test('signup and cross-origin authentication are denied; seed is atomic and cannot promote the public visitor', async () => {
  const signUp = await service.auth.handler(
    request('sign-up/email', {
      email: 'attacker@example.com',
      password: 'attacker-password',
      name: 'Attacker',
    }),
  );
  assert.notEqual(signUp.status, 200);
  assert.equal(
    (
      await admin.query('SELECT FROM app_auth."user" WHERE email=$1', [
        'attacker@example.com',
      ])
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await service.auth.handler(
        request(
          'sign-in/email',
          { email: visitor.email, password: visitor.password },
          undefined,
          'https://attacker.invalid',
        ),
      )
    ).status,
    403,
  );
  await assert.rejects(
    seedAccount(seed, {
      ...visitor,
      role: 'Admin',
      books: [books[0]!],
      visitor: true,
    }),
    /Viewer/,
  );
  await assert.rejects(
    seedAccount(seed, {
      ...visitor,
      role: 'Viewer',
      books: [books[2]!],
      visitor: true,
    }),
    /not synthetic/,
  );
  for (const role of ['Admin', 'Operator'] as const) {
    const id = await seedAccount(seed, {
      email: role.toLowerCase() + '@vigil.example',
      name: role,
      password: randomUUID(),
      role,
      books: [books[0]!],
    });
    assert.equal(
      (
        await admin.query(
          'SELECT role FROM app_auth.principal WHERE user_id=$1',
          [id],
        )
      ).rows[0].role,
      role,
    );
  }
});

test('password attempt limits persist in PostgreSQL and unsafe auth origins fail closed', async () => {
  assert.throws(
    () =>
      createAuthService(runtime, {
        ...env,
        BETTER_AUTH_URL: 'ftp://localhost',
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      createAuthService(runtime, {
        ...env,
        BETTER_AUTH_URL: 'http://remote.example',
      }),
    /HTTPS/,
  );
  for (let i = 0; i < 6; i++) {
    const req = request('sign-in/email', {
      email: visitor.email,
      password: 'invalid-password',
    });
    req.headers.set('x-forwarded-for', '198.51.100.24');
    const response = await service.auth.handler(req);
    assert.equal(response.status, i < 5 ? 401 : 429);
  }
  assert(
    Number(
      (await admin.query('SELECT count(*) FROM app_auth."rateLimit"')).rows[0]
        .count,
    ) > 0,
  );
});

test(
  'production UI: sign-in/out, authorized navigation, cross-book details, metrics and expired sessions',
  { timeout: 90000 },
  async () => {
    const reservation = createServer();
    await new Promise<void>((resolve) =>
      reservation.listen(0, '127.0.0.1', resolve),
    );
    const address = reservation.address();
    assert(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const base = 'http://127.0.0.1:' + port;
    let child: ChildProcess | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      child = spawn(
        process.execPath,
        [
          'apps/ops/node_modules/next/dist/bin/next',
          'start',
          'apps/ops',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(port),
        ],
        {
          env: {
            ...process.env,
            DATABASE_ADMIN_URL: '',
            DATABASE_AUTH_SEED_URL: '',
            VIGIL_DEPLOYMENT_MODE: 'application',
            // Do not inherit an operator's prior deployment book from .env.local.
            OPS_BOOK_ID: '',
            DATABASE_AUTH_URL: runtimeURL,
            DATABASE_OPERATIONS_URL: process.env['VIGIL_TEST_OPERATIONS_URL'],
            BETTER_AUTH_URL: base,
            BETTER_AUTH_SECRET: env['BETTER_AUTH_SECRET'],
            VIGIL_VISITOR_LOGIN: 'true',
          },
          stdio: 'ignore',
        },
      );
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error('Production app exited');
        try {
          if ((await fetch(base + '/health/live')).ok) {
            ready = true;
            break;
          }
        } catch {
          /* startup */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert(ready);
      const unauth = await fetch(base + '/?book=' + books[0], {
        redirect: 'manual',
      });
      assert.equal(unauth.status, 307);
      assert.equal(unauth.headers.get('www-authenticate'), null);
      assert.equal(
        (await fetch(base + '/api/auth/sign-up/email', { method: 'POST' }))
          .status,
        404,
      );
      let executable = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];
      if (!executable) {
        try {
          executable = (
            await promisify(execFile)('which', ['chromium'])
          ).stdout.trim();
        } catch {
          /* managed Chromium */
        }
      }
      browser = await chromium.launch({
        headless: true,
        ...(executable ? { executablePath: executable } : {}),
      });
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.name));
      await page.goto(base + '/sign-in');
      await page.getByLabel('Password', { exact: true }).fill(visitor.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(base + '/');
      assert(
        (await page.context().cookies()).some(
          (c) =>
            c.httpOnly &&
            c.sameSite === 'Lax' &&
            c.name.includes('session_token'),
        ),
      );
      await page.getByRole('link', { name: 'auth-' + books[0] }).click();
      await page
        .getByRole('heading', { name: 'Financial operations', exact: true })
        .waitFor();
      for (const section of [
        'Reconciliation',
        'Exceptions',
        'Controls',
        'Workers',
        'Integrity',
      ]) {
        await page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('link', { name: new RegExp(section) })
          .click();
        await page.getByRole('button', { name: 'Sign out' }).waitFor();
      }
      await page.goto(base + '/?book=' + books[1]);
      assert(!(await page.content()).includes('auth-' + books[1]));
      for (const section of ['exceptions', 'reconciliation', 'workers']) {
        await page.goto(
          base + '/' + section + '/' + randomUUID() + '?book=' + books[1],
        );
        assert(!(await page.content()).includes('auth-' + books[1]));
      }
      assert.equal((await page.request.get(base + '/metrics')).status(), 404);
      await page.getByRole('button', { name: 'Sign out' }).click();
      await page.waitForURL(base + '/sign-in');
      await page.goto(base + '/?book=' + books[0]);
      await page.waitForURL(base + '/sign-in');
      await page.context().addCookies([
        {
          name: 'better-auth.session_token',
          value: 'forged-session',
          url: base,
        },
      ]);
      await page.goto(base + '/?book=' + books[0]);
      await page.waitForURL(base + '/sign-in');
      await page.getByLabel('Password', { exact: true }).fill(visitor.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(base + '/');
      await admin.query(
        'UPDATE app_auth.session SET "expiresAt"=now()-interval \'1 minute\' WHERE "userId"=$1',
        [visitorId],
      );
      await page.goto(base + '/?book=' + books[0]);
      await page.waitForURL(base + '/sign-in');
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      if (child && child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolve) =>
          child!.once('exit', () => resolve()),
        );
      }
    }
  },
);
