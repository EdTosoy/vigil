# Sydney D2B — guarded bootstrap plan preparation

Date: 2026-10-27. Baseline: `96d801a` (D2A), initially clean working tree. **Plan preparation only. CONDITIONAL GO for a separately approved bootstrap provisioning increment; NO-GO for provisioning under this prompt.** Runtime remains separately gated. No commit or push.

## Target and live evidence

The existing D1A preflight succeeded before other account-specific queries. Every planner attempt repeated it initially and immediately before planning: explicit `edtosoy`, account exactly `747240980964`, workload region `ap-southeast-2`, full STS assumed-role ARN structure with role exactly `AccountFullAccessRole`. Session suffixes were validated but neither printed nor recorded. Credential/profile/region/endpoint/Terraform conflicts remain rejected. Browser credentials were already usable; no login, alternate credentials or IAM user was created.

The final planner rechecked `freetier:GetAccountPlanState`: **FREE / ACTIVE**, **USD 120** remaining credits and expiry **2027-04-26T13:49:39.175Z**, also recorded in the private evidence below. This is current account-plan evidence, not permission to create S3/ECR resources. Only global Free Tier and Budgets control-plane reads used `us-east-1`, with the new profile/account. No historical-account request was made.

`HeadBucket` with the exact new bucket and expected owner returned 404; it is an absence observation, not proof of ownership or a reservation of the globally unique name. Bounded ECR inventory found no planned-name collision; registry scanning was BASIC. Existing gross budget `mdp-monthly-gross-usd-5` was read, never managed: COST, MONTHLY, USD 5, credits/refunds excluded, tax included, no cost filters or alternative billing view. D2A's operator-confirmed notification delivery remains manual evidence; the omitted notification threshold units still need console confirmation.

## Implemented plan-only method

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:bootstrap:plan
```

This new command accepts no arguments, alternative target, variable/backend/state file, or provisioning subcommand. General deployment, demo and observer executors remain disabled at their existing entry and execution gates.

The command copies only allowlisted Terraform source, lockfile and mock tests into a newly and exclusively created `.deployment/747240980964/ap-southeast-2/bootstrap/plans/<UUID>/work`. Each run has its own private `terraform-data` directory and fixed local CLI configuration. It refuses symlinks/shared files/traversal, changed source manifests, old plans/receipts, any work-root state/backend/lock file, cached backend metadata, and a non-default workspace. The exact `seed-backend.json` contract must say implicit-local, expected state absent, migration forbidden and the approved target. Missing/foreign contracts fail closed.

It executes only:

1. `terraform fmt -check -recursive`.
2. `terraform init -backend=false -input=false -lockfile=readonly` in that fresh source-only root.
3. `terraform validate -no-color`.
4. Fresh STS verification and a maximum-15-minute gross-budget observation check.
5. `terraform plan -input=false -no-color -lock-timeout=30s -var-file=<private-observation> -out=<private-plan>`.
6. `terraform show -json <private-plan>` and exact proposal inspection.

This is an **implicit local backend**, not an S3 backend with its initialization bypassed. No seed state exists before or after planning. Planning reads the existing budget; it creates no bucket, repository or remote state. Locking remains enabled. No migration, force-copy, force-unlock or `-lock=false` was used. See the [local backend contract](https://developer.hashicorp.com/terraform/language/backend/local) and [saved-plan behavior](https://developer.hashicorp.com/terraform/cli/commands/plan).

The provider is pinned to AWS 6.68.0, with exact `profile`, `region`, and `allowed_account_ids` bound to validated target variables. The inspector also checks these expressions and exact inputs, ownership tags, policies, create-only actions, absent prior managed state, output sensitivity, and the complete twelve-resource allowlist. A completed budget read may be in Terraform 1.15's prior-state snapshot; that data observation is allowed, existing managed state is refused.

Binary/JSON plans, logs, inputs and receipts stay gitignored under the new namespace, private to the operator (directories 0700, evidence files 0600). The receipt binds the binary checksum, copied-source manifest, plan variables, prior-state snapshot, exact target and implicit-local contract; `provisioningAuthorized` is false. It cannot be used as approval or through the existing remote-plan executor. No original historical state/backend/cache was copied or read.

### Pinned-provider budget defect found and repaired

The first actual plan failed closed: provider 6.68.0 returned null `time_unit` and `cost_types`, despite a correct existing budget. The pinned [official data-source implementation](https://github.com/hashicorp/terraform-provider-aws/blob/v6.68.0/internal/service/budgets/budget_data_source.go) declares these computed fields but does not populate them in its read function. D1B mocks populated them and did not expose this limitation.

The narrow repair requires a fresh, sanitized CLI `DescribeBudget` observation, validates all gross/monthly/account-wide conditions, freezes it as a required Terraform variable, and binds it to the receipt. Terraform validates its complete shape and exact financial guard values; the provider postcondition independently checks the fields it actually supplies (account/name/type/USD amount/alternative billing view). A missing, stale, credit-netted, filtered or foreign observation is refused. No budget resource, provider upgrade, new dependency, notification address or secret was introduced.

The next attempt produced the correct plan but the new inspector initially refused Terraform's actual JSON layout (unchanged data in `prior_state`, output flags in `after_sensitive`). Local `terraform show` inspection, without AWS calls, established both shapes. Tests now model them; security requirements were retained. A final fresh run verifies the complete path. Failed runs remain private and are never reused as seed workspaces.

## Exact resource proposal

All rows are Sydney account `747240980964`, region `ap-southeast-2`, persistent foundations that **survive runtime teardown**. There are **12 managed creates, 0 updates, 0 deletes**, plus one read-only existing-budget data source. No historical resource ARN, account or bucket occurs in the proposed managed values. The existing `flow-demo` AWS naming prefix is intentionally retained for compatibility with D1B sources; ECR names are isolated by account and region, not globally shared with the historical registry.

| Terraform resource                                         | Proposed AWS name / attachment                  | Purpose and security                                                                               | Expected ongoing cost                    |
| ---------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `aws_s3_bucket.state`                                      | `flow-demo-tfstate-747240980964-ap-southeast-2` | Separate state store; no forced deletion, prevent-destroy                                          | Usage-based storage/requests             |
| `aws_s3_bucket_ownership_controls.state`                   | Same bucket                                     | BucketOwnerEnforced; disable ACL ownership ambiguity                                               | No separate configured service           |
| `aws_s3_bucket_public_access_block.state`                  | Same bucket                                     | All four public-block switches true                                                                | No separate configured service           |
| `aws_s3_bucket_versioning.state`                           | Same bucket                                     | Retain state history for recovery                                                                  | Retained versions add storage            |
| `aws_s3_bucket_server_side_encryption_configuration.state` | Same bucket                                     | AES256/SSE-S3; no KMS key                                                                          | Included configuration; storage as above |
| `aws_s3_bucket_policy.state`                               | Same bucket                                     | Explicit deny of every S3 action over insecure transport                                           | No separate configured service           |
| `aws_ecr_repository.image["admin"]`                        | `flow-demo/admin`                               | One-shot admin image, AES256, immutable tags, BASIC scan-on-push, no force-delete, prevent-destroy | Stored image bytes/transfer              |
| `aws_ecr_repository.image["ops"]`                          | `flow-demo/ops`                                 | Operations image, same repository security                                                         | Stored image bytes/transfer              |
| `aws_ecr_repository.image["stripe"]`                       | `flow-demo/stripe`                              | Shared sandbox ingress/worker image, same repository security                                      | Stored image bytes/transfer              |
| `aws_ecr_lifecycle_policy.image["admin"]`                  | `flow-demo/admin`                               | Expire only untagged remnants after seven days                                                     | No separate configured service           |
| `aws_ecr_lifecycle_policy.image["ops"]`                    | `flow-demo/ops`                                 | Same conservative expiry; retain tagged recovery images                                            | No separate configured service           |
| `aws_ecr_lifecycle_policy.image["stripe"]`                 | `flow-demo/stripe`                              | Same conservative expiry                                                                           | No separate configured service           |

No new AWS Budget, Route 53 zone/record, IAM resource, ACM certificate, log group, ECS/Fargate resource, RDS database, ALB, NAT gateway, application secret or permanent compute is proposed. ECR scanning is BASIC, not enhanced scanning. Images are neither built nor published in this increment. The plan contains only the declared non-secret budget, bucket and repository outputs; unknown bucket ARN/repository URLs are expected before creation. No credentials, database password, Stripe secret or plaintext runtime configuration is an input.

## State lifecycle and security gates

The future first creation must use a separately reviewed fresh local seed process. This D2B plan is evidence, not authorization to run it later unchanged. Revalidate source/input hashes, STS, budget, name conflicts and absent state; obtain explicit billable-provisioning approval before implementing or using an apply path. First successful creation would establish local state in that exact private work root; preserve and back it up securely before any later action.

Only after actual bucket ownership/security verification and review of the resulting seed lineage may an operator approve a separate remote-state transition. Do not silently copy/migrate state or seed a second lineage. Existing D1A S3 contracts require account-specific bucket, `allowed_account_ids=["747240980964"]`, Sydney region, encryption and native `use_lockfile=true`, with distinct `bootstrap/terraform.tfstate` and `demo/terraform.tfstate` keys. No remote init, lock object or state object exists as a result of D2B. No new IAM policy is needed for plan preparation; least-privilege workload/runtime roles remain a later review.

On a future partial creation failure, stop, retain the exact local state/receipts/logs and inspect actual target-account inventory. Treat interrupted writes as uncertain until verified. Do not discard state, rerun in another fresh seed, import automatically, force-copy/unlock, or broadly delete resources. Propose a specific recovery or cleanup plan with separate authorization; persistent bucket/repository prevent-destroy and retained images/versions must be considered. Never clean up an unfamiliar or historical resource. Routine runtime teardown must not delete bootstrap foundations.

## Costs and Free Plan uncertainty

Use D0's dated Sydney estimate, not a guaranteed quote. Decimal recalculation removes the unused USD 0.50 Route 53 hosted-zone assumption:

- Retained image planning envelope: 2 billing GB × USD 0.10/GB-month = **USD 0.20/month**.
- State/version storage plus request allowance: **USD 0.05/month**; an allowance, not an enforced cap.
- Persistent planning baseline after teardown: **USD 0.25/month**, leaving **USD 4.75** of the USD 5 gross account budget before other usage/tax.
- No optional IAM resource, paid logging service, customer KMS key, enhanced scan or hosted zone is proposed. Empty repositories hold no images initially; creating them does not reserve 2 GB. Initial normal low-volume bucket/repository setup has no planned fixed capacity charge, but API/storage usage, taxes and applicable transfer can be nonzero.
- Tagged images and versioned state accumulate; the seven-day untagged lifecycle is not a total-byte cap. Review actual retained bytes regularly before later publication. No automated cleanup or billing enforcement was enabled.

These are low-volume gross-cost assumptions, excluding credits as a spending offset. Refer to [ECR pricing](https://aws.amazon.com/ecr/pricing/) and [S3 pricing](https://aws.amazon.com/s3/pricing/), with dated rate/allowance inputs in `sydney-cost-estimate.json`. AWS budgets alert after reporting delays and do not impose a hard spending limit. Credits may not cover taxes or every charge; do not assume universal credit eligibility or service availability. A successful plan/read is not creation-permission proof. Actual S3/ECR admission under Free Plan restrictions, global bucket-name allocation, API/security behavior, native S3 locking, image scanning/publication and subsequent costs remain unproven until a separately approved step. Never upgrade to bypass a rejection.

The proposed first runtime limit remains **four hours including provisioning/teardown and USD 2 gross**, independently subject to approval. D0's first-session-month estimate with the hosted-zone assumption removed is approximately **USD 1.30** under its existing traffic/log/one-shot assumptions; unexpected traffic, tax and delay can exceed it. No runtime plan, schedule or resources were prepared here.

## Validation and negative verification

| Check                                                                               | Result / scope                                                                                                                                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:deployment`                                                              | PASS, 29 tests, including four new grouped D2B tests and all relevant existing guard/portability/access tests                                                                          |
| `AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:validate:offline bootstrap` | PASS: formatting, backend-disabled init, configuration validation, seven mocked plan-only Terraform tests; distinct private `TF_DATA_DIR`                                              |
| Final live `pnpm aws:bootstrap:plan` with explicit approved profile/region          | PASS, Terraform 1.15.3 / provider 6.68.0; exact twelve-create proposal inspected, private receipt written                                                                              |
| `pnpm exec tsc -p tsconfig.check.json --noEmit`                                     | PASS after the final planner/inspector changes                                                                                                                                         |
| `pnpm typecheck`                                                                    | FAIL in `@vigil/ops`: duplicate generated Next.js route/layout declarations from `.next/dev/types` and `.next/types`, matching D2A's documented baseline; root TypeScript stage passes |
| `pnpm lint`                                                                         | PASS, native Nx graph / ESLint / 24-package oracle boundary checks                                                                                                                     |
| `pnpm format:check`                                                                 | PASS                                                                                                                                                                                   |
| `git diff --check`                                                                  | PASS                                                                                                                                                                                   |
| Filesystem/evidence inspection                                                      | PASS: no local/cached state after final plan; evidence files 0600, work/data 0700; plan gitignored                                                                                     |

No app, Docker or financial code changed. No Docker rebuild, database/integration test or new clean-context Next.js rebuild was needed; D2A already established that the generated declaration failure disappears in its controlled clean build context. Original caches were not deleted or edited. Initial failed plan/postcondition and inspector attempts are explicitly recorded above and are not reported as successes.

The focused additions reject wrong account/profile/region/role, inherited credentials, missing/foreign local backend contract, existing local state, cached backend/workspace metadata, historical plans/receipts, absent or stale budget evidence, duplicate budget, Route 53/runtime/IAM/NAT additions, updates/deletes, unsafe bucket policy/public settings, mutable images, foreign attachments and sensitive/unexpected outputs. Provisioning subcommands/target/state/backend overrides are rejected before any AWS call; wrong identity stops before Terraform. Existing D1A tests also cover malformed/expired credentials, symlinks/hardlinks/traversal, stale/tampered foreign receipts and blocked mutating CLI/executor paths. All rejection tests use deterministic mocks or local fixtures, never the historical account.

## Private approval evidence

Final run: `8e671f20-5cbc-4c16-bcb4-c6c977e8f765`; receipt time **2026-10-27T09:53:21.809Z**. The initial preflight and failed attempts preceded it (approximately 09:32–09:53 UTC overall).

All paths are relative to `.deployment/747240980964/ap-southeast-2/bootstrap/plans/8e671f20-5cbc-4c16-bcb4-c6c977e8f765/`:

- `bootstrap.tfplan`: binary SHA-256 `a4090bcca4ca16450c1bbbbf08c1f17e8f5f1f1a7449bc14b0cfb5418fd8876f`.
- `review.json`: sanitized exact inventory; `plan.json`: private provider/plan details.
- `plan-receipt.json`: target, plan checksum, source/input/prior-state hashes and explicit lack of provisioning authorization.
- `seed-backend.json`, `source-manifest.json`, `bootstrap-inputs.tfvars.json`: local-state contract, source hashes and frozen sanitized gross-budget evidence.
- `read-calls.json`, `free-plan.json`, `fmt.log`, `init.log`, `validate.log`, `plan.log`: execution evidence.

Offline mock-test evidence is under `bootstrap/offline/734002d0-edcf-492f-998b-b6dca93a47ca/` in the same account/region namespace. Two failed live-plan contexts remain separate (`46a0abbf-929a-42f6-a2e5-230f18abaffe`, `0944a34d-bb00-44b9-b2c4-90c353b383a5`); neither is an executable approval artifact. No remote/local Terraform state was produced.

These private artifacts are sensitive and gitignored; do not attach raw plans/logs to a public PR. The committed candidate report is sanitized. Files adapted: `tools/bootstrap-plan.ts`, `tools/plan-bootstrap.ts`, `tools/deployment-sources.ts`, `tests/bootstrap-plan.test.ts`, `package.json`, `infra/bootstrap/main.tf`, `infra/bootstrap/variables.tf`, `infra/bootstrap/tests/bootstrap.tftest.hcl`, `infra/AGENTS.md` and this report. Only bootstrap source/guards/tests/command registration and this report/durable infra rule changed; financial code, schemas, images, historical artifacts and disabled provisioning gates are untouched.

## Read-only AWS action ledger

There were **21 direct read-only CLI invocations**: one initial D1A STS preflight, then 6, 7 and 7 invocations across three fresh planner attempts. All are bounded logical invocations, not wire request counts.

| AWS API action                         | Endpoint           | Direct CLI invocations | Result / purpose                                                                             | Read-only |
| -------------------------------------- | ------------------ | ---------------------: | -------------------------------------------------------------------------------------------- | --------- |
| `sts:GetCallerIdentity`                | Sydney             |                      7 | All exact target identities accepted, initial and pre-plan checks                            | Yes       |
| `freetier:GetAccountPlanState`         | Global `us-east-1` |                      3 | FREE / ACTIVE account and credit/expiry evidence                                             | Yes       |
| `s3:HeadBucket`                        | Sydney             |                      3 | All 404 for exact new bucket with expected-owner check; fail on existing/inaccessible bucket | Yes       |
| `ecr:DescribeRepositories`             | Sydney             |                      3 | Bounded no planned-name collision check                                                      | Yes       |
| `ecr:GetRegistryScanningConfiguration` | Sydney             |                      3 | New-account BASIC scanning prerequisite                                                      | Yes       |
| `budgets:DescribeBudget`               | Global `us-east-1` |                      2 | Full fresh gross/monthly/account-wide evidence after provider defect discovery               | Yes       |

In addition, all three actual Terraform plan logs show the existing-budget data source read completing. The pinned provider uses `budgets:DescribeBudget` for that read and STS account resolution (`sts:GetCallerIdentity`) for provider account protection; these are additional read-only provider operations. Their individual wire-level call counts were not traced, so they are not silently included in the 21 direct CLI total. Offline mocked tests and subsequent local saved-plan inspection do not add account API calls. No remote S3-state read/write was performed.

Provider authentication refresh internals and wire-level retries were not traced; do not interpret logical invocation counts as a CloudTrail audit. Local `terraform show` debugging and offline mocked tests make no AWS resource calls. Public provider/documentation downloads are not account APIs. All recorded account requests used the new profile/account. No resource-writing operation was invoked.

## Manual approval checklist and outcome

The operator must review and explicitly approve a future **bootstrap-only billable provisioning** step covering:

- [ ] Browser session is manually authenticated as needed, and fresh D1A STS verification matches `edtosoy` / `747240980964` / `ap-southeast-2` / `AccountFullAccessRole` with no inherited conflicts.
- [ ] Exactly the twelve S3/ECR components above, their names/security/retention and no duplicate budget/DNS/runtime resource.
- [ ] Low-volume setup usage and USD 0.25/month persistent planning baseline, gross budget headroom, accumulation/tax/credit risks, and notification threshold units confirmed in the console. Budget email receipt was already attested in D2A.
- [ ] Free Plan S3/ECR creation remains an admission gate; stop on restriction, never upgrade or choose paid substitutes implicitly.
- [ ] Fresh isolated local seed, locked plan/receipt handling and secure retention of eventual local state; remote-state migration requires a separate review/authorization.
- [ ] Broad current operator role is used only for explicitly approved work; no new IAM/public access/secret permissions or runtime credentials in this bootstrap proposal.
- [ ] Partial-failure inventory/recovery procedure and separate cleanup approval; never abandon/reseed state or touch historical resources.
- [ ] Concrete final plan, source/inputs and budget are freshly revalidated before any future apply implementation/execution. A saved D2B receipt alone is insufficient.
- [ ] **Separate explicit approval for bootstrap creation. This prompt does not supply it.**

A later runtime plan/cost review and independent provisioning approval must additionally settle Free Plan service compatibility, RDS/Fargate/ALB quotas, four-hour/USD 2 execution limits, teardown/incident readiness, verified Cloudflare access/manual ACM validation and Stripe sandbox secrets. D2A recorded Cloudflare/Stripe access as not yet verified; none was tested or configured here. No DNS change, webhook registration or secret creation is part of bootstrap approval.

**CONDITIONAL GO for a future, explicitly approved bootstrap execution increment.** The exact new-account persistent proposal is reviewable; Free Plan creation and user approval remain blockers. General apply/destroy/import/state migration/unlock, image publication, secrets, remote migration, demo/observer/Stripe/DNS workflows remain disabled. Zero AWS resource mutations, no remote backend initialization, no historical-account contact, no account upgrade, no financial/schema change, no commit/push. Stop after D2B.
