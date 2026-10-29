/** Independent owner-free check of the current deployment's source and human access. */
import { Pool } from 'pg';
import { authPool, checkAuthCredential } from '../apps/ops/server/auth-service';
import { visitor } from '../apps/ops/visitor';

export async function verifyCycleBindings(
  worker: Pool,
  auth: Pool,
  input: {
    stripeBookId: string;
    sourceAccountId: string;
    syntheticBookId: string;
    accountId: string;
  },
  adminEmail: string,
) {
  await checkAuthCredential(auth);
  // stripe.configure only admits test Stripe sources and freezes the association.
  // The book relation comes from the pinned current-database provisioner receipt;
  // the worker deliberately has no SELECT on ingestion.source_account.
  const source = await worker.query<{ account_id: string }>(
    `SELECT s.account_id FROM stripe.source s JOIN stripe.principal_binding p USING(source_account_id) WHERE p.principal=current_user AND p.capability='worker' AND s.source_account_id=$1`,
    [input.sourceAccountId],
  );
  const row = source.rows[0];
  if (
    source.rows.length !== 1 ||
    row?.account_id !== input.accountId ||
    input.syntheticBookId === input.stripeBookId
  )
    throw new Error('Current sandbox source binding not proven');
  for (const [email, role, syntheticOnly, books] of [
    [
      adminEmail.toLowerCase(),
      'Admin',
      false,
      [input.stripeBookId, input.syntheticBookId],
    ],
    [visitor.email, 'Viewer', true, [input.syntheticBookId]],
  ] as const) {
    const found = await auth.query<{
      id: string;
      role: string;
      synthetic_only: boolean;
    }>(
      `SELECT u.id,p.role,p.synthetic_only FROM app_auth."user" u JOIN app_auth.principal p ON p.user_id=u.id WHERE u.email=$1`,
      [email],
    );
    const principal = found.rows[0];
    if (
      found.rows.length !== 1 ||
      principal?.role !== role ||
      principal.synthetic_only !== syntheticOnly
    )
      throw new Error('Seeded human identity not proven');
    const granted = await auth.query<{ id: string; environment: string }>(
      'SELECT id,environment FROM app_auth.allowed_books($1) ORDER BY id',
      [principal.id],
    );
    if (
      JSON.stringify(granted.rows.map((r) => r.id).sort()) !==
        JSON.stringify([...books].sort()) ||
      (syntheticOnly && granted.rows.some((r) => r.environment !== 'synthetic'))
    )
      throw new Error('Current explicit book grants not proven');
  }
}
async function main() {
  const input = JSON.parse(process.env['VIGIL_BINDING_CHECK'] ?? '{}');
  if (
    !process.env['DATABASE_AUTH_URL'] ||
    !process.env['STRIPE_WORKER_DATABASE_URL'] ||
    !process.env['VIGIL_ADMIN_EMAIL']
  )
    throw new Error('Narrow verification credentials required');
  const worker = new Pool({
    connectionString: process.env['STRIPE_WORKER_DATABASE_URL'],
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  const auth = authPool(process.env['DATABASE_AUTH_URL']);
  try {
    await verifyCycleBindings(
      worker,
      auth,
      input,
      process.env['VIGIL_ADMIN_EMAIL'],
    );
    console.log(
      JSON.stringify({
        operation: 'cycle-bindings',
        outcome: 'PASS',
        ...input,
      }),
    );
  } finally {
    await Promise.all([worker.end(), auth.end()]);
  }
}
if (require.main === module)
  void main().catch(() => {
    console.error(
      JSON.stringify({ operation: 'cycle-bindings', outcome: 'FAILED' }),
    );
    process.exitCode = 1;
  });
