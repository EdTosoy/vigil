# Sydney D3B — runtime plan readiness and blockers

2026-10-27. Baseline `bb45a24`, initially clean tree. **NO-GO for provisioning: no executable runtime plan was generated.** Images are verified; private inputs, runtime backend/locking and activation gates remain unresolved. Only this report is added. No cloud mutation, secret storage, state migration, commit or push.

## Verified target and immutable inputs

Existing strict STS guards passed for explicit `edtosoy`, account `747240980964`, `ap-southeast-2`, exact assumed role `AccountFullAccessRole`, valid rotating-session ARN structure and no inherited credential conflicts. Session identifiers are omitted. After STS, ECR BatchGetImage reverified all three exact digests and manifest SHA/config bindings against D3A receipts: PASS, linux/amd64, image source commit `c4ff82ae980b6442bb74c6cc5027d1d8c3a5e402`.

Use these exact Terraform `images` values:

```text
admin = 747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/admin@sha256:2c5730a3d9490c18bfe611fd38671140f9f18319f512e193f63ebb8a30dfe223
ops   = 747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/ops@sha256:06856e82365e186db47f2ed1c8906fca97e59194031d767eefad34e01e929ca9
stripe = 747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/stripe@sha256:0c53fce38d2dad143ef243516b0a337ccf127d6ba59003902bbabd01108a2c8a
```

`admin` supplies one-shot provisioning/migration and verification; `ops` is the read-only Next.js dashboard; `stripe` supplies distinct ingress and durable worker commands. No image was rebuilt or republished. Sandbox account: `acct_1UOVU2AoTLlql5uC`; hostname: `vigil.edtosoy.com`.

## Exact blockers and state safety

1. **Private inputs:** metadata-only checks found no target-scoped `demo.tfvars.json`, `demo-secrets.json`, `environment.env` or dedicated runtime-plan input files. Required `var.secrets` keys are `admin_password`, `provisioning`, `stripe_key`, `webhook_secrets`, `demo_username`, `demo_password`, `operations_password`, `ingress_password`, `stripeworker_password`. No secure in-memory supply is established. Do not fabricate values or reuse historical credentials. The disabled legacy `prepare` writes plaintext local secret JSON and performs a Stripe read, so it was not run under this phase's no-storage/no-Stripe boundary.
2. **Backend/locking:** the S3 backend specifies the approved bucket, `demo/terraform.tfstate`, exact profile/account/region, encryption and `use_lockfile=true`. Backend-disabled init validates configuration; it does **not** convert S3 into a local planning backend. Native locked planning requires writes/deletes of `demo/terraform.tfstate.tflock`; first connection/state-key initialization also needs its exact effects reviewed. These are cloud mutations, not read-only queries. A separately approved, bounded runtime-backend/lock checkpoint is needed; bootstrap migration is unnecessary. No remote init, `-lock=false`, force-copy or unlocking. [Terraform 1.15 S3 backend](https://developer.hashicorp.com/terraform/language/v1.15.x/backend/s3).
3. **Activation and wrapper:** defaults correctly remain `certificate_dns_confirmed=false`, `start_services=false`. HTTPS needs real DNS validation; service startup also needs actual `stripe_source_id` and `ops_book_id` UUIDs from approved capability provisioning. Do not invent IDs or assert DNS confirmation. Runtime plan/apply/provision/destroy/secret commands remain unconditionally disabled; a bounded plan-only path must be implemented before use.

Existing sensitive **ephemeral** inputs flow only to RDS `password_wo` and SSM `value_wo`, keeping values out of plans/state. Real values must be supplied securely in memory for a future plan/apply, never as literals in argv, logs, manifests or Git. No secret was generated, read, stored or printed here. [Terraform 1.15 ephemeral values](https://developer.hashicorp.com/terraform/language/v1.15.x/manage-sensitive-data/ephemeral).

The authoritative bootstrap state and recovery copy retain SHA-256 `83a22793b582723d0849a1840a7236e4dd2c6d1aefdf7a332e4cca32ce956235`, mode 0600. No remote backend init, S3 lock/state write, Terraform migration/apply/destroy or old-state consumption occurred. Offline work used its own private `TF_DATA_DIR` under the new-target `demo/offline/` namespace.

## Complete source inventory and cost envelope

**These are source-expanded fresh-state expectations, not a saved-plan create/update/delete summary or approval.** An actual state-bound summary/hash is unavailable. Existing backend objects/drift cannot be inferred from HCL or mocks. Staged plans must be re-reviewed individually.

| Existing Terraform source  | DNS unconfirmed / confirmed | Complete grouped inventory                                                                                                     |
| -------------------------- | --------------------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| `network.tf`               |                     41 / 41 | 1 VPC, 1 IGW, 4 subnets, 2 route tables, 1 internet route, 4 associations, 7 security groups, 9 ingress rules, 12 egress rules |
| `database.tf`              |                     12 / 12 | 1 private RDS instance, 1 DB subnet group, 1 PostgreSQL parameter group, 9 Standard SecureString parameters                    |
| `compute.tf`               |                     26 / 29 | 1 ECS cluster, 5 task definitions, 10 execution/task IAM roles, 5 scoped execution policies, 5 log groups; 0 / 3 ECS services  |
| `https.tf`                 |                       4 / 8 | 1 ACM certificate, 1 ALB, 2 target groups; 0 / 1 certificate validation, 0 / 2 listeners, 0 / 1 Stripe listener rule           |
| **Source expansion total** |                 **83 / 90** | Services still have desired count 0 until separately setting `start_services=true` after valid bindings                        |

Actual D3B executed create/update/delete: **0 / 0 / 0**. No live Terraform plan exists, so no planned change summary or plan hash is claimed. Existing eleven mocked Terraform tests are safety tests with explicit fixtures, not a deployable substitute.

Names retain `flow-demo` for cluster/ALB/RDS and workload-specific task families/roles/groups; logs and nine Standard SSM parameters use `/flow/demo/`. Actual generated IDs, ALB hostname and ACM records are unavailable until approved creation.

Source/mocked checks retain private encrypted PostgreSQL 18.6 `db.t4g.micro`, Single-AZ, 20 GiB gp3, forced SSL/Sydney CA/`sslmode=verify-full`, disposable backups/snapshots, and three 256-CPU-unit services (ops 1 GiB, ingress/worker 0.5 GiB). Public-IP tasks use IGW HTTPS egress; private DB routes and group-only 5432 ingress remain. Only ALB 80/443 is public; application ingress is ALB-group-only. No NAT, Route 53, budget or bootstrap S3/ECR resource is declared.

IAM trust restricts ECS tasks by exact source account/regional ARN. Execution image/log/SSM reads are workload-scoped; only ECR GetAuthorizationToken uses wildcard Resource. Task roles have no AWS API policy; owner credentials remain admin-only. Rendered IAM/container/unknown values still require real-plan review.

Decimal recomputation uses dated D0 Sydney rates and D2A/D3's conservative assumptions:

| Four-hour gross model                                                  |                       USD |
| ---------------------------------------------------------------------- | ------------------------: |
| Runtime compute, ALB/one LCU, five public IPs and prorated RDS storage |     0.5361632876712328767 |
| Two one-shot task-hours                                                |                   0.04492 |
| Log/transfer allowance                                                 |                      0.50 |
| Monthly retained ECR/state/request envelope                            |                      0.25 |
| **First-session/month planning total**                                 | **1.3310832876712328767** |
| **Headroom below USD 2**                                               | **0.6689167123287671233** |

Keep the conservative USD 0.25 retention allowance despite the smaller initial image footprint. Tax, CPU surplus, traffic, retries and deletion delay may exceed estimates; ALB/RDS bill even with ECS disabled. USD 2 is an attended planning/abort envelope, not a guaranteed bill. Budgets is not a hard cap. The inactive notification recipient remains an accepted risk, not a new blocker. Runtime Free Plan admission is unproven; never upgrade/substitute automatically.

## DNS, TLS, sandbox and operator prerequisites

1. Confirm Cloudflare access. A **separately approved** Sydney ACM request for `vigil.edtosoy.com` must produce actual `acm_validation_records`. Publish each exact name/type/value as DNS-only CNAMEs, verify public DNS and ACM ISSUED, and retain renewal records. No certificate exists from this phase, so token values cannot be supplied. Complete this gate before the short billable runtime window where practical; never bypass it or create a Route 53 zone.
2. After approved ALB creation: Cloudflare **Name `vigil`, Type CNAME, Target actual `alb_dns_name`, TTL Auto, proxy DNS-only**. Preserve `flow.edtosoy.com`. Verify HTTPS hostname/chain and redirect without `-k`; probe `/health/live` and `/health/ready`.
3. Confirm sandbox `acct_1UOVU2AoTLlql5uC` manually. Deliver its test-mode API key and dedicated endpoint signing secret through the future secure mechanism. Endpoint: **`https://vigil.edtosoy.com/webhooks/stripe`**. Register only during later approved HTTPS/ingress setup. Rotation uses a comma-separated secret list; `pending-hosted-destination` is not a working secret. No Stripe operation occurred here.
4. Future secure preparation must create fresh narrow DB/provisioning and operator Basic-auth credentials (strong password, at least 32 characters), plus approved source/book bindings. Verify authorized dashboard/metrics success, unauthenticated 401 and missing-configuration 503. Technical readiness is not financial assurance.

## Shortest safe deployment and teardown sequence

Resolve input/backend/certificate gates, generate the actual guarded saved plan, review all actions/security/costs, then obtain **separate runtime provisioning approval and cleanup authority**. No runnable runtime plan/apply command is enabled today.

At **T0**, immediately before first runtime apply, refresh browser login if needed and pass STS. Attend through cleanup; STS success does not prove four hours of remaining session lifetime.

1. Execute only the approved saved plan. On Free Plan denial or partial apply, stop and retain state; no upgrade or automatic retry.
2. Run approved admin one-shot migrations/provisioning, verify owner-free capabilities/source/book bindings, then separately review service-enable changes.
3. Verify HTTPS, health and authorization. Test signed sandbox receipt, durable worker processing, replay/deduplication and supported capture/fee evidence; run owner-free financial/reconciliation/control proof. Bank evidence stays synthetic; UNKNOWN stays visible. Capture sanitized evidence.
4. **Start teardown by T+3h; complete by T+4h.** Retire only the dedicated sandbox destination, review a fresh runtime-only deletion plan and execute under approved cleanup authority. Stopping ECS alone leaves RDS/ALB charges.
5. Verify empty runtime state and actual removal of ECS tasks/services/definitions/cluster, RDS/backups, ALB/targets/listeners, runtime IAM/log/SSM/network resources, snapshots and allocated IPs. Remove only this run's app DNS/webhook configuration; retain bootstrap S3/ECR/state and unrelated resources.

Existing CLI intents below **remain disabled**, were not run, and need safe Sydney wiring/review before future use:

```sh
# Safe now: existing identity-only preflight.
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo preflight
# Future approved workflow intents; currently blocked by unconditional gates.
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo plan
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo apply --reviewed
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo provision
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo enable
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo proof
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo retire-destination
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo destroy-plan
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:observe destroy-verify
```

On expired credentials or partial failure: retain state/evidence, manually `aws login --profile edtosoy`, reverify identity, inspect actual inventory and review a specific recovery/deletion plan. Never discard/reseed/migrate state, force-unlock, blindly rerun migrations or auto-destroy. Escalate cleanup before the deadline; delayed deletion continues charging. Never rewind posted financial history.

## Verification and recommendation

| Check                                                                  | Result                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Guarded STS and three exact ECR digest/config checks                   | PASS                                                                                                                                     |
| `pnpm aws:validate:offline demo` with explicit target selectors        | PASS: fmt, backend-disabled init, validation, 11 mocked plan-only Terraform tests                                                        |
| `pnpm test:deployment`                                                 | PASS: 36 tests including plan/resource allowlists, historical inputs, unsafe networking/secrets/images, isolation and disabled mutations |
| `pnpm exec tsc -p tsconfig.check.json --noEmit`                        | PASS                                                                                                                                     |
| `pnpm lint`                                                            | FAIL: retained gitignored D3A source archive exposes a second ESLint config; 344 parser errors before any D3B edit                       |
| Same ESLint rules with only `.deployment/**` excluded; oracle boundary | PASS; 24 packages. No config/cache/artifact cleanup                                                                                      |
| Formatting / `git diff --check`                                        | PASS                                                                                                                                     |

Full workspace typecheck was not rerun; D3A recorded the generated Next.js duplicate-declaration failure. No application/source changes or unrelated cleanup were made.

D3B made **five read-only AWS CLI invocations**: STS GetCallerIdentity twice (initial command and collection guard), ECR BatchGetImage three times. All passed. No other account API or historical-account request. No AWS mutations, Terraform apply/destroy/remote init, S3 lock write, ECR push, Stripe/DNS/certificate action or secret storage. The only Terraform executions were the existing backend-disabled isolated validation and provider-mocked tests. Secret-like test fixtures stayed test-only and were not presented as deployment inputs/plans.

Private sanitized evidence: `/tmp/vigil-d3b-readiness.json` (identity/image proof, input-file presence metadata and state hashes), `/tmp/vigil-d3b-source-inventory.json`, `/tmp/vigil-d3b-cost.json`; offline Terraform evidence under `demo/offline/39aa5fb8-1910-430d-926d-a3916289f9bb/` in the new account namespace. No existing state/recovery artifact was modified.

**CONDITIONAL GO to complete plan preparation; NO-GO for runtime provisioning.** Next: establish approved in-memory private inputs and narrowly scoped backend/native-lock authorization, complete certificate prerequisites and a bounded plan-only/teardown workflow, then generate/review the real saved plan. Published image verification is complete. Stop after D3B; no commit/push.
