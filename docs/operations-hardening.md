# Operational monitoring and local restore proof

This increment adds a read-only operational attention report and an executable
logical-restore drill. It does not deploy monitoring, create alerts in an external
service, schedule a checker, change database roles/schema, or establish hosted
recovery objectives. Existing immutable-history, financial-proof, worker-fencing
and PASS/FAIL/UNKNOWN semantics remain unchanged.

## Read-only operational monitor

Use the existing non-owner login with only `flow_operations_reader`, supplied in
`DATABASE_OPERATIONS_URL` outside source:

```sh
pnpm operational:monitor <book-id> [explicit-control-evaluation-id]
```

The command calls the existing approved operations read adapter and never uses
web-session credentials, a writer, the migration login, raw payloads, or oracle
data. The adapter enforces its existing capability checks, read-only repeatable
read transactions, bounded pool and database/driver deadlines. The monitor uses
one current Overview and three oldest-outstanding work projections with `limit=1`.
No new SQL routine, grant, dependency, queue or cache is introduced.

The output separates:

- **Operational state:** structural integrity, pending/processing/retryable,
  retained terminal failures, expired recoverable leases and successful-work
  counts from the authoritative read result.
- **Outstanding-work age:** database observation time minus the oldest creation
  time in each outstanding state. The default attention threshold is five
  minutes. This measures end-to-end outstanding age, including scheduled retry
  delay; it does not claim a handler is dead or override lease/retry eligibility.
- **Control currentness:** the explicitly selected evaluation's existing
  `current`/`currentReason`. Missing selection or noncurrent evaluation stays
  UNKNOWN. There is no automatic selection by timestamp or list order.
- **Financial assurance:** the existing current integrity sweep's supplied
  PASS/FAIL/UNKNOWN, unchanged. Healthy processing cannot promote UNKNOWN or a
  failed financial control. Financial FAIL produces a separate attention alert.

Each observation retains its own database `asOf`. Reads may observe intervening
commits; the report does not present them as one shared snapshot. Full-book worker
aggregate counts come from the existing approved query, not from its first page.
A missing grouped state is zero only when that aggregate is present (SQL NULL
means its complete population is empty). Missing counts, wrong selected evaluation
identity or read failure abort the report, never create a healthy empty result.

Exit 0 means no observed operational issue, current selected controls and supplied
financial PASS. Exit 2 means known operational or financial attention is required;
exit 3 means incomplete/UNKNOWN attention; exit 1 means invalid/unavailable
observation. The JSON still presents operational and financial states separately.
Alert codes form a fixed bounded vocabulary and the report includes no monetary
aggregation, raw payload, session cookie, credential, or uncontrolled metric label.

The successful-work counter and dated observations permit a separately configured
collector to detect progress over time. This one-shot command does not claim a
durable worker heartbeat, scheduled coverage, notification delivery or automatic
remediation. No monitor transport can establish financial completeness. Terminal
history remains visible; this increment supplies no reset, requeue or acknowledgement.

## Independent logical-restore drill

```sh
pnpm test:integration tests/operations-recovery.integration.test.ts
```

The existing runner creates its randomly named disposable PostgreSQL 18 source,
performs every populated migration-preservation gate, and provisions the existing
narrow test logins. The new test validates the source container name, loopback
port mapping and fixed test database/login before writing any fixture. It accepts
no operator-selected restore target and never stops or resets the source.

The drill creates synthetic processor/bank evidence, a completed reconciliation
and frozen controls, an exact journal above JavaScript's safe integer limit, and
a seeded Operator with a real password session and an explicit book grant. It
also independently provisions separate scoped payment authorizer/executor test
logins, an approved asset-receivable/liability-payable policy, and an executed
synthetic capture. It does not depend on another test file running first. It
then performs actual `pg_dumpall --globals-only --no-role-passwords` and custom
`pg_dump` acquisition. Archives reside only in a private 0700 temporary directory
with 0600 files and are deleted in `finally`; role passwords and archive contents
are never printed. Auth password hashes/session tokens in the database archive
remain sensitive even though this fixture is synthetic.

A separately initialized, randomly named disposable target restores the roles
and custom archive with fail-on-error behavior. PostgreSQL 18 retains membership
grantor identities: the target uses the same logical bootstrap superuser name.
The test asserts and omits only that one exact duplicate `CREATE ROLE` line,
retaining every ALTER, membership, grantor and permission. It uses `psql -X` and
does not suppress restore errors. This follows the documented bootstrap-role
collision boundary in [PostgreSQL 18 pg_dumpall](https://www.postgresql.org/docs/18/app-pg-dumpall.html).

Acceptance compares all domain/auth/migration table counts and complete row
fingerprints, roles, membership grantors/options, effective table privileges,
function definitions/owners/SECURITY DEFINER flags and ACLs. PostgreSQL may
canonicalize an explicit default owner-only ACL to NULL during dump/restore;
comparison uses PostgreSQL's `acldefault` for this representation, retaining the
same privileges rather than ignoring permissions. Raw financial and auth rows
never enter the report.

The restored narrow reader/integrity/auth logins must retain their financial and
grant-write denials. The stored session must recover the same principal and
allowed book without acquiring another grant. Restored journal/audit/outbox
mutation guards must reject edits even by the disposable administrator. Replaying
the original journal command must return its original identity and add no row.
The restored payment authorizer/executor must replay the same authorization and
execution receipt/journal, retain their separate capabilities, reject a direct
authorization edit and preserve immutable payment history. The table/function
fingerprints include the complete `payments` schema; role comparisons include
the `flow_` and payment-suite `pay_` principals and their original grantors.
Pending normalization then drains through the ordinary worker while preserving
prior financial history, and the independent integrity sweep runs again.

A book committed after backup acquisition is deliberately absent in the target.
This demonstrates the logical snapshot cutoff, not zero data loss. Reported backup
and recovery-plus-verification durations are local observations over synthetic
data; they are not RPO/RTO promises. No retention schedule, encrypted remote backup,
WAL/PITR, lost-host/storage recovery, key recovery, cloud failover, host replacement,
or production capacity is proven. Do not copy disposable trust authentication or
test credentials into deployment configuration.

## Review and verification

The first real restore attempt exposed PostgreSQL's retained grantor boundary;
the second exposed explicit-versus-implicit default ACL representation. Both were
corrected in the restore fixture without stripping grants, changing production
roles or weakening financial/permission assertions. A stronger negative balance
probe initially expected the immutability code P1003; execution and migration 001
established its existing deferred-balance code P1004, now asserted exactly.

Executed locally on 2026-11-21:

| Command                                                                   | Result                                                                                                                                    |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec tsx --test tests/operational-monitor.test.ts`                  | PASS, five named cases; financial FAIL/UNKNOWN, selected evaluation identity, missing counts, invalid/future timing and unavailable reads |
| `pnpm test:integration tests/operations-recovery.integration.test.ts`     | PASS, two cases against real PostgreSQL 18.6, including the actual CLI process; all populated migration preservation/hash gates retained  |
| `node node_modules/typescript/lib/tsc.js -p tsconfig.check.json --noEmit` | PASS, repository TypeScript sources including the new tools/tests                                                                         |
| Scoped `pnpm exec eslint ... --max-warnings 0`                            | PASS for both new tools and both test files                                                                                               |
| Scoped `pnpm exec prettier --check ...` and `git diff --check`            | PASS                                                                                                                                      |

The final scoped restore, rerun after migration 015, retained 82 table fingerprints and all compared
role/membership/function/permission evidence, restored the active Operator
session/book grant, rejected immutable mutations and an unbalanced raw SQL
posting, replayed one original exact journal and one independently authorized
synthetic capture without another effect, and drained the restored fixture's work.
Backup acquisition measured 295.20 ms and independent
target readiness/restore/verification measured 7,438.69 ms. These single local
samples are not capacity or recovery promises. The deliberately later source
marker was absent as expected.

The combined repository gate is recorded separately by the integrating task.
Hosted backups, scheduled monitoring, alert delivery, real host/storage failure,
PITR and production recovery remain NOT RUN.
