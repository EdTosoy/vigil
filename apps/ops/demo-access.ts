import { createHash, timingSafeEqual } from 'node:crypto';

/** Path shapes only; the synthetic read port independently validates book/record identity. */
function publicRoute(path: string): boolean {
  if (
    /^\/(?:overview|reconciliation|exceptions|controls|workers|integrity)?$/.test(
      path,
    ) ||
    path === '/health/live' ||
    path === '/health/ready'
  )
    return true;
  if (
    /^\/(?:reconciliation|exceptions|workers)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      path,
    )
  )
    return true;
  // Control keys are opaque and can contain an encoded slash (currency scope).
  if (!/^\/controls\/[^/]+$/.test(path)) return false;
  try {
    const key = decodeURIComponent(path.slice('/controls/'.length));
    return (
      key !== '.' &&
      key !== '..' &&
      ![...key].some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || c === '\\',
      )
    );
  } catch {
    return false;
  }
}

/** Server-side demo gate; shared access is deliberately not a production identity system. */
export function demoAccess(
  path: string,
  authorization: string | null,
  env: NodeJS.ProcessEnv,
  method = 'GET',
): 200 | 401 | 404 | 503 {
  const mode = env['VIGIL_DEPLOYMENT_MODE'] ?? env['FLOW_DEPLOYMENT_MODE'];
  if (mode === undefined) return 200;
  if (mode === 'public-demo') {
    return env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo' &&
      (method === 'GET' || method === 'HEAD') &&
      publicRoute(path)
      ? 200
      : 404;
  }
  if (mode !== 'demo') return 503;
  // Exact cheap technical probes only. Financial diagnostics and metrics remain protected.
  if (path === '/health/live' || path === '/health/ready') return 200;
  const user = env['VIGIL_DEMO_USERNAME'] ?? env['FLOW_DEMO_USERNAME'],
    password = env['VIGIL_DEMO_PASSWORD'] ?? env['FLOW_DEMO_PASSWORD'];
  if (
    !user ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(user) ||
    !password ||
    password.length < 32
  )
    return 503;
  if (
    !authorization ||
    authorization.length > 1024 ||
    !/^Basic [A-Za-z0-9+/]+=*$/.test(authorization)
  )
    return 401;
  const supplied = Buffer.from(authorization.slice(6), 'base64').toString(
    'utf8',
  );
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(supplied), hash(user + ':' + password))
    ? 200
    : 401;
}
