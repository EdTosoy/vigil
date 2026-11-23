/** Local-only demo ownership/configuration. No ambient financial/cloud target is accepted. */
export const LOCAL_DEMO_IMAGE =
  'postgres:18@sha256:fc973eb97c9fd04bfa1840e0f510719a584ccb3be8debfe6a4144637a9dfe8cf';
export const LOCAL_DOCKER = ['--host', 'unix:///var/run/docker.sock'] as const;
export const LOCAL_DEMO_HELP = `Usage: pnpm demo:local [--smoke]

Creates a new loopback-only synthetic database and authenticated dashboard.
Requires Node 24, installed workspace dependencies, Docker with the pinned
PostgreSQL test image already available, and a production build (pnpm build).
No existing database, Stripe account or cloud configuration is used.
Ctrl-C stops only this invocation's server/container and removes its private files.
--smoke verifies readiness and then cleans up without leaving services running.
`;
export function demoArguments(args: readonly string[]) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!))
    return { help: true, smoke: false };
  if (args.length === 0) return { help: false, smoke: false };
  if (args.length === 1 && args[0] === '--smoke')
    return { help: false, smoke: true };
  throw new Error('Unknown local demo argument; use pnpm demo:local --help');
}
export function demoEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (
    Object.keys(env).some(
      (key) =>
        /^(DATABASE_|STRIPE_|AWS_|DOCKER_|BETTER_AUTH_|OPS_BOOK_ID$|VIGIL_DEPLOYMENT_MODE$|FLOW_DEPLOYMENT_MODE$)/.test(
          key,
        ) &&
        env[key] !== undefined &&
        env[key] !== '',
    )
  )
    throw new Error(
      'Use a clean shell without database, Stripe, cloud, Docker override or auth configuration',
    );
  if (!env['PATH']) throw new Error('PATH is required for local prerequisites');
  return {
    PATH: env['PATH'],
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
  };
}
export function demoContainerName(id: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))
    throw new Error('A fresh UUID is required for demo ownership');
  return 'vigil-local-demo-' + id;
}
