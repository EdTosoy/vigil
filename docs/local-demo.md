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

Sign in and open **Overview → Synthetic investigation guide**. The guide links
to the exact records for seed 71201. Open Overview again to continue the tour.

| Scenario                  | Evidence to review and expected result                                                                                                                                                                                                                                  | Investigator follow-up                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful reconciliation | Open the matched pair. Compare mapped accounts, reference, signed amount, currency and booking window in **Frozen rule proof and exact comparisons**. The run has 11 historical matched groups. The linked 1:1 allocation is CURRENT and its frozen difference is zero. | Use the pair proof for that settlement. Check source closure separately before drawing conclusions about the period.                           |
| Missing bank evidence     | Open the exception and follow its linked run. The processor outcome is UNMATCHED, with a MISSING_BANK_MOVEMENT case. ACCEPTED_RISK records the operational disposition. Financial status remains UNRECONCILED.                                                          | Use the frozen settlement reference, amount and date to request the corresponding booked bank evidence.                                        |
| Duplicate delivery        | Expand **Compare delivery IDs and receipt times**. Setup receives and normalizes a distinct repeat batch and reruns processor derivation. Source fact, revision, activity and journal counts remain unchanged, with zero journals.                                      | Compare batch receipt times and distinguish physical deliveries from economic identities. Additional receipts leave period closure unresolved. |
| Evidence revision         | Expand **Compare bank revision IDs**, then open the linked allocation. A second receipt changes one bank entry by one minor unit. Review is required. The original amount and MATCHED outcome remain frozen. Current applicability is NOT CURRENT.                      | Obtain evidence that can establish which version is authoritative before relying on a subsequent reconciliation.                               |
| UNKNOWN coverage          | Open the original batch’s frozen coverage control. Received rows have no independent expected count or sequence range. The frozen result is UNKNOWN and the evaluation is STALE.                                                                                        | Seek independent count, sequence or period-closure evidence and evaluate fresh inputs before claiming completeness.                            |

For screenshots, capture the Overview guide, a current exact allocation with
its comparisons expanded, the exception’s operational and financial states side
by side, the revised allocation’s MATCHED and NOT CURRENT statuses, and the
coverage control’s UNKNOWN and STALE indicators. Capture at least one view at a
narrow width to show the guide and evidence stack. Keep sign-in details out of
screenshots.

```sh
pnpm demo:local --smoke
```

Setup checks PostgreSQL before announcing readiness. Smoke mode additionally
launches real Chromium, checks the anonymous redirect, signs in, follows all five
guide scenarios, and visits the six operations sections. It checks the guide at
1280px and 320px, including keyboard activation, and rejects page errors. It
then stops the app and its owned database and removes its private temporary
files. A successful run prints scenario, journey, browser and cleanup PASS
evidence and exits zero. Ordinary mode stays running until Ctrl-C or SIGTERM.

Cleanup checks the container ownership label before stopping it. It does not
remove other containers, databases or Docker volumes. SIGKILL, host failure or a
Docker outage can prevent cleanup; inspect only the printed `vigil-local-demo-`
container identity before manually stopping that owned fixture. Missing image,
Docker access, production build or browser is a prerequisite failure, not a
passing smoke test.

In the investigation acceptance run, a clean source copy passed a frozen
install, production build and Chromium smoke. PostgreSQL preserved 11 frozen
matches, with 10 current allocations and one invalidated allocation. The 24
repeat receipts reused their original revisions, leaving 36 source facts, 36
revisions, 24 processor activities and zero journals. The missing-bank case
remained unreconciled, and the stale coverage control retained its frozen UNKNOWN
result. Cleanup confirmed removal of the owned container and temporary files.

## Evidence boundaries

- This walkthrough uses local synthetic processor and booked bank fixtures. The
  guide is supplied only to the isolated local application by the demo runner.
  It records what setup verified. Linked records use the authenticated
  operations reads and show frozen evidence and current applicability.
- The recorded Stripe sandbox exercise verified a signed test capture and fee
  through ingress, durable processing and processor interpretation. Those
  records are separate from this seed. See [Stripe sandbox verification](phase14/verification.md#actual-stripe-sandbox-continuation).
- Real-bank ingestion, independent real-bank period closure and production
  accounting capabilities are unverified by this demo. The dashboard offers
  read-only investigation. Evidence requests and review decisions are
  investigator follow-ups outside the UI.

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
