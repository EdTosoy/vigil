# Sydney D3E — restricted backend and saved runtime plan

Next approval package: [Sydney D3F — first infrastructure apply preparation](sydney-d3f.md). It proposes a separate state-write role and guarded fresh-plan/apply path; the D3E binary remains forbidden for apply.

2026-10-28 UTC. **D3E planning PASS: a real S3-backed saved Terraform plan contains 75 creates, zero updates, replacements or deletes. Runtime provisioning remains unauthorized.** Account `747240980964`, profile `edtosoy`, region `ap-southeast-2`; infrastructure source revision `f16de72c337639e38d73b4276ee3f671f0ce77f5`. Planner changes remain uncommitted. No apply/destroy, infrastructure provisioning, state payload write, IAM change, DNS/Stripe operation, ECR publication, Free Plan upgrade, commit or push occurred in this task.

## Saved artifact and immutable inputs

Private, gitignored artifact:

```text
.deployment/747240980964/ap-southeast-2/demo/plan-preparation/
  726aa12d-e639-4970-b9c6-c91dda0f8d18/runtime.tfplan
SHA256: 4a5044f18c3c22b8672a26d4cf3bdbcdba72c49d6193e1a876da107fba1cf186
```

The plan is mode 0600 inside owner-only 0700 directories. `saved-plan-review.json`, `plan-inspection.json`, `aws-evidence.json`, source manifest, fixed backend configuration and sanitized Terraform status receipts accompany it. The complete plan JSON and raw SDK logs were never persisted or printed. The saved-plan hash was independently recomputed during inspection.

Terraform **1.15.3**, AWS provider **6.68.0**. Planned flags are exactly `initial_infrastructure_only=true`, `start_services=false`, `certificate_dns_confirmed=false`, `defer_webhook_secret=true`. Existing secure `admin_password` and configured runtime inputs were reused; no credential was requested, regenerated or copied into preparation. The ephemeral secret was supplied only to the plan child process; the executor verified its plain and URL-encoded forms were absent from the JSON projection. Future financial bindings remain empty.

All three immutable ECR manifests were freshly verified with read-only BatchGetImage and SHA-256 comparison, and the saved task definitions use these exact digests:

| Repository         | Digest                                                                    |
| ------------------ | ------------------------------------------------------------------------- |
| `flow-demo/admin`  | `sha256:2c5730a3d9490c18bfe611fd38671140f9f18319f512e193f63ebb8a30dfe223` |
| `flow-demo/ops`    | `sha256:06856e82365e186db47f2ed1c8906fca97e59194031d767eefad34e01e929ca9` |
| `flow-demo/stripe` | `sha256:0c53fce38d2dad143ef243516b0a337ccf127d6ba59003902bbabd01108a2c8a` |

Registry: `747240980964.dkr.ecr.ap-southeast-2.amazonaws.com`. No image rebuild/publication occurred.

## Backend identity and mutation boundary

`tools/runtime-plan.ts` now pins backend assumption to **`arn:aws:iam::747240980964:role/vigil/VigilSydneyRuntimePlanRole`**, a 15-minute `vigil-d3e-<run>` session, and the exact reviewed lock-only permissions as an additional session restriction. Read-only preflight compares the live role path, duration and complete trust document, exact `VigilSydneyRuntimePlanLockOnly` document, sole inline-policy name and absence of managed policies. The reviewed policy files remain unchanged. No IAM resource is recreated or modified.

Provider configuration remains separate: `infra/demo/versions.tf` uses the original `edtosoy` profile with explicit account/region guards and no planner-role assumption. The caller remains exact `AccountFullAccessRole`; inherited credential, endpoint, profile, region and Terraform overrides are rejected. Actual STS identity is checked before backend initialization and planning.

Backend STS GetCallerIdentity responses observed during **both successful init and plan** identify `VigilSydneyRuntimePlanRole/vigil-d3e-726aa12d-e639-4970-b9c6-c91dda0f8d18` in the expected account. The evidence parser accepts only the backend logger's STS response, rejecting provider-only or administrator-role evidence. Raw debug output remains in process memory; only the expected identity observation is retained. Initialized backend metadata also matches the exact role, session name, duration, policy, bucket, key, encryption and locking contract. Successful backend admission did not fall back to administrator credentials. See [HashiCorp backend assumption configuration](https://developer.hashicorp.com/terraform/language/v1.15.x/backend/s3#assume-role-configuration) and the [pinned backend AWS configuration/client construction](https://github.com/hashicorp/terraform/blob/v1.15.3/internal/backend/remote-state/s3/backend.go).

Before/after object-version inventories establish:

| Operation/state                         | Observed result                                                  |
| --------------------------------------- | ---------------------------------------------------------------- |
| `s3:PutObject`                          | Exactly one new version of `demo/terraform.tfstate.tflock`       |
| `s3:DeleteObject`                       | Exactly one delete marker on that same lock key                  |
| State payload                           | Absent before and after, with no versions/delete markers created |
| Current lock                            | Absent after normal Terraform release                            |
| Other `demo/` object mutations          | None                                                             |
| Bootstrap local state and recovery copy | SHA-256, size and mtime unchanged                                |

These **two lock operations are the only AWS mutations performed in this task**. The unchanged role/session policies allow a successful PutObject only with `If-None-Match: *`; fixed native Terraform planning retains lock-ID ownership checks for release. No manual unlock or unrestricted fallback exists. The default-workspace behavior was checked against [Terraform 1.15.3 source](https://github.com/hashicorp/terraform/blob/v1.15.3/internal/backend/remote-state/s3/backend_state.go): the non-default-workspace empty-state creation path is not used here. Actual initialization succeeded without a state payload write or additional permission.

Bootstrap custody retains SHA-256 `83a22793b582723d0849a1840a7236e4dd2c6d1aefdf7a332e4cca32ce956235`. Direct AWS calls were read-only STS, IAM role/policy reads, S3 owner/location/object/version checks and ECR manifest reads. Expected HeadObject 404 responses establish absence; they are recorded as unsuccessful HTTP responses, not permission denials. The fixed Terraform command set ran version/fmt/init/validate/plan/show only. This is workflow-specific evidence and S3 version comparison, not an account-wide CloudTrail audit of other actors. No unexpected permission denial or IAM propagation delay occurred.

## Exact resource proposal and security review

All **75 managed resource changes** are creates. No update, replacement, delete, prior managed state, ECS service, listener, certificate-validation waiter, NAT gateway, Route 53 resource, budget or bootstrap resource appears in the saved proposal.

| Group      | Creates | Exact inventory                                                                                                                |
| ---------- | ------: | ------------------------------------------------------------------------------------------------------------------------------ |
| Networking |      41 | 1 VPC, 1 IGW, 4 subnets, 2 route tables, 1 internet route, 4 associations, 7 security groups, 9 ingress rules, 12 egress rules |
| Database   |       3 | 1 RDS instance, 1 subnet group, 1 parameter group                                                                              |
| ECS        |       6 | 1 cluster, 5 task definitions; no services/tasks launched                                                                      |
| IAM        |      15 | 5 execution roles, 5 task roles, 5 execution inline policies; proposed only                                                    |
| Logs       |       5 | One group per workload, three-day retention                                                                                    |
| ALB        |       3 | 1 public application load balancer and 2 IP target groups                                                                      |
| ACM        |       1 | DNS-validated certificate request for `vigil.edtosoy.com`                                                                      |
| SSM        |       1 | Standard SecureString `/flow/demo/admin_url`, using a write-only input                                                         |
| **Total**  |  **75** | **0 updates / 0 replacements / 0 deletes**                                                                                     |

Actual saved-plan values and configuration references establish:

- **VPC:** `10.42.0.0/16`, DNS enabled. Public `10.42.0.0/24` and `10.42.1.0/24`; database `10.42.10.0/24` and `10.42.11.0/24`, across `ap-southeast-2a/b`. All four subnets disable automatic public-IP assignment. Only the public route table has `0.0.0.0/0` through the IGW; private database routing has no internet route or NAT.
- **Network boundaries:** public ingress is limited to ALB TCP 80/443. Ops 3000 and ingress 4242 accept only the ALB group. Database TCP 5432 accepts only the five task groups; there is no public task/database CIDR ingress. Tasks have group-scoped database egress and internet HTTPS egress. Later service public-IP assignment remains a separate, gated stage.
- **RDS:** encrypted private PostgreSQL 18.6, `db.t4g.micro`, Single-AZ, 20 GiB gp3; `rds.force_ssl=1`, pending-reboot parameter, CA `rds-ca-rsa2048-g1`. Backup retention zero, no deletion protection and skip-final-snapshot are explicit disposable-demo choices, not HA/DR assurance. Endpoint/IDs remain unknown until separately authorized provisioning.
- **ECS:** Fargate/awsvpc, Linux X86_64, five digest-pinned definitions. Each uses 256 CPU units; ops/admin have 1024 MiB, ingress/worker/verify 512 MiB. Every container runs as `1000:1000`. Four use read-only root filesystems; ops retains its existing writable root filesystem. SSM references and Sydney awslogs are present. Future secret references do not imply those parameters already exist; only admin_url is proposed here.
- **ALB/TLS:** public application ALB; HTTP IP target groups on 3000/4242 with `/health/ready` checks. No listeners or services are created in this stage, so no hosted HTTPS readiness is claimed. ALB IP-address-type is computed in the plan; the cost allowance assumes its normal two-address IPv4 deployment. No ACM validation token or ALB hostname is invented.
- **IAM:** all ten role trust documents are rendered and restrict ECS tasks to the exact account and regional source ARN. The five execution-policy JSON values are **computed/unknown** because log-group ARNs do not yet exist. Their pinned source scopes ECR image reads, workload log streams and named SSM reads; ECR GetAuthorizationToken alone uses Resource `*`. Task roles have no AWS permissions attached in the proposal. Fully materialized execution-policy documents are not claimed as inspected; preserve their source/reference restrictions in any future provisioning review. Existing administrator/planning roles are outside the proposal.

No financial application behavior, invariant or database schema changed.

## Gross runtime cost review

This is an estimate **if the stopped infrastructure is later provisioned**, using the dated **2026-10-26** Sydney gross list-rate evidence in [sydney-cost-estimate.json](sydney-cost-estimate.json); rates were not refreshed or discounted by credits/Free Plan eligibility. Decimal recomputation uses a 730-hour month. No runtime cost was started by this plan; existing storage and API-request charges remain applicable.

| Stopped initial stage                                                                       |    Gross USD |
| ------------------------------------------------------------------------------------------- | -----------: |
| RDS instance per hour                                                                       |     0.025000 |
| ALB per hour                                                                                |     0.025200 |
| Two public IPv4 addresses per hour, assumed                                                 |     0.010000 |
| 20 GiB gp3 storage per hour, prorated                                                       |     0.003781 |
| **Base per hour, exact calculation rounded**                                                | **0.063981** |
| **Four hours, base**                                                                        | **0.255923** |
| Four hours including a conservative one-LCU allowance                                       |     0.287923 |
| **Four hours plus USD 0.50 logs/transfer and USD 0.25 monthly retention/request allowance** | **1.037923** |

Storage uses `20 × 0.138 / 730` per hour. The separate [D3B full-demo envelope](sydney-d3b.md) remains about **USD 1.33** for four hours, including later active services and two one-shot task-hours. Neither estimate authorizes service activation. Tax, traffic, CPU surplus, billing rounding and teardown delay can increase charges. ALB/RDS bill while ECS is disabled. The existing USD 5 gross budget is an alert, not a hard cap; notification delivery is not newly claimed.

## Verification and retained attempts

| Executed check                                                                                           | Result                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository deployment safety suite, same nine files as `test:deployment`, via `node --import tsx --test` | PASS, 55 tests, zero failed/skipped with fixture subprocess execution permitted                                                            |
| Final focused `node --import tsx --test tests/runtime-plan.test.ts`                                      | PASS, 8 tests, including multiline identity evidence, administrator/provider substitution, role/trust/policy and backend mutation refusals |
| `node_modules/.bin/tsc -p tsconfig.check.json --noEmit`                                                  | PASS                                                                                                                                       |
| Scoped ESLint on `tools/runtime-plan.ts` and `tests/runtime-plan.test.ts`                                | PASS                                                                                                                                       |
| Actual remote-backed Terraform version/fmt/init/validate/plan/show                                       | PASS, all exit 0                                                                                                                           |
| Saved-plan create-only inventory, variables, immutable images, database, task, trust and secret checks   | PASS                                                                                                                                       |
| Backend STS identity, initialized metadata and S3/custody postchecks                                     | PASS                                                                                                                                       |
| Scoped Prettier and `git diff --check`                                                                   | PASS                                                                                                                                       |

The initial sandbox test run failed because Node fixture `spawnSync` returned EPERM; a minimal child-process check reproduced that restriction. The unchanged suite passed with execution permission. `pnpm --version` timed out without output, so installed repository tools and the equivalent Node/tsx test entrypoints were used. Next.js/full application integration checks were not rerun for this deployment-only change.

Original denied preparation `4651c1f3-45eb-4abf-80f5-95c700f457e1` remains untouched; [earlier role diagnosis and IAM-only evidence](sydney-d3e-session-diagnosis.md) remain historical. During this task, preparation `3f84878a-887b-4a24-9d39-d6d06d840203` initialized successfully but the new evidence parser rejected multiline SDK output. It stopped before plan/locking, with zero S3 mutations and unchanged state/custody. The parser was corrected and regression-tested; a fresh preparation produced the saved plan above. Neither failed claim was reused, and no permission failure was retried.

Automatic approval review rejected the first optional inspection command because it selected sensitive password/SSM value fields for output. It did not execute. The replacement inspection omitted those fields and succeeded; no secret value was printed or saved in the sanitized inspection artifact.

Changed files: `tools/runtime-plan.ts`, `tests/runtime-plan.test.ts`, `infra/AGENTS.md`, this report and the historical diagnosis cross-reference. No dependency, Terraform resource definition, policy file, image, schema or financial implementation changed. New tests cover the changed role/credential boundary and sanitized identity evidence.

## Remaining deployment blockers and stop

**D3E is complete; runtime deployment requires separate approval.** This plan embeds the restrictive backend session policy and **must not be applied**: it cannot persist state after provisioning. A future separately authorized provisioning workflow must establish narrowly approved state-write capability, generate and compare a fresh plan, and obtain concrete runtime/cost/cleanup approval. Do not broaden the planning role or silently reuse administrator backend credentials.

Later activation also needs actual ACM DNS records/public verification, issued TLS, approved runtime credentials/provisioning and real source/book bindings, then separately reviewed service/listener changes and hosted proofs. Free Plan admission for runtime provisioning remains unproven; no upgrade is authorized. Computed IDs/policies require the later review described above. No Phase 16 work began. Stop here without apply, DNS, Stripe or publication actions.
