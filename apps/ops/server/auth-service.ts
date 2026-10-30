/// <reference types="bun-types/sqlite" />
// Better Auth's database option references this optional driver's types. Load
// only that official declaration, not Bun's conflicting runtime globals in Node.
import 'server-only';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { parameters, type ReadResult } from '@vigil/operations-read-postgres';

export type Role = 'Admin' | 'Operator' | 'Viewer';
export type Principal = { id: string; role: Role; syntheticOnly: boolean };
export function permits(role: string, permission: 'read' | 'metrics'): boolean {
  return permission === 'read'
    ? ['Admin', 'Operator', 'Viewer'].includes(role)
    : permission === 'metrics' && role === 'Admin';
}

/** Refuse owner, financial reader/writer and seed credentials at the auth boundary. */
export async function checkAuthCredential(pool: Pool, seeder = false) {
  const { rows } = await pool.query<{ safe: boolean }>(`
    SELECT NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
      AND pg_has_role(current_user,'${seeder ? 'flow_auth_seeder' : 'flow_auth_runtime'}','USAGE')
      AND NOT pg_has_role(current_user,'${seeder ? 'flow_auth_runtime' : 'flow_auth_seeder'}','MEMBER')
      AND NOT EXISTS(SELECT FROM pg_roles m WHERE m.rolname NOT IN (current_user,'${seeder ? 'flow_auth_seeder' : 'flow_auth_runtime'}')
        AND pg_has_role(current_user,m.oid,'MEMBER'))
      AND NOT EXISTS(SELECT FROM pg_namespace n WHERE n.nspname NOT IN ('app_auth','public','information_schema') AND n.nspname NOT LIKE 'pg_%'
        AND has_schema_privilege(current_user,n.oid,'USAGE'))
      AND NOT has_schema_privilege(current_user,'app_auth','CREATE') AS safe
    FROM pg_roles r WHERE r.rolname=current_user`);
  if (rows[0]?.safe !== true)
    throw new Error('Unsafe auth database credential');
}

export function authPool(url: string) {
  const pool = new Pool({
    connectionString: url,
    options: '-c search_path=app_auth,pg_catalog -c statement_timeout=3000',
    max: 4,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    application_name: 'vigil-human-auth',
  });
  pool.on('error', () => console.error('Auth database unavailable'));
  return pool;
}

export function createAuthService(pool: Pool, env: NodeJS.ProcessEnv) {
  const secret = env['BETTER_AUTH_SECRET'];
  const baseURL = env['BETTER_AUTH_URL'];
  if (!secret || secret.length < 32 || !baseURL)
    throw new Error('BETTER_AUTH_SECRET and BETTER_AUTH_URL are required');
  const origin = new URL(baseURL);
  if (
    origin.origin !== baseURL ||
    (origin.protocol !== 'https:' &&
      !(
        origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(origin.hostname)
      ))
  )
    throw new Error(
      'Auth URL must be an exact HTTPS origin (HTTP allowed only on loopback)',
    );
  const auth = betterAuth({
    appName: 'Vigil',
    baseURL,
    secret,
    database: pool,
    trustedOrigins: [baseURL],
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
    },
    session: { expiresIn: 60 * 60 * 8, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: origin.protocol === 'https:',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    logger: { disabled: true },
  });
  return {
    auth,
    async principal(headers: Headers): Promise<Principal | null> {
      const session = await auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      if (!session) return null;
      const { rows } = await pool.query<{
        role: string;
        synthetic_only: boolean;
      }>(
        'SELECT role,synthetic_only FROM app_auth.principal WHERE user_id=$1',
        [session.user.id],
      );
      const p = rows[0];
      if (!p || !permits(p.role, 'read')) return null;
      return {
        id: session.user.id,
        role: p.role as Role,
        syntheticOnly: p.synthetic_only,
      };
    },
    async books(
      principal: Principal,
      filters: Record<string, string | undefined> = {},
    ): Promise<ReadResult> {
      const options = parameters('books', filters);
      const cursor = options['cursor'] as
        { time: string; id: string } | undefined;
      const limit = options['limit'] as number;
      const { rows } = await pool.query<{
        id: string;
        code: string;
        environment: string;
        cursorTime: string;
      }>(
        `SELECT * FROM app_auth.allowed_books($1) WHERE ("cursorTime"::timestamptz,id)>($2::timestamptz,$3::uuid)
         ORDER BY "cursorTime"::timestamptz,id LIMIT $4`,
        [
          principal.id,
          cursor?.time ?? '-infinity',
          cursor?.id ?? '00000000-0000-0000-0000-000000000000',
          limit + 1,
        ],
      );
      let nextCursor: string | null = null;
      if (rows.length > limit) {
        rows.pop();
        const last = rows.at(-1)!;
        nextCursor = Buffer.from(
          JSON.stringify({ time: last.cursorTime, id: last.id }),
        ).toString('base64url');
      }
      return {
        version: 'operations-read-v1',
        asOf: new Date().toISOString(),
        data: null,
        items: rows,
        nextCursor,
      };
    },
    async canRead(principal: Principal, book: string | null) {
      if (!book || !permits(principal.role, 'read')) return false;
      const { rows } = await pool.query<{ allowed: boolean }>(
        'SELECT EXISTS(SELECT FROM app_auth.allowed_books($1) WHERE id::text=$2) AS allowed',
        [principal.id, book],
      );
      return rows[0]?.allowed === true;
    },
  };
}
