/** Technical worker database connectivity only; never financial assurance. */
import { Pool } from 'pg';
async function main() {
  const url =
    process.env['STRIPE_WORKER_DATABASE_URL'] ??
    process.env['DATABASE_WORKER_URL'];
  if (!url) throw new Error('Missing scoped worker connection');
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  });
  try {
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  process.exitCode = 1;
});
