# Public recruiter demo

A separate, explicit `VIGIL_DEPLOYMENT_MODE=public-demo` renders a **fixed synthetic
snapshot** of Vigil's operations UI. This does not use AWS, PostgreSQL, Stripe,
privileged financial operations, simulator oracle data, or live account books.

## Public demo behavior

- Visitors do not need credentials; no browser Basic authentication prompt.
- The view is visibly labeled **PUBLIC / SYNTHETIC SNAPSHOT** and **READ ONLY**.
- Every server read is dispatched to `apps/ops/server/public-demo.ts` rather than
  `PostgresOperations`. All paths are limited to a single illustrative book UUID.
- The publicly accessible metrics endpoint is denied. No financial mutation endpoints
  are added. Public data represents neither live assurance nor accounting truth.
- The normal `demo` mode keeps Basic authentication; absence of the deployment
  mode retains the previous local development behavior.

## Local verification

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter @vigil/ops typecheck` and `pnpm --filter @vigil/ops build`
3. Run `node --import tsx --test apps/ops/test/public-demo.test.ts` alongside the
   existing operations UI tests.
4. `VIGIL_DEPLOYMENT_MODE=public-demo pnpm --filter @vigil/ops dev` and inspect
   all six navigation sections; verify that no database credentials are configured.
5. Verify anonymous root 200, `/metrics` 404, synthetic banners, and that unknown
   book/detail URLs reveal no records.

## Hosting

Deploy **only the ops Next.js app** on a suitable low-cost server-capable host,
setting `VIGIL_DEPLOYMENT_MODE=public-demo` explicitly. Do not inject
`DATABASE_OPERATIONS_URL`, Stripe keys, AWS SSM secrets, or Basic-auth credentials.
Do not route `/webhooks/stripe` to this public portfolio demo.

Do not change DNS until the new host is verified, and do not apply these changes
to the currently active AWS demo task definitions. A production deployment has
not been performed by this branch.

## Temporary AWS demo cleanup

This branch does not stop RDS/ALB billing. Independently prepare a full-runtime
Terraform teardown and retire the dedicated Stripe sandbox destination. Preserve
the bootstrap S3/ECR/state and other projects.
