import 'server-only';
import { Pool } from 'pg';
import { observe, telemetry, log } from './telemetry';
import {
  PostgresOperations,
  ReadUnavailable,
  type Operation,
} from '@vigil/operations-read-postgres';
import { navigation } from './navigation';
export type { Search } from '../components/navigation';
import type { Search } from '../components/navigation';
let pool: Pool | undefined;
export function scope(search: Search, section: string, id?: string) {
  return navigation(search, section, id, process.env['OPS_BOOK_ID']);
}
function reader() {
  const url = process.env['DATABASE_OPERATIONS_URL'];
  if (!url) throw new ReadUnavailable('UNAVAILABLE');
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
      application_name: 'flow-operations',
    });
    pool.on('error', () =>
      log('idle_connection', 'FAILURE', {
        classification: 'DATABASE_UNAVAILABLE',
      }),
    );
  }
  return new PostgresOperations(pool, observe);
}
export async function ready() {
  await reader().ready();
}
export async function read(
  kind: Operation,
  book: string | null,
  filters: Record<string, string | undefined> = {},
) {
  const result = await reader().read(kind, book, filters);
  telemetry.observedModel(kind, result);
  return result;
}
