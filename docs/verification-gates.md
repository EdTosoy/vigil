# Verification gates

Inspected for the P0 engineering baseline. Use the root AGENTS.md and actual
package scripts; this inventory does not assert that any check passed.
Package manager: `pnpm@11.27.0` from package.json.

| Gate                     | Existing command                                                                    | Scope / prerequisite                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Types                    | `pnpm typecheck`                                                                    | Shared TypeScript check plus ops app typecheck                                                                                    |
| Static analysis          | `pnpm lint`                                                                         | Nx graph, ESLint with no warnings, oracle dependency boundaries; writes .nx graph artifact                                        |
| Formatting               | `pnpm format:check`                                                                 | Existing source/phase-doc globs; excludes this root docs file                                                                     |
| Units/contracts          | `pnpm test:unit`                                                                    | Nx unit tests, boundary tests, Stripe HTTP contracts, deployment/startup configuration and operational monitor tests              |
| Build                    | `pnpm build`                                                                        | Nx targets including the ops frontend; creates build artifacts                                                                    |
| Database/integration     | `pnpm test:integration`                                                             | Docker-hosted disposable PostgreSQL 18; sequential migration preservation/hash checks, restricted roles, application integrations |
| Scoped browser journey   | `pnpm exec tsx tools/test-postgres.ts tests/operations-browser.integration.test.ts` | Same real database bootstrap, operations server and Chromium; console/page errors and UI assertions                               |
| Resilience               | `pnpm test:resilience`                                                              | Database-backed failure, load, and restart tests; slower, select when affected                                                    |
| Stripe contracts         | `pnpm test:stripe:contract`                                                         | Local HTTP fixtures; not evidence of live Stripe behavior                                                                         |
| Deployment configuration | `pnpm test:deployment`                                                              | Local tests; does not deploy or authorize cloud changes                                                                           |
| Startup configuration    | `pnpm test:startup`                                                                 | Docker Compose configuration and shell/security checks; does not start containers or access AWS                                   |
| Monitor decisions        | `pnpm test:operations`                                                              | Pure operational monitor classification tests; real database/restore behavior remains in the integration gate                     |
| Aggregate                | `pnpm verify`                                                                       | Format, lint, build, types, unit, and real integrations in sequence                                                               |

The integration runner accepts only its allowlisted test-file paths. It creates
and stops its own Docker container and tests migration preservation across prior
schema phases. Docker access is a privileged host boundary: review and authorize
the fixture lifecycle before running it. Do not point `pnpm db:migrate` or other
tools at production to satisfy a verification gate.

Browser tests use Playwright and either its configured Chromium or the existing
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` / system Chromium fallback. They capture
temporary screenshots and exercise narrow/wide layouts and keyboard behavior.
Missing Docker, database, or browser access is NOT RUN; do not install browsers
or change launch security flags without separate approval.

Security evidence includes dependency-boundary checks, API/role tests and real
database privilege constraints. `.github/workflows/verify.yml` retains the fast
format/lint/types/unit/build job using Node 24 and the pinned pnpm package manager.
After it passes, a separate `database-integration` job installs the lockfile's
Playwright Chromium and its Linux libraries, explicitly selects that executable,
builds the production application and runs the existing `pnpm test:integration`.
The runner owns a randomly named disposable PostgreSQL 18 container; it does not
use an existing database, AWS or Stripe credentials. The default suite includes
populated migration preservation, restricted roles, financial/concurrency/failure
tests, authentication and production browser journeys, and resilience scenarios.
The workflow keeps read-only repository permissions and cancellable runs. The
integration job has a 90-minute outer deadline because historical local database
runs took about 25 minutes; individual test deadlines remain unchanged. Startup
configuration tests now participate in `test:unit` and therefore `pnpm verify`
and CI; their Compose parser requires the Docker Compose plugin.

This is configured CI coverage, not evidence of a successful hosted workflow.
Configure repository branch protection to require both job results before merge;
editing a workflow does not change GitHub protection settings.

The manual `vigil-images.yml` workflow calls this same verification workflow once
through `workflow_call`, at the caller's exact commit, before its dependent publish
job can start. Its development-branch restriction remains in both jobs. The
verification call receives only read access and no inherited secrets; OIDC token
permission is scoped to the publish job. A failed or cancelled verification skips
publication. This follows GitHub's [reusable workflow documentation](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
for local same-commit calls and permission boundaries. No workflow was dispatched
and no image was published by this configuration change. There is no dedicated
dependency-audit script. Local checks do not prove live cloud security or
accessibility certification.

For a change, select the relevant subset and record exact commands with PASS,
FAIL, SKIPPED, or NOT RUN and a reason. Do not alter assertions merely to pass.
Preserve unrelated working-tree edits and keep screenshots/logs free of secrets.

## Historical P1 local evidence

On the earlier P1 working tree, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`,
`pnpm test:unit`, and `pnpm build` passed. Units ran 15 Nx targets plus 5 boundary,
4 HTTP-contract, and 9 deployment/access tests. Build ran 24 targets in 31.6s.
Existing uncommitted ops/config and access-test edits were preserved; this is not
a clean-HEAD result. Hosted execution is NOT RUN.

Installed Playwright 1.63.0 expects Chromium revision 1243 (153.0.8010.12).
Its cached generic headless shell failed on the NixOS dynamic loader. The existing
Nix Chromium 153.0.8010.52 passed launch, DOM, screenshot, and trace probes with
Chromium sandbox enabled. The real application/database browser suite is NOT
RUN: its database lifecycle falls outside this task's no-destructive-DB boundary.
Do not equate that platform probe with financial or application integration proof.

## Hardening gate verification

The configured workflows were parsed as YAML, and the browser-install command was
checked against the installed Playwright 1.63.0 CLI. `pnpm test:startup` passed all
three configuration/security tests. Hosted workflow execution, browser download
on the GitHub runner and required-status configuration are NOT RUN locally.
The full combined local verification is recorded separately when it completes.
