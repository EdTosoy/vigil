import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { demoAccess } from './demo-access';
/** Replace untrusted input; correlation identity is never a financial command identity. */
export function proxy(request: NextRequest) {
  const mode =
    process.env['VIGIL_DEPLOYMENT_MODE'] ?? process.env['FLOW_DEPLOYMENT_MODE'];
  const publicMode = mode === 'public-demo';
  const path = request.nextUrl.pathname;
  // Proxy is an optimistic navigation gate. Database sessions and book grants
  // are checked again at every server read, never trusted from this cookie hint.
  if (!publicMode) {
    if (mode && !['application', 'demo'].includes(mode))
      return new NextResponse('Unavailable', { status: 503 });
    const open =
      path === '/sign-in' ||
      path.startsWith('/api/auth/') ||
      /^\/health\/(live|ready)$/.test(path) ||
      /^\/(?:android-chrome-(?:192x192|512x512)|apple-touch-icon|favicon-(?:16x16|32x32|48x48))\.png$/.test(
        path,
      ) ||
      path === '/site.webmanifest';
    if (
      !open &&
      !request.cookies.get('better-auth.session_token') &&
      !request.cookies.get('__Secure-better-auth.session_token')
    )
      return NextResponse.redirect(new URL('/sign-in', request.url));
  }
  const access = publicMode
    ? demoAccess(
        request.nextUrl.pathname,
        request.headers.get('authorization'),
        process.env,
        request.method,
      )
    : 200;
  if (access === 404)
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'no-store' },
    });
  if (access !== 200)
    return new NextResponse('Unavailable', {
      status: access,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  const id = randomUUID();
  const headers = new Headers(request.headers);
  headers.set('x-vigil-request-id', id);
  headers.set('x-flow-request-id', id);
  // Credentials terminate at the access boundary, not in read-model/log headers.
  headers.delete('authorization');
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-vigil-request-id', id);
  response.headers.set('x-flow-request-id', id);
  return response;
}
export const config = {
  matcher: ['/((?!_next/static(?:/|$)|_next/image$|favicon\\.ico$).*)'],
};
