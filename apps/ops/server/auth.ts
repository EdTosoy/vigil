import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import {
  authPool,
  checkAuthCredential,
  createAuthService,
} from './auth-service';

let service: ReturnType<typeof createAuthService> | undefined;
let checked: Promise<void> | undefined;
export async function authService() {
  if (process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo')
    throw new Error(
      'Authentication is disabled for the isolated public snapshot',
    );
  if (!service) {
    const url = process.env['DATABASE_AUTH_URL'];
    if (
      !url ||
      url === process.env['DATABASE_ADMIN_URL'] ||
      url === process.env['DATABASE_OPERATIONS_URL']
    )
      throw new Error('A separately scoped DATABASE_AUTH_URL is required');
    const pool = authPool(url);
    service = createAuthService(pool, process.env);
    checked = checkAuthCredential(pool);
  }
  await checked;
  return service;
}
export const currentPrincipal = cache(async () => {
  const service = await authService();
  return service.principal(new Headers(await headers()));
});
export async function requirePrincipal() {
  const principal = await currentPrincipal();
  if (!principal) redirect('/sign-in');
  return principal;
}
