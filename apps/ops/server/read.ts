import 'server-only';
import { Pool } from 'pg';
import { observe, telemetry, log } from './telemetry';
import {
  PostgresOperations,
  ReadUnavailable,
  type Operation,
} from '@vigil/operations-read-postgres';
import { navigation } from './navigation';
import { PUBLIC_DEMO_BOOK, readPublicDemo } from './public-demo';
export type { Search } from '../components/navigation';
import type { Search } from '../components/navigation';
let pool: Pool | undefined;
export function scope(search: Search, section: string, id?: string) {
  if (process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo') {
    const scope = navigation(search, section, id, PUBLIC_DEMO_BOOK);
    if (scope.book && scope.book !== PUBLIC_DEMO_BOOK)
      scope.issues.push({
        field: 'book',
        message: 'Only the synthetic demo book is available.',
      });
    return scope;
  }
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
  if (process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo') return;
  await reader().ready();
}
export async function read(
  kind: Operation,
  book: string | null,
  filters: Record<string, string | undefined> = {},
) {
  const result =
    process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo'
      ? readPublicDemo(kind, book, filters)
      : await reader().read(kind, book, filters);
  telemetry.observedModel(kind, result);
  return result;
}
