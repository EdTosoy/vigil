import { telemetry, request } from '../../server/telemetry';
import { currentPrincipal } from '../../server/auth';
import { permits } from '../../server/auth-service';
export const dynamic = 'force-dynamic';
/** Local/internal process observations only. Performs no database query. */
export async function GET() {
  if (process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo')
    return new Response('Not found', { status: 404 });
  const principal = await currentPrincipal();
  if (!principal) return new Response('Unauthorized', { status: 401 });
  if (!permits(principal.role, 'metrics'))
    return new Response('Not found', { status: 404 });
  return request(
    'metrics',
    async () =>
      new Response(telemetry.text(), {
        headers: {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }),
  );
}
