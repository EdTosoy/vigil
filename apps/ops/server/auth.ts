import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createAuthRuntime } from './auth-runtime';

const runtime = createAuthRuntime(process.env);
export const authService = runtime.service;
export const authReady = runtime.ready;
export const currentPrincipal = cache(async () => {
  const service = await authService();
  return service.principal(new Headers(await headers()));
});
export async function requirePrincipal() {
  const principal = await currentPrincipal();
  if (!principal) redirect('/sign-in');
  return principal;
}
