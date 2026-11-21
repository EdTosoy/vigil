# Audit follow-up implementation and verification

Date: 2026-11-21. Verification was performed locally before publication. No cloud,
existing database, deployment or external financial object was changed.

## Implemented scope

- Authentication: single-flight credential/schema validation, bounded retry after
  temporary failure, one scoped pool, continuous readiness and public-demo isolation.
- Verification: existing PostgreSQL/migration/concurrency/browser suite added to
  CI; startup and monitor tests included in aggregate units. Manual image
  publication depends on the same-commit complete reusable verification workflow.
- Operations: read-only scoped monitor with separate operational and financial
  attention; independent local logical backup/restore proof. See
  [operational semantics and measured recovery](operations-hardening.md).
- Accounting: approved synthetic-only capture/full reversal, fixed versioned
  account mapping, independent authorizer/executor capability, exact immutable
  approvals, atomic journal/audit/outbox and conservative commit recovery.
  See [ADR-022](architecture/adr/022-synthetic-authorized-accounting.md).
- Stripe verification: optional explicit event-type requirement prevents a
  successful charge satisfying a refund/payout check. It retains source-bound
  successful attempts and exact counts without broadening database privileges.
- Next.js updated from 16.4.3 to 16.4.5 after the build surfaced a security
  advisory and the user instructed continuation. The [maintainer release](https://github.com/vercel/next.js/releases/tag/v16.4.5)
  lists its security fixes. No exploitation claim follows from package detection.

## Review and test loops

The authentication regression failed against the old cached-rejection behavior.
The fix passed four lifecycle tests and ten actual PostgreSQL/production Chromium
tests. Independent review expanded readiness to all required session fields and
the underlying book-grant function, with reversible broken-schema tests.

The Stripe lifecycle regression first failed because a completed capture counted
as a refund. After filtering the requested type, all fifteen local Stripe
PostgreSQL tests passed. Local fixtures do not establish new external lifecycles.

Restore testing exposed PostgreSQL 18 grantor recreation and semantically equal
implicit/default ACL representation. The final proof retains grantor identities,
compares effective permissions and verifies runtime denials, immutable-history
and balance guards, actual restored sessions, original identity replay and
backlog recovery. All dump artifacts belong to private temporary test storage.

The initial payment suite passed six real PostgreSQL cases. Independent review
then strengthened the read-only payment verifier against balanced-but-wrong
journals; the added owner-corruption test always rolls back the fixture change.
Existing migration preservation checks compare exact historical JSON, omitting
only the two newly added top-level nullable payment-reference columns.

## Combined verification

**PASS:** final `pnpm verify` exited 0. Formatting, lint/oracle boundaries, all
26 build targets, root/application types, unit/property/boundary/HTTP/deployment/
startup/monitor tests and **312 real PostgreSQL integration tests** completed.
The database suite reported zero failures, cancellations, skips or todo in
1,614.96 seconds. Log: `/tmp/vigil-hardening-combined.log`.

The combined run includes the final migration 015, all seven payment integration
tests (including balanced-but-unauthorized corruption detection), the updated
82-table payment-aware restore, and production Chromium under Next.js 16.4.5.
The payment domain additionally passed 500 seeded exact-money property trials.
Full populated migration preservation, immutable history, concurrency, actual
crash/unknown-commit, financial UNKNOWN, browser and simulator-oracle boundaries
remain passing. No prior assertion or test deadline was weakened.

The combined restore observed a 1,741.89-ms backup and 26,456.47-ms target
recovery/verification over its larger accumulated fixture. Both original payment
authorization and execution replayed without new effects. The independent scoped
restore also passed; its smaller-fixture observations are recorded in the
operations document. Neither is a hosted recovery objective.

The 1,002-item/16-worker resilience scenario retained zero invariant violations,
duplicate domain effects and unrecovered work. Local restart recovered four
items without duplicate effects. Financial assurance remained FAIL, distinct
from successful technical recovery. Production browser checks recorded zero
browser errors and zero stranded operations transactions. Observed Overview
median was 2,106.30 ms on 1,168 receipts; existing capacity limits remain.

## Changed paths

Authentication changes are in `apps/ops/server/auth*.ts`, `server/read.ts`, its
unit/integration tests, project test registration and AUTH.md. CI changes are in
the two workflows, package scripts and verification-gate documentation. The
monitor/restore paths are linked in the operations document. The accounting
slice owns `libs/payment-domain`, `libs/payment-postgres`, migration 015, the
payment integration suite and additive workspace/boundary configuration. Stripe
changes are confined to the evidence counter, verifier, regression tests and
Phase 14 documentation. Existing Next.js and its lockfile were patched; no new
third-party dependency or infrastructure was introduced.

## Remaining operational boundaries

Hosted CI execution and required GitHub status configuration were not performed.
Monitoring scheduling/notification routing, encrypted remote backups, PITR and
hosted recovery need a chosen target and separately reviewed external changes.
The restore drill proves local logical-snapshot recovery, not a production RPO
or RTO. No always-on/cloud capacity claim is made.

Actual additional Stripe refund/dispute/payout lifecycle verification was not
performed: the current command environment has no sandbox credentials/account.
The missing-credential probe returned BLOCKED with exit 2. Existing private
database configuration was not loaded to manufacture test evidence. Real bank
evidence, production accounting policy, payment initiation, partial allocation,
web mutations and AI remain deferred.
