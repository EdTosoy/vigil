# Codex implementation prompt A — exact deployment target and local isolation

This is the **next implementation prompt**, not an instruction to provision infrastructure during planning. Copy it into the next Codex increment after accepting the deployment plan. Follow **Codex → Verify → Commit → Next Prompt**.

---

Implement Vigil's first focused deployment-preparation increment for the new AWS account. Work only inside the Vigil repository. Do not provision or mutate AWS, DNS, Stripe, financial data or external infrastructure.

Read:

- Root `AGENTS.md`, `infra/AGENTS.md`, relevant architecture/invariant guidance.
- `docs/phase15/README.md`, `verification.md`, `sydney-deployment-plan.md`, `sydney-cost-estimate.json` and ADR-018.
- Existing deployment tools, Terraform roots and deployment/access tests before editing.

Use applicable implementation, AWS and verification skills. Preserve user changes and the existing financial/application architecture. Historical Phase 15 proof describes the old account; keep it intact.

## Authorized target and purpose

The user's explicit new-account instruction authorizes preparing tooling for **only**:

- AWS profile: `edtosoy`.
- AWS account: `747240980964`.
- Workload and state region: `ap-southeast-2`.
- Human deployment identity: the STS assumed role `AccountFullAccessRole` in that exact account, obtained through browser login and temporary credentials.
- Architecture: attended ephemeral reuse of the existing Fargate/private-RDS/HTTPS design; no new always-on topology.

The old target (`iamadmin-general`, `163596511125`, `us-east-1`) is historical, not an additional allowed live deployment target. Update operative guidance narrowly as needed; do not silently bypass guards or broaden them to arbitrary accounts/profiles/regions. Keep the prior historical README/report/ADR factual. Document the target/isolation decision with the next available ADR number if required; do not start Phase 16.

Read-only planning previously confirmed Free Plan ACTIVE, USD 120, expiry `2027-04-26T13:49:39.175Z`, existing gross USD 5 budget `mdp-monthly-gross-usd-5`, PostgreSQL 18.6 / db.t4g.micro / gp3 catalog availability and Fargate quota 30. These are dated observations, not permanent guarantees or deployment authorization.

## Scope A — one coherent security foundation

Implement the exact target context, identity validation and account/region-scoped private deployment workspace. This increment must end safely even if the Terraform resources have not yet been retargeted. Leave actual new-account deployment blocked until subsequent Terraform/TLS/budget/DNS portability is complete.

Primary ownership is `tools/deployment-guards.ts`, the shared context consumed by `tools/deploy.ts`, `tools/demo-deploy.ts` and `tools/demo-observe.ts`, relevant deployment tests and concise operative documentation. Reuse existing code and add only the small abstraction needed to eliminate inconsistent target/path handling.

### 1. Exact caller identity

- Replace the old IAM-user-only deployment assumption with an exact approved-account and approved **assumed-role** check.
- Validate the STS `Account` and full ARN structure, partition/account and exact role name. Accept rotating legitimate session suffixes; do not pin one temporary session ARN, compare by substring or accept an arbitrary non-root principal.
- Reject root, IAM users, other roles, the old account, malformed ARNs, account/ARN disagreement, spoofed role-name prefixes/suffixes and alternate partitions.
- Require the exact selected profile and workload region. Preserve rejection of injected static/session credentials, alternate endpoint settings and Terraform CLI/variable/log overrides. Do not export browser credentials into environment literals or change `~/.aws` configuration.
- Distinguish global control-plane read endpoints (for example Budgets/Free Tier/Pricing) from authorization to deploy regional workloads outside Sydney. Do not add a broad exception that can create resources in `us-east-1`.
- Future apply/destroy/state commands must recheck actual caller identity immediately before work; a cached identity receipt is not sufficient. In this increment, tests use deterministic callers rather than needing real cloud actions.

### 2. Target-scoped workspace and receipts

- Put all new private artifacts beneath `.deployment/747240980964/ap-southeast-2/`: local seed/work state, backend config, `TF_DATA_DIR`, plans/receipts, configuration/secrets, observations and history/reset artifacts.
- Use one validated context everywhere, including error/log paths and cleanup/reset. No command may fall back to the old shared `.deployment` filenames.
- Treat old `.deployment/*`, ignored generated backends and existing `infra/**/.terraform` caches as foreign legacy artifacts. Do not read their secrets, copy/migrate their state, rename/delete them, overwrite receipts or run their cleanup routines.
- Preserve private directory/file permissions and Git ignores. Bind plan receipts to account/region/profile, source/input identity, root and intended backend/workspace. Reject old, mismatched, stale or tampered receipts before mutation.
- Validate path containment; reject traversal, symlink escape and caller-supplied workspace/cache/state overrides. Safe handling may fail closed rather than trying to repair a foreign workspace.
- A new S3 bucket alone is insufficient isolation. Specify an isolated Terraform working/configuration strategy so cached old backend metadata or `backend.generated.tf` cannot reconnect an old state. Until Prompt B implements it, fail closed before invoking an incompatible root.
- Keep bootstrap and disposable runtime contexts distinct. Preserve future protection against bootstrap destruction and unchanged state encryption/versioning/native locking expectations.

### 3. Safe interim behavior and next portability work

Do not merely switch `deployment.account` while leaving scripts able to initialize the old hard-coded backend. Add an explicit compatibility/preparation gate so cloud-mutating and state-changing workflows cannot run with mixed target configuration. The gate should identify that Prompt B is still required, without printing private values.

Do not retarget or apply Terraform resources in this increment. Document the remaining Prompt B work:

- Existing provider/backend/bucket/image/domain constants must be retargeted through explicit validated configuration.
- Observe the existing gross $5 budget read-only; do not create the old $10 budget, duplicate/import the existing budget or access its owner's external repository.
- Replace the old regional RDS CA bundle with an official Sydney/global bundle while preserving verified TLS.
- Require an approved hostname/zone and retain the manual child-NS STOP checkpoint. Current DNS delegation was not verified; do not invent nameservers or assume the old zone can be reused across accounts.
- Verify browser-login support independently for provider and S3 backend using pinned Terraform/provider versions; no static-key workaround.

Do not introduce a cloud watchdog, VM/Lightsail fork, new service, broker, NAT, paid endpoint, Inspector/enhanced scan subscription or new dependency in Prompt A.

## Regression coverage

Use existing test conventions and deterministic fixtures. Include:

1. Correct new account and exact assumed-role identity accepted across different session suffixes.
2. Old account/profile/region, root, IAM user, wrong/spoofed role, malformed/foreign ARN and account mismatch rejected.
3. Credential/endpoint/Terraform override injection rejected; no unvalidated target override.
4. Every command's private artifacts and diagnostics resolve beneath the correct target/root namespace.
5. Old target files/cache/backend metadata cannot be read as new configuration or migrated; absence of a new workspace never causes a legacy fallback.
6. Path traversal/symlink escape, foreign/stale/tampered receipts and cross-root state use rejected.
7. Bootstrap destruction remains forbidden; existing unsafe-plan/public-ingress/database/secret/image cases retain their negative coverage.
8. Mixed new-tooling/old-Terraform configuration fails before any cloud/state command runs.
9. No command uses `~/nixos-setup/infra/mdp/` or imports unrelated project state. Existing account budget is not taken over.
10. Financial, read-only, sandbox and dashboard access boundaries remain unchanged.

Do not add tests that call real write APIs, mock away existing financial gates, or disable old security assertions to make a new identity pass. Retarget identity fixtures only where their meaning changes; keep the old account as an explicit rejection case.

## Verification and completion

Run relevant formatting, lint, typecheck, `pnpm test:deployment`, `pnpm test:boundaries` and `git diff --check`. Inspect the changed command paths and error handling for sensitive values and unguarded cloud execution. Run additional existing tests/builds only where affected. Report exact executed outcomes, omissions and blockers. A direct operations build must not be described as a successful root Nx build.

No Terraform backend initialization, remote state migration, cloud plan/apply/destroy, image push, Stripe API mutation, DNS mutation, AWS account-plan upgrade, new credential issuance or financial persistence change is authorized by this prompt. No commits may contain credentials, plans/state, generated backends or private evidence. No push or deployment.

Once verification passes, create one scoped local commit for the completed foundation, following the requested workflow. If a required check fails or a safety boundary remains unresolved, report the issue and stop before committing. Do not include unrelated user changes. Then provide the bounded **Prompt B** for offline Terraform/TLS/budget/DNS portability, keeping cloud provisioning explicitly out of that next prompt too.

Final report: files changed; exact target/identity rules; private-path/receipt isolation; interim blocked behavior; unchanged financial/application boundaries; tests and command outcomes; commit hash if created; remaining manual prerequisites; next prompt. Do not claim deployment readiness or new-account runtime verification from local tests alone.
