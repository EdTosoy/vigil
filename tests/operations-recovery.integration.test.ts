import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresLedger } from '@vigil/ledger-postgres';
import { Money } from '@vigil/money';
import { PostgresReconciliation } from '@vigil/reconciliation-postgres';
import { PostgresControls } from '@vigil/control-postgres';
import { PostgresOperations } from '@vigil/operations-read-postgres';
import { PostgresIntegrity } from '@vigil/integrity-postgres';
import { PostgresWorker } from '@vigil/worker-postgres';
import { PostgresPayments } from '@vigil/payment-postgres';
import { monitorReport } from '../tools/monitor-report';
import { fixture } from './helpers/reconciliation-fixture';
import {
  authPool,
  createAuthService,
  checkAuthCredential,
} from '../apps/ops/server/auth-service';
import { seedAccount } from '../apps/ops/server/seed-account';

const exec = promisify(execFile);
const image =
  'postgres:18@sha256:fc973eb97c9fd04bfa1840e0f510719a584ccb3be8debfe6a4144637a9dfe8cf';
const sourceContainer = process.env['VIGIL_TEST_CONTAINER'];
const sourceURL = process.env['VIGIL_TEST_ADMIN_URL'];
if (!sourceContainer || !sourceURL)
  throw new Error(
    'Run pnpm test:integration tests/operations-recovery.integration.test.ts',
  );
const pools = new Map<string, Pool>();
function pool(capability: string) {
  let result = pools.get(capability);
  if (!result) {
    const url = process.env[`VIGIL_TEST_${capability}_URL`];
    if (!url) throw new Error('Missing disposable test capability');
    result = new Pool({
      connectionString: url,
      max: 2,
      connectionTimeoutMillis: 2000,
      query_timeout: 30000,
    });
    pools.set(capability, result);
  }
  return result;
}
before(async () => {
  assert.match(sourceContainer, /^vigil-phase1-[0-9a-f-]{36}$/);
  const url = new URL(sourceURL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.username, 'flow_test_admin');
  assert.equal(url.pathname, '/flow_test');
  const mapping = (
    await exec('docker', ['port', sourceContainer, '5432/tcp'])
  ).stdout.trim();
  assert.equal(mapping, `127.0.0.1:${url.port}`);
});
after(async () => {
  await Promise.all([...pools.values()].map((p) => p.end()));
});

async function economicFixture() {
  const f = await fixture(
    pool('ADMIN'),
    pool('INGESTION'),
    pool('PROCESSOR'),
    pool('BANK'),
  );
  const run = await new PostgresReconciliation(pool('RECONCILIATION')).run(
    f.command,
  );
  const evaluation = await new PostgresControls(pool('CONTROL')).run({
    bookId: f.book,
    runKey: 'recovery-controls',
    actorId: 'recovery-verifier',
    reconciliationRunIds: [run.id],
    createCases: false,
  });
  return { ...f, run, evaluation };
}

test('restricted monitor distinguishes lag, terminal work, stale controls and financial assurance without writes', async () => {
  const f = await economicFixture();
  const reader = new PostgresOperations(pool('OPERATIONS'));
  const initial = await monitorReport(reader, {
    bookId: f.book,
    evaluationId: f.evaluation.id,
    maxOutstandingAgeMs: 1,
  });
  assert.equal(initial.controlObservation.freshness, 'PASS');
  assert(initial.alerts.some((a) => a.code === 'PENDING_WORK_AGE'));
  assert.notEqual(initial.integrityObservation.financialAssurance, 'PASS');
  const worker = new PostgresWorker(pool('WORKER'));
  const claim = await worker.claim('monitor-terminal-fixture', f.book);
  assert(claim);
  await worker.finish(claim, {
    classification: 'UNSUPPORTED',
    code: 'MONITOR_TEST_UNSUPPORTED',
  });
  // New accepted evidence invalidates the frozen evaluation through the existing
  // currentness predicate; the monitor does not invent its own version rule.
  await f.ingestion.ingest({
    sourceAccountId: f.source,
    batchKey: 'later-monitor-evidence',
    actorId: 'recovery-verifier',
    provenance: { adapterVersion: 'monitor-test-v1' },
    records: [
      {
        locator: '0',
        objectKind: 'synthetic-movement',
        externalId: 'later',
        sourceRevision: null,
        sequence: null,
        sourceObservedAt: null,
        bytes: Buffer.from('{}'),
      },
    ],
  });
  const before = await snapshot(pool('ADMIN'));
  const observed = await monitorReport(reader, {
    bookId: f.book,
    evaluationId: f.evaluation.id,
  });
  assert.equal(observed.operationalStatus, 'FAIL');
  assert.equal(observed.controlObservation.freshness, 'UNKNOWN');
  assert(observed.alerts.some((a) => a.code === 'TERMINAL_WORK_PRESENT'));
  assert(
    observed.alerts.some((a) => a.code === 'CONTROL_EVALUATION_NOT_CURRENT'),
  );
  await assert.rejects(
    exec(
      process.execPath,
      [
        '--import',
        'tsx',
        'tools/operational-monitor.ts',
        f.book,
        f.evaluation.id,
      ],
      {
        env: {
          ...process.env,
          DATABASE_OPERATIONS_URL: process.env['VIGIL_TEST_OPERATIONS_URL']!,
        },
        timeout: 30000,
      },
    ),
    (error: unknown) => {
      const result = error as { code: number; stdout: string };
      assert.equal(result.code, 2);
      const report = JSON.parse(result.stdout);
      assert.equal(report.bookId, f.book);
      assert.equal(report.attentionStatus, 'FAIL');
      assert(!result.stdout.includes('postgresql://'));
      return true;
    },
  );
  assert.deepEqual(await snapshot(pool('ADMIN')), before);
  await assert.rejects(
    pool('OPERATIONS').query('DELETE FROM worker.work_item WHERE false'),
    { code: '42501' },
  );
  await assert.rejects(
    monitorReport(new PostgresOperations(pool('ADMIN')), { bookId: f.book }),
  );
});

const schemas = [
  'ledger',
  'audit',
  'outbox',
  'ingestion',
  'processor',
  'bank',
  'reconciliation',
  'exceptions',
  'controls',
  'worker',
  'integrity',
  'operations',
  'stripe',
  'app_auth',
  'payments',
];
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
/** Full table fingerprints stay in memory; raw records/password hashes never enter logs. */
async function snapshot(database: Pool) {
  const client = await database.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(
      "SET LOCAL statement_timeout='30s'; SET LOCAL timezone='UTC'",
    );
    const tables = (
      await client.query<{ schema: string; name: string }>(
        `SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind IN ('r','p') AND (n.nspname=ANY($1::text[]) OR (n.nspname='public' AND c.relname='flow_schema_migration')) ORDER BY n.nspname,c.relname`,
        [schemas],
      )
    ).rows;
    const rows = [];
    for (const t of tables) {
      const value = (
        await client.query<{ digest: string; count: string }>(
          `SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text) AS digest,count(*)::text AS count FROM ${quote(t.schema)}.${quote(t.name)} t`,
        )
      ).rows[0]!;
      rows.push({ ...t, ...value });
    }
    const roles = (
      await client.query(
        `SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname LIKE 'flow\\_%' ESCAPE '\\' OR rolname LIKE 'pay\\_%' ESCAPE '\\' ORDER BY rolname`,
      )
    ).rows;
    const memberships = (
      await client.query(
        `SELECT r.rolname AS role,m.rolname AS member,g.rolname AS grantor,a.admin_option,a.inherit_option,a.set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor WHERE r.rolname LIKE 'flow\\_%' ESCAPE '\\' OR r.rolname LIKE 'pay\\_%' ESCAPE '\\' OR m.rolname LIKE 'pay\\_%' ESCAPE '\\' ORDER BY r.rolname,m.rolname,g.rolname`,
      )
    ).rows;
    const permissions = (
      await client.query(
        `SELECT n.nspname,c.relname,pg_get_userbyid(c.relowner) AS owner,coalesce(c.relacl,acldefault('r',c.relowner))::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('r','p','v') ORDER BY n.nspname,c.relname`,
        [schemas],
      )
    ).rows;
    const functions = (
      await client.query(
        `SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proacl::text AS acl,md5(pg_get_functiondef(p.oid)) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)`,
        [schemas],
      )
    ).rows;
    await client.query('COMMIT');
    return { rows, roles, memberships, permissions, functions };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function reservePort() {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === 'string')
    throw new Error('Disposable restore port unavailable');
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

test(
  'independent PostgreSQL logical restore preserves all evidence/history/permissions and safely replays original identities',
  { timeout: 180000 },
  async () => {
    const f = await economicFixture();
    const authRuntime = authPool(
      sourceURL.replace('flow_test_admin@', 'flow_test_auth@'),
    );
    const authSeeder = authPool(
      sourceURL.replace('flow_test_admin@', 'flow_test_auth_seed@'),
    );
    pools.set('AUTH_RUNTIME', authRuntime);
    pools.set('AUTH_SEEDER', authSeeder);
    const authEnv = {
      NODE_ENV: 'test',
      BETTER_AUTH_URL: 'http://127.0.0.1:3000',
      BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
    } as NodeJS.ProcessEnv;
    const email = `restore-${randomUUID()}@example.test`;
    const password = randomUUID() + randomUUID();
    const userId = await seedAccount(authSeeder, {
      email,
      password,
      name: 'Restore fixture operator',
      role: 'Operator',
      books: [f.book],
    });
    const auth = createAuthService(authRuntime, authEnv);
    const login = await auth.auth.handler(
      new Request(authEnv['BETTER_AUTH_URL'] + '/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          origin: authEnv['BETTER_AUTH_URL']!,
          'content-type': 'application/json',
          'x-forwarded-for': '192.0.2.241',
        },
        body: JSON.stringify({ email, password, rememberMe: false }),
      }),
    );
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    assert(cookie.includes('session_token='));
    const ledger = new PostgresLedger(pool('WRITER'));
    const identity = {
      bookId: f.book,
      actorId: 'restore-verifier',
      reason: 'Synthetic exact-money restore verification',
    };
    const debit = await ledger.createAccount({
      ...identity,
      commandKey: 'restore-asset',
      code: 'restore-asset',
      classification: 'asset',
      normalSide: 'debit',
      currency: 'PHP',
    });
    const credit = await ledger.createAccount({
      ...identity,
      commandKey: 'restore-equity',
      code: 'restore-equity',
      classification: 'equity',
      normalSide: 'credit',
      currency: 'PHP',
    });
    const command = {
      ...identity,
      commandKey: 'restore-posting',
      effectNamespace: 'restore-test',
      businessEffectKey: 'original-capture',
      currency: 'PHP' as const,
      effectiveAt: '2026-01-01T00:00:00.000Z',
      policyVersion: 'synthetic-restore-v1',
      entries: [
        {
          accountId: debit.id,
          side: 'debit' as const,
          money: Money.of(9007199254740993n, 'PHP'),
        },
        {
          accountId: credit.id,
          side: 'credit' as const,
          money: Money.of(9007199254740993n, 'PHP'),
        },
      ],
    };
    const posted = await ledger.post(command);
    // This file is also runnable alone: populate the new boundary explicitly,
    // without relying on another test file's ordering or financial fixtures.
    const paymentAuthorizerName =
      'flow_restore_authorizer_' + randomUUID().replaceAll('-', '');
    const paymentExecutorName =
      'flow_restore_executor_' + randomUUID().replaceAll('-', '');
    const paymentSourcePools: Pool[] = [];
    for (const [name, capability] of [
      [paymentAuthorizerName, 'authorizer'],
      [paymentExecutorName, 'executor'],
    ] as const) {
      await pool('ADMIN').query(
        `CREATE ROLE ${quote(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE flow_payment_${capability}`,
      );
      await pool('ADMIN').query(
        'SELECT payments.bind_principal($1::name,$2::uuid,$3)',
        [name, f.book, capability],
      );
      const url = new URL(sourceURL);
      url.username = name;
      const principal = new Pool({
        connectionString: url.toString(),
        connectionTimeoutMillis: 2000,
        query_timeout: 30000,
      });
      paymentSourcePools.push(principal);
      pools.set('RESTORE_PAYMENT_' + capability, principal);
    }
    const receivable = await ledger.createAccount({
      ...identity,
      commandKey: 'restore-payment-asset',
      code: 'restore-payment-receivable',
      classification: 'asset',
      normalSide: 'debit',
      currency: 'PHP',
    });
    const payable = await ledger.createAccount({
      ...identity,
      commandKey: 'restore-payment-liability',
      code: 'restore-payment-payable',
      classification: 'liability',
      normalSide: 'credit',
      currency: 'PHP',
    });
    const policyId = (
      await pool('ADMIN').query<{ id: string }>(
        'SELECT payments.configure_policy($1::jsonb) AS id',
        [
          JSON.stringify({
            bookId: f.book,
            currency: 'PHP',
            policyVersion: 'synthetic-restore-capture-v1',
            receivableAccountId: receivable.id,
            payableAccountId: payable.id,
          }),
        ],
      )
    ).rows[0]!.id;
    const paymentCommands = new PostgresPayments(
      paymentSourcePools[0]!,
      paymentSourcePools[1]!,
    );
    const capture = {
      bookId: f.book,
      commandKey: 'restore-approved-capture',
      businessKey: 'restore-independent-capture',
      kind: 'CAPTURE' as const,
      policyId,
      money: Money.of(9007199254740993n, 'PHP'),
      effectiveAt: '2026-11-21T00:00:00.000Z',
      actorId: 'restore-independent-approver',
      reason: 'Approved synthetic restore capture expectation',
      originalCaptureId: null,
    };
    const approvedCapture = await paymentCommands.authorize(capture);
    const executedCapture = await paymentCommands.execute(approvedCapture.id);
    assert.equal(executedCapture.replayed, false);
    const baseline = await snapshot(pool('ADMIN'));
    const originalIntegrity = await new PostgresIntegrity(
      pool('INTEGRITY'),
    ).sweep(f.book, [f.run.id]);
    assert.equal(originalIntegrity.integrity, 'PASS');
    const directory = await mkdtemp(join(tmpdir(), 'vigil-restore-proof-'));
    await chmod(directory, 0o700);
    const target = 'vigil-restore-' + randomUUID();
    let started = false;
    const targetPools: Pool[] = [];
    const began = performance.now();
    try {
      const globals = await exec(
        'docker',
        [
          'exec',
          sourceContainer,
          'pg_dumpall',
          '-U',
          'flow_test_admin',
          '--globals-only',
          '--no-role-passwords',
        ],
        { maxBuffer: 16 * 1024 * 1024, timeout: 30000 },
      );
      const dump = await exec(
        'docker',
        [
          'exec',
          sourceContainer,
          'pg_dump',
          '-U',
          'flow_test_admin',
          '-d',
          'flow_test',
          '--format=custom',
          '--serializable-deferrable',
        ],
        { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, timeout: 120000 },
      );
      // PostgreSQL restores GRANTED BY identities. Use the same logical bootstrap
      // role in this independent cluster and omit only its exact duplicate CREATE.
      const bootstrapCreate = /^CREATE ROLE flow_test_admin;$/gm;
      assert.equal([...globals.stdout.matchAll(bootstrapCreate)].length, 1);
      const roles = globals.stdout.replace(
        bootstrapCreate,
        '-- Matching disposable bootstrap role already exists',
      );
      await writeFile(join(directory, 'roles.sql'), roles, {
        mode: 0o600,
      });
      await writeFile(join(directory, 'snapshot.dump'), dump.stdout, {
        mode: 0o600,
      });
      const backupCompletedMs = performance.now() - began;
      const afterBackupBook = randomUUID();
      await pool('ADMIN').query(
        "INSERT INTO ledger.book(id,code,environment) VALUES($1,$2,'synthetic')",
        [afterBackupBook, 'after-backup-' + afterBackupBook],
      );
      const port = await reservePort();
      await exec(
        'docker',
        [
          'run',
          '--detach',
          '--rm',
          '--name',
          target,
          '--publish',
          `127.0.0.1:${port}:5432`,
          '--env',
          'POSTGRES_USER=flow_test_admin',
          '--env',
          'POSTGRES_DB=postgres',
          '--env',
          'POSTGRES_HOST_AUTH_METHOD=trust',
          image,
          '-c',
          'fsync=on',
          '-c',
          'synchronous_commit=on',
        ],
        { timeout: 120000 },
      );
      started = true;
      const recoveryBegan = performance.now();
      const adminURL = `postgresql://flow_test_admin@127.0.0.1:${port}/postgres`;
      const restoreAdmin = new Pool({
        connectionString: adminURL,
        connectionTimeoutMillis: 2000,
      });
      targetPools.push(restoreAdmin);
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await restoreAdmin.query('SELECT 1');
          ready = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      assert(ready, 'New independent PostgreSQL must be ready');
      await exec('docker', [
        'cp',
        join(directory, 'roles.sql'),
        `${target}:/tmp/roles.sql`,
      ]);
      await exec('docker', [
        'cp',
        join(directory, 'snapshot.dump'),
        `${target}:/tmp/snapshot.dump`,
      ]);
      await exec(
        'docker',
        [
          'exec',
          target,
          'psql',
          '-U',
          'flow_test_admin',
          '-X',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
          '-f',
          '/tmp/roles.sql',
        ],
        { maxBuffer: 16 * 1024 * 1024, timeout: 30000 },
      );
      await restoreAdmin.query(
        'CREATE DATABASE flow_test OWNER flow_test_admin',
      );
      await exec(
        'docker',
        [
          'exec',
          target,
          'pg_restore',
          '-U',
          'flow_test_admin',
          '-d',
          'flow_test',
          '--exit-on-error',
          '--single-transaction',
          '/tmp/snapshot.dump',
        ],
        { maxBuffer: 16 * 1024 * 1024, timeout: 120000 },
      );
      const restoredPool = (username: string) => {
        const p = new Pool({
          connectionString: `postgresql://${username}@127.0.0.1:${port}/flow_test`,
          connectionTimeoutMillis: 2000,
          query_timeout: 30000,
        });
        targetPools.push(p);
        return p;
      };
      const restoredAdmin = restoredPool('flow_test_admin');
      assert.deepEqual(await snapshot(restoredAdmin), baseline);
      await assert.rejects(
        restoredAdmin.query(
          'UPDATE ledger.ledger_transaction SET reason=reason WHERE id=$1',
          [posted.id],
        ),
        { code: 'P1003' },
      );
      for (const table of ['audit.audit_event', 'outbox.outbox_event'])
        await assert.rejects(
          restoredAdmin.query(`DELETE FROM ${table} WHERE book_id=$1`, [
            f.book,
          ]),
          { code: 'P1003' },
        );
      assert.equal(
        (
          await restoredAdmin.query(
            'SELECT count(*)::text n FROM ledger.book WHERE id=$1',
            [afterBackupBook],
          )
        ).rows[0].n,
        '0',
      );
      const restoredIntegrityPool = restoredPool('flow_test_integrity');
      const restoredIntegrity = await new PostgresIntegrity(
        restoredIntegrityPool,
      ).sweep(f.book, [f.run.id]);
      assert.equal(restoredIntegrity.integrity, 'PASS');
      assert.equal(
        restoredIntegrity.financialAssurance,
        originalIntegrity.financialAssurance,
      );
      assert.deepEqual(restoredIntegrity.work, originalIntegrity.work);
      const restoredReaderPool = restoredPool('flow_test_operations');
      const detail = await new PostgresOperations(restoredReaderPool).read(
        'run',
        f.book,
        { id: f.run.id },
      );
      assert.equal(detail.data!['state'], 'COMPLETED');
      await assert.rejects(
        restoredReaderPool.query(
          'DELETE FROM ledger.ledger_transaction WHERE false',
        ),
        { code: '42501' },
      );
      await assert.rejects(
        restoredIntegrityPool.query('SELECT * FROM ledger.ledger_transaction'),
        { code: '42501' },
      );
      const restoredAuthPool = authPool(
        `postgresql://flow_test_auth@127.0.0.1:${port}/flow_test`,
      );
      targetPools.push(restoredAuthPool);
      await checkAuthCredential(restoredAuthPool);
      const restoredAuth = createAuthService(restoredAuthPool, authEnv);
      const principal = await restoredAuth.principal(new Headers({ cookie }));
      assert.deepEqual(principal, {
        id: userId,
        role: 'Operator',
        syntheticOnly: false,
      });
      assert.equal(await restoredAuth.canRead(principal!, f.book), true);
      assert.equal(await restoredAuth.canRead(principal!, randomUUID()), false);
      await assert.rejects(
        restoredAuthPool.query('DELETE FROM app_auth.book_grant WHERE false'),
        { code: '42501' },
      );
      await assert.rejects(
        restoredAuthPool.query('SELECT * FROM ledger.ledger_transaction'),
        { code: '42501' },
      );
      const restoredWriter = restoredPool('flow_test_writer');
      await assert.rejects(
        restoredWriter.query('SELECT ledger.post_journal($1::jsonb)', [
          JSON.stringify({
            ...command,
            commandKey: 'restore-unbalanced-command',
            businessEffectKey: 'restore-unbalanced-effect',
            entries: [
              { accountId: debit.id, side: 'debit', amountMinor: '10' },
              { accountId: credit.id, side: 'credit', amountMinor: '9' },
            ],
          }),
        ]),
        { code: 'P1004' },
      );
      const recoveredLedger = new PostgresLedger(restoredWriter);
      const replay = await recoveredLedger.post(command);
      assert.equal(replay.id, posted.id);
      assert.equal(replay.replayed, true);
      assert.equal(
        await recoveredLedger.accountDelta(debit.id),
        9007199254740993n,
      );
      const restoredPaymentAuthorizer = restoredPool(paymentAuthorizerName);
      const restoredPaymentExecutor = restoredPool(paymentExecutorName);
      const restoredPayments = new PostgresPayments(
        restoredPaymentAuthorizer,
        restoredPaymentExecutor,
      );
      const replayApproval = await restoredPayments.authorize(capture);
      assert.equal(replayApproval.id, approvedCapture.id);
      assert.equal(replayApproval.replayed, true);
      const replayCapture = await restoredPayments.execute(approvedCapture.id);
      assert.equal(replayCapture.id, executedCapture.id);
      assert.equal(replayCapture.journalId, executedCapture.journalId);
      assert.equal(replayCapture.replayed, true);
      assert.equal(
        await recoveredLedger.accountDelta(receivable.id),
        9007199254740993n,
      );
      await assert.rejects(
        restoredPaymentAuthorizer.query('SELECT payments.execute($1::uuid)', [
          approvedCapture.id,
        ]),
        { code: '42501' },
      );
      await assert.rejects(
        restoredPaymentExecutor.query(
          'UPDATE payments.authorization SET reason=reason WHERE id=$1',
          [approvedCapture.id],
        ),
        { code: '42501' },
      );
      await assert.rejects(
        restoredAdmin.query('DELETE FROM payments.execution WHERE id=$1', [
          executedCapture.id,
        ]),
        { code: 'P1003' },
      );
      assert.deepEqual(await snapshot(restoredAdmin), baseline);
      const restoredWorker = new PostgresWorker(
        restoredPool('flow_test_worker'),
      );
      await restoredWorker.processBatch('restore-proof-worker', 100, f.book);
      const drained = await new PostgresIntegrity(restoredIntegrityPool).sweep(
        f.book,
        [f.run.id],
      );
      assert.equal(drained.integrity, 'PASS');
      assert.equal(
        drained.work.pending + drained.work.processing + drained.work.retryable,
        0,
      );
      const financialTables = baseline.rows.filter((t) =>
        [
          'ledger',
          'reconciliation',
          'controls',
          'audit',
          'outbox',
          'payments',
        ].includes(t.schema),
      );
      assert.deepEqual(
        (await snapshot(restoredAdmin)).rows.filter((t) =>
          financialTables.some(
            (b) => b.schema === t.schema && b.name === t.name,
          ),
        ),
        financialTables,
      );
      console.log(
        'LOCAL_LOGICAL_RESTORE_PROOF ' +
          JSON.stringify({
            backupCompletedMs,
            recoveryAndVerificationMs: performance.now() - recoveryBegan,
            scope: 'owned-disposable-postgresql-logical-snapshot',
            restoredTableCount: baseline.rows.length,
            postBackupMarkerRestored: false,
            duplicateJournalEffects: 0,
            restoredPaymentAuthorizationsReplayed: 1,
            restoredPaymentExecutionsReplayed: 1,
            hostedRecovery: 'NOT_TESTED',
          }),
      );
    } finally {
      await Promise.all(targetPools.map((p) => p.end()));
      if (started) await exec('docker', ['stop', '--time', '2', target]);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
