import 'server-only';
import {
  authPool,
  createAuthService,
  validateAuthEnvironment,
} from './auth-service';

/** Process-local authentication initialization, separate from request/session state. */
export function createAuthRuntime(
  env: NodeJS.ProcessEnv,
  poolFactory: typeof authPool = authPool,
) {
  let service: ReturnType<typeof createAuthService> | undefined;
  let checking: Promise<void> | undefined;
  let validated = false;
  let retryAt = 0;
  async function getService(refresh = false) {
    if (env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo')
      throw new Error(
        'Authentication is disabled for the isolated public snapshot',
      );
    if (!service) {
      const url = env['DATABASE_AUTH_URL'];
      if (
        !url ||
        url === env['DATABASE_ADMIN_URL'] ||
        url === env['DATABASE_OPERATIONS_URL']
      )
        throw new Error('A separately scoped DATABASE_AUTH_URL is required');
      validateAuthEnvironment(env);
      const pool = poolFactory(url);
      service = createAuthService(pool, env);
    }
    if (!validated || refresh) {
      if (!checking) {
        if (performance.now() < retryAt)
          throw new Error('Authentication unavailable; retry after backoff');
        validated = false;
        checking = service
          .ready()
          .then(
            () => {
              validated = true;
            },
            (error: unknown) => {
              validated = false;
              retryAt = performance.now() + 1000;
              throw error;
            },
          )
          .finally(() => {
            checking = undefined;
          });
      }
      await checking;
    }
    return service;
  }
  return {
    service: getService,
    async ready() {
      await getService(true);
    },
  };
}
