import { authService } from '../../../../server/auth';
export const dynamic = 'force-dynamic';
const routes: Record<string, string[]> = {
  '/api/auth/sign-in/email': ['POST'],
  '/api/auth/sign-out': ['POST'],
  '/api/auth/get-session': ['GET'],
};
async function handle(request: Request) {
  if (
    process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo' ||
    !routes[new URL(request.url).pathname]?.includes(request.method)
  )
    return new Response('Not found', { status: 404 });
  try {
    const service = await authService();
    const response = await service.auth.handler(request);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return new Response('Authentication unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
export const GET = handle;
export const POST = handle;
