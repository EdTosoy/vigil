# Local synthetic investigation demo

This database-backed demo uses only deterministic public synthetic evidence. It
never contacts Stripe or AWS, moves money, or authorizes accounting from external
observations. The dashboard remains read-only. Its shared visitor account is
synthetic-only; never reuse it for staff or real data.

## Fresh checkout

Install Node 24, pnpm 11.27.0, Docker Engine with the local socket at
`/var/run/docker.sock`, Docker Compose, and Chromium on PATH (or install the
lockfile-pinned Playwright Chromium). Ensure your user can access Docker.

```sh
pnpm install --frozen-lockfile
docker pull postgres:18@sha256:fc973eb97c9fd04bfa1840e0f510719a584ccb3be8debfe6a4144637a9dfe8cf
pnpm build
pnpm demo:local
```

Use a clean shell without DATABASE_, STRIPE_, AWS_, DOCKER_, BETTER_AUTH_,
OPS_BOOK_ID or deployment-mode configuration. The tool rejects inherited targets
and passes an explicit environment to children. It does not read private dotenv
files. No existing database URL or port can be selected.

The tool starts a new randomly named PostgreSQL container, applies all migrations,
creates separate capability logins, seeds deterministic evidence and a scoped
Viewer identity, then runs the standalone production app on a random loopback
port. Open the printed URL and use the intentionally public synthetic visitor
identity printed with it. Both ports bind only to 127.0.0.1. The temporary database
uses trust authentication only inside this disposable local fixture; other local
processes can access that port. Do not expose it to a network or use real data.

## Investigation scenarios

Seed 71201 includes valid exact settlement/bank matches and one missing bank
movement. The setup verifies at least one MATCHED group and an UNMATCHED outcome.
Received records do not prove upstream completeness: source coverage remains
UNKNOWN. The existing seed also illustrates accepted risk, which remains
unreconciled, and retained operational failures.

A repeated processor delivery must preserve source-fact, revision and journal
counts. No external receipt creates a journal. A new bank amount revision then
invalidates earlier current assurance while retaining the original historical
matched-group count. The earlier frozen control evaluation is intentionally
retained for investigation. Historical MATCHED is not current assurance, and
UNKNOWN is not a pass. The terminal prints scenario assertion results before
announcing readiness; a failed assertion aborts startup.

```sh
pnpm demo:local --smoke
```

Smoke mode additionally launches real Chromium, checks the anonymous redirect,
signs in through the actual application, visits all six operations sections, and
rejects page errors. It then stops the app and its owned database and removes its
private temporary files. A successful run prints scenario, browser and cleanup
PASS evidence and exits zero. Ordinary mode stays running until Ctrl-C or SIGTERM.

Cleanup checks the container ownership label before stopping it. It does not
remove other containers, databases or Docker volumes. SIGKILL, host failure or a
Docker outage can prevent cleanup; inspect only the printed `vigil-local-demo-`
container identity before manually stopping that owned fixture. Missing image,
Docker access, production build or browser is a prerequisite failure, not a
passing smoke test.

## Release verification

Run `NX_DAEMON=false NEXT_TELEMETRY_DISABLED=1 pnpm verify` (the CI daemon
settings) for formatting, lint/boundaries, production builds, types,
unit/contracts/deployment/startup tests, and the real PostgreSQL suite including
browser journeys. The test runner owns its disposable database. Do not point
migration commands at an existing database to reproduce these checks.

## Executed release-readiness verification — 2026-11-23

`NX_DAEMON=false NEXT_TELEMETRY_DISABLED=1 pnpm verify` exited 0 on the final
working tree. The installed pinned pnpm 11.27.0 executable was placed first on
PATH for nested commands. Formatting, ESLint/oracle boundaries, all 26 production
build targets and root/application types passed. Tests passed: 166 across 16 Nx
unit/property/UI targets; 5 boundaries; 4 Stripe HTTP contracts; 93 deployment
contracts; 5 startup checks; 5 monitor checks; 3 demo configuration checks; and
312 real PostgreSQL integration tests. Total: 593 tests. The database suite had
zero failures, cancellations, skips or todo and took 1,644.31 seconds. It includes
populated migration preservation, restricted roles, concurrency, crash/unknown
commit recovery, production Chromium, logical restore and resilience checks.

A separate source-only temporary copy excluded ignored dotenv files, dependencies
and build artifacts. `pnpm install --frozen-lockfile`, `pnpm build` and
`pnpm test:demo:integration` all passed there. The offline install first reported
a missing cached tarball; the ordinary registry install completed with the
unchanged lockfile. This reproduces the fresh-source workflow, not a remote clone
or a hosted CI run.

The smoke verified 11 valid matched groups, unresolved missing bank evidence,
UNKNOWN source coverage, duplicate delivery without new facts/revisions/journals,
and revised bank evidence invalidating current proof while retaining historical
matches. Real Chromium authenticated and visited all six sections without page
errors. Normal startup followed by SIGTERM also exited zero. Cleanup assertions
confirmed owned-container and temporary-directory removal; final Docker inspection
found no remaining local-demo containers.

An earlier aggregate attempt cancelled boundary tests while using the ambient Nx
daemon settings and left their known temporary probe behind. That generated probe
was removed and the complete gate rerun successfully with CI's daemon settings.
No test assertion or deadline was relaxed. The Compose repair preserves explicit
false declarations, rejects enabled/omitted declarations, tests actual refusal of
all three missing bind directories and includes a positive creation control. The
historical CI failure was omission of a false boolean from Compose's serialized
JSON, not evidence that enabled directory creation was safe.

No AWS deployment, external Stripe call, remote publication or hosted CI dispatch
was performed. Repository branch protections remain unchanged. Logs were retained
locally under `/tmp/vigil-release-*`; they are not committed release artifacts.
