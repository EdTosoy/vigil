/** Read-only scoped operational attention report; never repairs or sends alerts. */
import { Pool } from 'pg';
import { PostgresOperations } from '@vigil/operations-read-postgres';
import { monitorReport } from './monitor-report';

async function main() {
  const [bookId, evaluationId, ...extra] = process.argv.slice(2);
  const url = process.env['DATABASE_OPERATIONS_URL'];
  if (!url || !bookId || extra.length)
    throw new Error(
      'Usage: operational:monitor <book-id> [explicit-control-evaluation-id]',
    );
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    application_name: 'vigil-operational-monitor',
  });
  pool.on('error', () => {});
  try {
    const report = await monitorReport(new PostgresOperations(pool), {
      bookId,
      ...(evaluationId ? { evaluationId } : {}),
    });
    console.log(JSON.stringify(report));
    process.exitCode =
      report.attentionStatus === 'FAIL'
        ? 2
        : report.attentionStatus === 'UNKNOWN'
          ? 3
          : 0;
  } finally {
    await pool.end();
  }
}
void main().catch(() => {
  console.error(
    'Operational monitor unavailable; no successful observation claimed',
  );
  process.exitCode = 1;
});
