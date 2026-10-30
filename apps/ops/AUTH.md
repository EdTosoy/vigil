# Human access

The database-backed application uses Better Auth password sessions. Public signup
and account-management HTTP endpoints are closed. The public-demo Vercel snapshot
continues to use fixed synthetic records and cannot initialize authentication or
database reads. Stripe ingress still uses its independent signature boundary.

Apply migration 014 with the existing offline migration credential:

```sh
pnpm db:migrate
```

Provision distinct non-owner PostgreSQL LOGINs through your existing database
administration process: one member of **only** `flow_auth_runtime`, and an offline
seed login member of **only** `flow_auth_seeder`. Neither gets operations, financial,
owner or other capability memberships. Use private passwords/TLS as appropriate;
the migration creates NOLOGIN capability roles, never passwords or login roles.

Set server-only `DATABASE_AUTH_URL`, `BETTER_AUTH_SECRET` (random, at least 32
characters), and `BETTER_AUTH_URL` (exact HTTPS origin, no trailing slash; HTTP
accepted only for localhost/127.0.0.1). Continue using the separate
`DATABASE_OPERATIONS_URL`. No auth environment variable is prefixed `NEXT_PUBLIC_`.
Use `VIGIL_DEPLOYMENT_MODE=application` for the real application. Database-backed
`demo` mode also requires human login; shared HTTP Basic credentials no longer
authorize operations. Configure these before upgrading a running database-backed
dashboard. No infrastructure or secrets provisioning is performed by this change.

Seed accounts against existing books with the offline `DATABASE_AUTH_SEED_URL`:

```sh
pnpm auth:seed --visitor --book <synthetic-book-uuid>
# Load VIGIL_SEED_PASSWORD privately; never place passwords in command arguments.
pnpm auth:seed --email <private-email> --name <name> --role Admin --book <book-uuid>
pnpm auth:seed --email <private-email> --name <name> --role Operator --book <book-uuid>
```

Repeat `--book` for additional grants. Seeds are atomic, reject existing emails,
and do not create financial data. `--visitor` creates the intentionally shared
`visitor@vigil.example` Viewer using the public password shown by the login page
when `VIGIL_VISITOR_LOGIN=true`. Every visitor grant must reference an existing
synthetic book; reads also check its environment. Never reuse this password for
staff. Keep the seed credential and `VIGIL_SEED_PASSWORD` out of the web process.

Admin, Operator and Viewer can read explicitly granted books only. Admin can also
read process metrics. All other privileges default to denied; no role receives
financial write endpoints or database write permissions. Role/grant changes are
offline administration; the web credential cannot modify them. Sessions are
database-backed, HttpOnly/SameSite=Lax, Secure on HTTPS, expire after eight hours,
and are checked against PostgreSQL without a cookie authorization cache. Logout
deletes the server session. Better Auth enforces origin checks and persistent
login rate limits. The proxy cookie check is only a navigation hint; server reads
independently enforce sessions and book grants, including detail URLs.

Local verification uses disposable PostgreSQL and a production build:

```sh
pnpm --filter @vigil/ops build
pnpm test:integration tests/auth.integration.test.ts
```
