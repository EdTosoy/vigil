import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, afterEach, test } from 'node:test';
import { Pool } from 'pg';
import { Money } from '@vigil/money';
import { PostgresLedger } from '@vigil/ledger-postgres';
import { PostgresIntegrity } from '@vigil/integrity-postgres';
import {
  PostgresPayments,
  UnknownPaymentCommit,
} from '@vigil/payment-postgres';
import {
  serializeCommand,
  type AccountingCommand,
} from '@vigil/payment-domain';
import { commitDropProxy } from './helpers/commit-proxy';

const adminURL = process.env['VIGIL_TEST_ADMIN_URL'];
const writerURL = process.env['VIGIL_TEST_WRITER_URL'];
if (!adminURL || !writerURL)
  throw new Error(
    'Run pnpm test:integration tests/payments.integration.test.ts',
  );
const admin = new Pool({ connectionString: adminURL });
const writer = new Pool({ connectionString: writerURL });
const ledger = new PostgresLedger(writer);
const bookId = randomUUID(),
  otherBook = randomUUID(),
  testBook = randomUUID();
const authorizerName = 'pay_authorizer_' + randomUUID().replaceAll('-', '');
const executorName = 'pay_executor_' + randomUUID().replaceAll('-', '');
const foreignName = 'pay_foreign_' + randomUUID().replaceAll('-', '');
function login(name: string) {
  const url = new URL(adminURL!);
  url.username = name;
  return url.toString();
}
const authorizer = new Pool({
  connectionString: login(authorizerName),
  max: 8,
});
const executor = new Pool({ connectionString: login(executorName), max: 8 });
const foreign = new Pool({ connectionString: login(foreignName) });
const payments = new PostgresPayments(authorizer, executor);
let policyId: string, receivable: string, payable: string;

before(async () => {
  await admin.query(
    "INSERT INTO ledger.book(id,code,environment) VALUES($1,$2,'synthetic'),($3,$4,'synthetic'),($5,$6,'test')",
    [
      bookId,
      'payments-' + bookId,
      otherBook,
      'payments-' + otherBook,
      testBook,
      'payments-' + testBook,
    ],
  );
  for (const [name, capability, book] of [
    [authorizerName, 'authorizer', bookId],
    [executorName, 'executor', bookId],
    [foreignName, 'executor', otherBook],
  ]) {
    await admin.query(
      `CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE flow_payment_${capability}`,
    );
    await admin.query('SELECT payments.bind_principal($1::name,$2::uuid,$3)', [
      name,
      book,
      capability,
    ]);
  }
  for (const [code, classification, normalSide] of [
    ['processor-receivable', 'asset', 'debit'],
    ['merchant-payable', 'liability', 'credit'],
  ] as const) {
    const account = await ledger.createAccount({
      bookId,
      commandKey: randomUUID(),
      actorId: 'payment-test-provisioner',
      reason: 'Approved synthetic accounting policy fixture',
      code,
      classification,
      normalSide,
      currency: 'PHP',
    });
    if (classification === 'asset') receivable = account.id;
    else payable = account.id;
  }
  policyId = (
    await admin.query<{ id: string }>(
      'SELECT payments.configure_policy($1::jsonb) AS id',
      [
        JSON.stringify({
          bookId,
          currency: 'PHP',
          policyVersion: 'synthetic-capture-v1',
          receivableAccountId: receivable,
          payableAccountId: payable,
        }),
      ],
    )
  ).rows[0]!.id;
});
after(async () => {
  await Promise.all(
    [admin, writer, authorizer, executor, foreign].map((p) => p.end()),
  );
});
afterEach(async () => {
  const sweep = await new PostgresIntegrity(admin).sweep(bookId);
  assert.equal(sweep.integrity, 'PASS', JSON.stringify(sweep.violations));
});
function capture(): AccountingCommand {
  return {
    bookId,
    commandKey: randomUUID(),
    businessKey: randomUUID(),
    kind: 'CAPTURE',
    policyId,
    money: Money.of(9007199254740993n, 'PHP'),
    effectiveAt: '2026-11-21T00:00:00.000Z',
    actorId: 'synthetic-independent-approver',
    reason: 'Approved synthetic capture expectation',
    originalCaptureId: null,
  };
}
function reversal(originalCaptureId: string): AccountingCommand {
  return {
    ...capture(),
    kind: 'REVERSAL',
    originalCaptureId,
    reason: 'Approved full synthetic correction',
  };
}
const coded = (expected: string) => (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === expected;
async function count(table: string, column: string, id: string) {
  // All table/column inputs below are fixed fixture constants, never user input.
  const result = await admin.query<{ n: string }>(
    `SELECT count(*)::text n FROM ${table} WHERE ${column}=$1`,
    [id],
  );
  return BigInt(result.rows[0]!.n);
}
async function prepare() {
  const command = capture();
  const approved = await payments.authorize(command);
  return { command, approved };
}

test('synthetic policy and separate scoped credentials refuse every bypass and immutable mutation', async () => {
  const command = capture();
  for (const sql of [
    "SELECT payments.configure_policy('{}'::jsonb)",
    "SELECT payments.bind_principal(current_user,$1,'executor')",
    "SELECT ledger.post_journal('{}'::jsonb)",
    "UPDATE payments.authorization SET reason='changed' WHERE false",
    'DELETE FROM payments.execution WHERE false',
  ])
    await assert.rejects(
      executor.query(sql, sql.includes('$1') ? [bookId] : []),
      coded('42501'),
    );
  await assert.rejects(
    executor.query('SELECT payments.authorize($1::jsonb)', [
      serializeCommand(command),
    ]),
    coded('42501'),
  );
  await assert.rejects(
    authorizer.query('SELECT payments.execute($1::uuid)', [randomUUID()]),
    coded('42501'),
  );
  await assert.rejects(
    writer.query('SELECT payments.execute($1::uuid)', [randomUUID()]),
    coded('42501'),
  );
  for (const policy of [
    {
      bookId: testBook,
      currency: 'PHP',
      receivableAccountId: receivable,
      payableAccountId: payable,
    },
    {
      bookId,
      currency: 'USD',
      receivableAccountId: receivable,
      payableAccountId: payable,
    },
    {
      bookId,
      currency: 'PHP',
      receivableAccountId: payable,
      payableAccountId: receivable,
    },
    {
      bookId: otherBook,
      currency: 'PHP',
      receivableAccountId: receivable,
      payableAccountId: payable,
    },
  ])
    await assert.rejects(
      admin.query('SELECT payments.configure_policy($1::jsonb)', [
        JSON.stringify({ ...policy, policyVersion: randomUUID() }),
      ]),
    );
  await assert.rejects(payments.execute(randomUUID()));
});

test('approval binds the complete command; execution creates one exact balanced journal and atomic companions', async () => {
  const { command, approved } = await prepare();
  assert.equal(
    await count('audit.audit_event', 'payment_authorization_id', approved.id),
    1n,
  );
  assert.equal(
    await count('outbox.outbox_event', 'payment_authorization_id', approved.id),
    1n,
  );
  assert.equal(
    await count('payments.execution', 'authorization_id', approved.id),
    0n,
  );
  assert.equal((await payments.authorize(command)).id, approved.id);
  assert.equal((await payments.authorize(command)).replayed, true);
  await assert.rejects(
    payments.authorize({ ...command, money: Money.of(1n, 'PHP') }),
    coded('P1501'),
  );
  await assert.rejects(
    payments.authorize({ ...command, commandKey: randomUUID() }),
    coded('P1501'),
  );
  await assert.rejects(
    foreign.query('SELECT payments.execute($1::uuid)', [approved.id]),
    coded('42501'),
  );
  const recorded = await payments.execute(approved.id);
  const journal = await ledger.journal(recorded.journalId);
  assert(journal);
  assert.equal(journal.bookId, bookId);
  assert.equal(journal.entries.length, 2);
  assert.deepEqual(
    journal.entries
      .map((e) => ({
        account: e.accountId,
        side: e.side,
        amount: e.money.amountMinor.toString(),
      }))
      .sort((a, b) => a.side.localeCompare(b.side)),
    [
      { account: payable, side: 'credit', amount: '9007199254740993' },
      { account: receivable, side: 'debit', amount: '9007199254740993' },
    ],
  );
  assert.deepEqual(await payments.execute(approved.id), {
    ...recorded,
    replayed: true,
  });
  assert.equal(
    await count('payments.execution', 'authorization_id', approved.id),
    1n,
  );
  assert.equal(
    await count('audit.audit_event', 'payment_execution_id', recorded.id),
    1n,
  );
  assert.equal(
    await count('outbox.outbox_event', 'payment_execution_id', recorded.id),
    1n,
  );
  const registration = await admin.query(
    'SELECT r.disposition FROM worker.registration r JOIN outbox.outbox_event o ON o.id=r.event_id WHERE o.payment_execution_id=$1',
    [recorded.id],
  );
  assert.equal(registration.rows[0].disposition, 'NO_LOCAL_HANDLER');
  await assert.rejects(
    admin.query(
      "UPDATE payments.authorization SET reason='rewritten' WHERE id=$1",
      [approved.id],
    ),
  );
  await assert.rejects(
    admin.query('DELETE FROM payments.execution WHERE id=$1', [recorded.id]),
  );
});

test('synchronized duplicate executors converge on one journal and conflicting approvals cannot race', async () => {
  const { command, approved } = await prepare();
  const held = await admin.connect();
  const pending: ReturnType<PostgresPayments['execute']>[] = [];
  try {
    await held.query('BEGIN');
    await held.query(
      'SELECT 1 FROM payments.authorization WHERE id=$1 FOR UPDATE',
      [approved.id],
    );
    for (let i = 0; i < 3; i++) pending.push(payments.execute(approved.id));
    let contenders = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      contenders = (
        await admin.query<{ n: number }>(
          "SELECT count(*)::integer n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",
          [executorName],
        )
      ).rows[0]!.n;
      if (contenders >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(
      contenders >= 2,
      'at least two executions must demonstrably contend',
    );
    await held.query('COMMIT');
  } finally {
    await held.query('ROLLBACK');
    held.release();
  }
  const results = await Promise.all(pending);
  assert.equal(new Set(results.map((r) => r.journalId)).size, 1);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  const tx = await authorizer.connect();
  let rejected: Promise<unknown> | undefined;
  try {
    await tx.query('BEGIN');
    const competing = {
      ...command,
      commandKey: randomUUID(),
      businessKey: randomUUID(),
    };
    await tx.query('SELECT payments.authorize($1::jsonb)', [
      serializeCommand(competing),
    ]);
    rejected = assert.rejects(
      payments.authorize({ ...competing, reason: 'Conflicting authorization' }),
      coded('P1501'),
    );
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      waiting =
        (
          await admin.query<{ n: number }>(
            "SELECT count(*)::integer n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",
            [authorizerName],
          )
        ).rows[0]!.n > 0;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(waiting, 'conflicting approval must wait on the first transaction');
    await tx.query('COMMIT');
    await rejected;
  } finally {
    await tx.query('ROLLBACK');
    tx.release();
    if (rejected) await rejected;
  }
});

test('failure before commit rolls back every execution companion and preserves the approval for retry', async () => {
  const { approved } = await prepare();
  const tx = await executor.connect();
  let rolledBackJournal: string | undefined;
  try {
    await tx.query('BEGIN');
    rolledBackJournal = (
      await tx.query<{ result: { journalId: string } }>(
        'SELECT payments.execute($1::uuid) result',
        [approved.id],
      )
    ).rows[0]!.result.journalId;
    await assert.rejects(tx.query('SELECT 1/0'), coded('22012'));
    await tx.query('ROLLBACK');
  } finally {
    tx.release();
  }
  assert.equal(await ledger.journal(rolledBackJournal!), null);
  assert.equal(
    await count('payments.execution', 'authorization_id', approved.id),
    0n,
  );
  const result = await payments.execute(approved.id);
  assert(result.journalId !== rolledBackJournal);
});

test('lost COMMIT acknowledgement recovers the unchanged authorization and produces one financial effect', async () => {
  const { approved } = await prepare();
  const proxy = await commitDropProxy(login(executorName));
  const pool = new Pool({ connectionString: proxy.url });
  pool.on('error', () => {});
  try {
    await assert.rejects(
      new PostgresPayments(authorizer, pool).execute(approved.id),
      UnknownPaymentCommit,
    );
    await proxy.dropped;
    const replay = await payments.execute(approved.id);
    assert.equal(replay.replayed, true);
    assert.equal(
      await count('payments.execution', 'authorization_id', approved.id),
      1n,
    );
  } finally {
    await pool.end();
    await proxy.close();
  }
});

test('full reversal requires its own approval; generic ledger paths and competing reversals cannot bypass it', async () => {
  const previousDelta = await ledger.accountDelta(receivable);
  const { approved } = await prepare();
  const captured = await payments.execute(approved.id);
  const beforeJournal = await ledger.journal(captured.journalId);
  await assert.rejects(
    ledger.reverse({
      bookId,
      commandKey: randomUUID(),
      originalJournalId: captured.journalId,
      effectiveAt: '2026-11-21T01:00:00.000Z',
      policyVersion: 'synthetic-capture-v1',
      actorId: 'unapproved-writer',
      reason: 'Must not bypass independent approval',
    }),
  );
  await assert.rejects(
    ledger.post({
      bookId,
      commandKey: randomUUID(),
      effectNamespace: 'payments.capture',
      businessEffectKey: randomUUID(),
      currency: 'PHP',
      effectiveAt: '2026-11-21T00:00:00.000Z',
      policyVersion: 'synthetic-capture-v1',
      actorId: 'unapproved-writer',
      reason: 'Must not bypass independent approval',
      entries: beforeJournal!.entries,
    }),
  );
  await assert.rejects(
    payments.authorize({
      ...reversal(captured.id),
      money: Money.of(1n, 'PHP'),
    }),
  );
  const first = await payments.authorize(reversal(captured.id));
  const second = await payments.authorize(reversal(captured.id));
  const held = await admin.connect();
  let outcomes: Promise<
    PromiseSettledResult<Awaited<ReturnType<PostgresPayments['execute']>>>[]
  >;
  try {
    await held.query('BEGIN');
    await held.query(
      'SELECT 1 FROM payments.execution WHERE id=$1 FOR UPDATE',
      [captured.id],
    );
    outcomes = Promise.allSettled([
      payments.execute(first.id),
      payments.execute(second.id),
    ]);
    let waiting = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      waiting = (
        await admin.query<{ n: number }>(
          "SELECT count(*)::integer n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'",
          [executorName],
        )
      ).rows[0]!.n;
      if (waiting >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(waiting >= 2, 'competing reversals must demonstrably contend');
    await held.query('COMMIT');
  } finally {
    await held.query('ROLLBACK');
    held.release();
  }
  const results = await outcomes!;
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  const winner = results.find(
    (r) => r.status === 'fulfilled',
  )! as PromiseFulfilledResult<
    Awaited<ReturnType<PostgresPayments['execute']>>
  >;
  const inverse = await ledger.journal(winner.value.journalId);
  assert.equal(inverse?.reversalOf, captured.journalId);
  assert.deepEqual(await ledger.journal(captured.journalId), beforeJournal);
  assert.equal(
    await ledger.accountDelta(receivable),
    -(await ledger.accountDelta(payable)),
  );
  assert.equal(await ledger.accountDelta(receivable), previousDelta);
  await assert.rejects(payments.authorize(reversal(winner.value.id)));
});

test('independent sweep detects balanced but unauthorized accounting after owner-only corruption and rollback restores truth', async () => {
  const { approved } = await prepare();
  const recorded = await payments.execute(approved.id);
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE ledger.ledger_entry DISABLE TRIGGER USER');
    await client.query(
      'UPDATE ledger.ledger_entry SET amount_minor=1 WHERE journal_id=$1',
      [recorded.journalId],
    );
    const result = await client.query<{
      summary: { integrity: string; violations: { invariant: string }[] };
    }>('SELECT integrity.sweep($1::uuid) summary', [bookId]);
    assert.equal(result.rows[0]!.summary.integrity, 'FAIL');
    assert(
      result.rows[0]!.summary.violations.some(
        (v) => v.invariant === 'PAYMENT_EXECUTION_AUTHORITY',
      ),
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
