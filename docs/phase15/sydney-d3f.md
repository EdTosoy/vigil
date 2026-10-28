# Sydney D3F — first infrastructure approval package

**Prepared, not provisioned. Zero AWS mutations in D3F.** Target: `747240980964`, `edtosoy`, `ap-southeast-2`, exact browser role `AccountFullAccessRole`. No IAM creation/change, lock or state payload write, apply/destroy, DNS/Stripe action, migration, activation, Phase 16, commit or push occurred. Existing uncommitted D3E work, private inputs, plans and failed claims are preserved.

Package identifier: **`vigil-sydney-d3f-4a5044f18c3c22b8`**. This identifies the reviewed scope, not an executable-plan approval. The [D3E binary](sydney-d3e.md) remains forbidden for apply:

```text
D3E run: 726aa12d-e639-4970-b9c6-c91dda0f8d18
SHA256: 4a5044f18c3c22b8672a26d4cf3bdbcdba72c49d6193e1a876da107fba1cf186
```

## Readiness observed, without mutations

Read-only inspection completed **2026-10-28T05:30:27Z**. STS passed the existing exact identity/environment guard. Free Tier returned FREE / ACTIVE, USD 120 credits, expiry `2027-04-26T13:49:39.175Z`. Only the existing global Free Tier API read uses `us-east-1`; workload and backend operations remain Sydney. The exact backend bucket remains versioned. The proposed state role and all three service-linked roles below returned NoSuchEntity. Free Plan status is not proof that RDS/ALB/ECS creation will be admitted; any denial must stop without upgrade, fallback identity or permission expansion. [Account-plan API](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_freetier_GetAccountPlanState.html).

Private sanitized evidence, mode 0600 in owner-only directories:

```text
.deployment/747240980964/ap-southeast-2/demo/apply-readiness/
  20841375-4b03-4ea0-b05a-21e3a893c545/approval-package.json
```

The existing saved plan was inspected in memory, its SHA-256 and source manifest verified, and all 75 resource changes/configuration checked. No raw plan JSON or secrets were printed/saved. Source-derived execution-policy projections are retained separately from the still-computed actual policy attributes.

## A. Exact IAM foundation approval

Propose **`arn:aws:iam::747240980964:role/vigil/VigilSydneyRuntimeStateRole`**, maximum session duration 3600 seconds, no tags, no managed policy attachment, inline policy **`VigilSydneyRuntimeStateOnly`**. It is backend-only and separately owned outside runtime/bootstrap Terraform state. The existing `VigilSydneyRuntimePlanRole` remains state-payload read-only and unchanged.

Reviewed files:

| Document                                                                   | SHA-256                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [Trust](../../../infra/runtime-state-role/trust.proposed.json)             | `c2156553d07641211328c890e0737999bc8a9b2f7e33a16091f26faf33309e39` |
| [Permissions](../../../infra/runtime-state-role/permissions.proposed.json) | `401f112a7064c3a66531b2323cc76d187aa6e0f8c6d6884c012757afb9c8257a` |

Trust permits only `sts:AssumeRole` by `arn:aws:iam::747240980964:role/managed/AccountFullAccessRole`, with `vigil-d3f-*` session names. Backend sessions request one hour; provider credentials remain the separate existing `edtosoy` browser identity.

Exact permissions, all within `flow-demo-tfstate-747240980964-ap-southeast-2`:

| Action                  | Scope/condition                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `s3:ListBucket`         | This bucket, prefixes `env:/*` and `demo/*` only                                           |
| `s3:GetBucketLocation`  | This bucket only                                                                           |
| `s3:GetObject`          | `demo/terraform.tfstate` and its `.tflock` only                                            |
| **`s3:PutObject`**      | **`demo/terraform.tfstate` only**, for native initial/intermediate/final state persistence |
| `s3:PutObject`          | Exact `.tflock`, requiring `s3:if-none-match = *`                                          |
| `s3:DeleteObject`       | Exact `.tflock` only, native owned release                                                 |
| `sts:GetCallerIdentity` | Identity read                                                                              |

Explicit denies cover state deletion, version deletion, writes to all other keys/buckets, nonconditional lock puts and all unrelated actions/mutations. No ACL, bucket-policy/configuration, KMS, IAM, deployment or administrator permissions are granted. Current bucket encryption and HTTPS/backend encryption requirements are preserved. The compact session policy is 1942 characters, under the 2048-character session-policy limit. This is a named backend-operation policy, not a generated infrastructure-provider policy. [S3 operation-to-permission reference](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html).

**Additional, newly confirmed prerequisite:** these three AWS service-linked roles are absent. To avoid hidden IAM creation during the 75-resource apply, approve their explicit creation first. Their service-managed trust/permissions are defined by AWS; they are not workload administrator grants and are not runtime Terraform resources:

| Role                                    | Service / exact IAM ARN suffix after `arn:aws:iam::747240980964:role/`                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `AWSServiceRoleForECS`                  | `ecs.amazonaws.com` / `aws-service-role/ecs.amazonaws.com/AWSServiceRoleForECS`                                                    |
| `AWSServiceRoleForElasticLoadBalancing` | `elasticloadbalancing.amazonaws.com` / `aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing` |
| `AWSServiceRoleForRDS`                  | `rds.amazonaws.com` / `aws-service-role/rds.amazonaws.com/AWSServiceRoleForRDS`                                                    |

AWS documents automatic role creation on the first [ECS cluster](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using-service-linked-roles-for-clusters.html), [load balancer/target group](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/elb-service-linked-roles.html) and [RDS instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAM.ServiceLinkedRoles.html). Their service-managed policies are broader than the backend policy and require this explicit review. Runtime teardown never explicitly deletes these account-level roles; AWS may manage their own lifecycle.

**Approval A text:** approve exactly five IAM requests in the target account: one CreateRole with the trust above, one PutRolePolicy with the permissions above, and three CreateServiceLinkedRole requests for the exact listed services. Verify STS immediately before each mutation; verify absence or exact existing configuration, stop on mismatch/failure, and verify each result. No changes to existing browser/planning roles, no additional IAM operation, no provisioning or state write follows merely from this IAM approval.

These commands are review material only; **none ran**:

```sh
aws iam create-role --profile edtosoy --region ap-southeast-2 \
  --role-name VigilSydneyRuntimeStateRole --path /vigil/ --max-session-duration 3600 \
  --assume-role-policy-document file://infra/runtime-state-role/trust.proposed.json
aws iam put-role-policy --profile edtosoy --region ap-southeast-2 \
  --role-name VigilSydneyRuntimeStateRole --policy-name VigilSydneyRuntimeStateOnly \
  --policy-document file://infra/runtime-state-role/permissions.proposed.json
aws iam create-service-linked-role --profile edtosoy --region ap-southeast-2 --aws-service-name ecs.amazonaws.com
aws iam create-service-linked-role --profile edtosoy --region ap-southeast-2 --aws-service-name elasticloadbalancing.amazonaws.com
aws iam create-service-linked-role --profile edtosoy --region ap-southeast-2 --aws-service-name rds.amazonaws.com
```

## B. Fresh-plan procedure and reviewed infrastructure

After Approval A is executed and its results verified, separately authorize preparation of a fresh initial plan with the new backend configuration. Preserve the old D3E plan and claims. No secret entry or regeneration is needed. The new command creates a fresh private namespace, reuses existing inputs/digests, checks the new role/policy plus all service-linked prerequisites and rechecks Free Plan. It compares complete managed changes/configuration and committed source/lockfile hashes to D3E, not just resource counts. Default D3E CLI behavior remains unchanged.

**Approval B:** prepare only the fresh plan; the previous conditional lock/owned-release authorization remains valid. Expect zero state payload writes during default-workspace planning; stop if initialization requires one. No apply or provisioning is authorized by a successful plan/review receipt.

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 node --import tsx tools/runtime-release.ts plan vigil-sydney-d3f-4a5044f18c3c22b8
```

This future command was **not run**. It returns the actual **`<fresh-run>:<fresh-plan-sha256>`** review ID; one cannot be supplied truthfully before the approved role exists and a fresh binary is generated. The returned binary must be reviewed before Approval C. `pnpm aws:runtime:release` is the equivalent repository script; the direct Node/tsx entrypoint is verified in this environment, where the pnpm launcher previously timed out.

The exact accepted inventory remains **75 creates / 0 updates / 0 replacements / 0 deletes**:

| Group       | Count | Scope                                                                                                  |
| ----------- | ----: | ------------------------------------------------------------------------------------------------------ |
| Network     |    41 | 1 VPC, 1 IGW, 4 subnets, 2 route tables, 1 route, 4 associations, 7 groups, 21 ingress/egress rules    |
| RDS         |     3 | Private encrypted Single-AZ PostgreSQL 18.6, db.t4g.micro, 20 GiB gp3, subnet and SSL parameter groups |
| ECS         |     6 | Cluster plus five digest-pinned non-root Fargate definitions; no running tasks/services                |
| Runtime IAM |    15 | Ten ECS-trusted roles plus five scoped execution policies                                              |
| Logs        |     5 | Three-day retention                                                                                    |
| ALB         |     3 | Public ALB and two IP targets; no listeners                                                            |
| ACM         |     1 | `vigil.edtosoy.com` certificate request; no DNS/waiter                                                 |
| SSM         |     1 | Standard SecureString `admin_url`, write-only value                                                    |

The four newly proposed foundation roles and state inline policy are **additional to**, and excluded from, those 75 Terraform resources. No NAT, public database, Route 53, budget, bootstrap S3/ECR, managed-policy attachment, task launch or application/financial change is in the proposal. Flags remain `initial_infrastructure_only=true`, `start_services=false`, `certificate_dns_confirmed=false`, `defer_webhook_secret=true`.

### Five computed execution policies

Every policy has exactly four statements: `ecr:GetAuthorizationToken` on `*`; image reads `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, `BatchGetImage` on one exact repository; `logs:CreateLogStream`/`PutLogEvents` on that workload's `/flow/demo/<workload>:*` log streams; and `ssm:GetParameters` on the following named parameters only:

| Workload | ECR repository under `flow-demo/` | SSM names under `/flow/demo/`                |
| -------- | --------------------------------- | -------------------------------------------- |
| ops      | ops                               | operations_url, demo_password, demo_username |
| ingress  | stripe                            | ingress_url, webhook_secrets                 |
| worker   | stripe                            | stripe_key, stripeworker_url                 |
| admin    | admin                             | admin_url, provisioning                      |
| verify   | admin                             | ingress_url, stripe_key, stripeworker_url    |

All resource ARNs use account `747240980964` and region `ap-southeast-2`. ECR authentication's wildcard is not permission to read arbitrary repositories. No execution policy grants IAM/PassRole, state access, resource creation or general administrator privileges; task roles have no AWS policies. The admin task's future database-owner secret reference is intentional and remains unusable here because no task is launched. The other future SSM parameters are not provisioned by this stage.

The projection follows the exact pinned HCL and AWS provider 6.68.0's [log-group ARN normalization](https://github.com/hashicorp/terraform-provider-aws/blob/v6.68.0/internal/service/logs/group.go#L292). Actual plan policy attributes remain computed; they are not claimed to have become known. Guards require unchanged complete configuration/source hashes for computed documents and exact expected permissions for any materialized document. Unknown references are not a blanket permission exemption. The provider remains the existing broad browser role; this task does not claim a least-privilege provisioning identity.

## C. State writes and first apply approval

Before invoking the prepared command, approve the **actual fresh review ID and SHA-256**, unchanged 75 creates, exact state-write key, four-hour attended session/cleanup window and the gross cost envelope below. Do not authorize an unnamed future plan or the existing D3E binary.

**Approval C text:** approve only that fresh saved plan's 75 creates in the target account/region, with native Get/Put persistence of `demo/terraform.tfstate` and conditional creation/owned release of its `.tflock`. Allow initial/intermediate state persistence even during partial failure, but no state deletion/version deletion, bootstrap mutation, DNS/Stripe/migration/activation or extra resources/IAM privileges. Stop on unexpected changes, Free Plan/permission failure or uncertain outcome; never retry automatically. Cleanup requires the separately reviewed deletion procedure below.

Exact guarded apply entrypoint, **not run**, substituting only the returned fresh review ID:

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 node --import tsx tools/runtime-release.ts apply --reviewed '<fresh-run>:<fresh-plan-sha256>'
```

The wrapper pins Terraform 1.15.3 and rejects D3E run/hash, stale/future-dated reviews (15-minute maximum), changed binary, source, full resource/configuration projection, secure inputs, executor code, CLI configuration or backend. It revalidates live state-role trust/policy, all create-time service-linked prerequisites, versioned bucket, STS identity and FREE/ACTIVE plan with at least USD 2 remaining credit and four-hour expiry margin. It requires no current/historical payload state or lock, then atomically claims the first apply before one fixed saved-plan invocation. No general deployment gate, force-unlock, arbitrary Terraform flag or fallback credential path is opened.

Native Terraform may partially create resources before a service admission/permission error. The claim survives success, failure, timeout and unknown outcome. Remote versioned state, native emergency local state and sanitized exit records are retained; raw diagnostics/secrets are not logged. Replaying the apply, discarding state or automatically destroying resources is forbidden. A post-attempt state version is retained when observable; absent/uncertain state requires manual recovery review. Successful command exit still needs actual infrastructure/state verification before any further deployment phase.

## Cost, stopped-stage consequences and cleanup

No new paid runtime was started. Recomputed from the dated **2026-10-26** [gross rates](sydney-cost-estimate.json), before credits/tax, using Decimal arithmetic:

- Stopped stage: **USD 0.063981/hour** base; about **USD 0.255923/four hours**.
- Four hours with one-LCU allowance, USD 0.50 logs/transfer and USD 0.25 monthly retention/requests: **USD 1.037923**, approximately **USD 1.04**. Keep the existing **USD 2 attended planning/abort envelope**, not a billing cap.
- Leaving it stopped still costs approximately **USD 1.54–1.73/day** before allowances. RDS, storage, ALB and its assumed two IPv4 addresses bill with zero ECS tasks and no listeners. Initial Fargate compute is zero; later activation needs a new cost/scope review. Prices were not refreshed; usage, CPU surplus, tax, rounding and deletion delay can exceed this estimate.

No hosted application, working TLS endpoint, financial assurance or database schema follows from this apply. DNS/certificate waiting must not extend the paid window unattended. Begin cleanup by **T+3h**, aim for complete removal by **T+4h**. The existing budget/accepted inactive-recipient risk is unchanged; credits and budget alerts are not hard caps.

There is no atomic AWS rollback. For a failed/unknown apply, retain every artifact and inspect actual state/resources first. If an emergency `errored.tfstate`, missing authoritative state or unexpected state-version change exists, stop for a concrete recovery review; never push/rewind/reseed state implicitly.

After the successful or partial first attempt, prepare a separate deletion plan using the existing exact conditional-lock authorization; generating it grants no deletion authority:

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 node --import tsx tools/runtime-release.ts teardown-plan --after '<first-apply-review-id>'
```

It accepts only actual deletes of a unique subset of the same 75 addresses, with no creates/updates/replacements or foundation deletion. It requires the observed post-attempt state version to be unchanged. Review its binary/hash and exact deletion list, then **Approval D** authorizes that deletion review ID plus native writes of the final empty runtime state:

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 node --import tsx tools/runtime-release.ts teardown --reviewed '<teardown-run>:<teardown-plan-sha256>'
```

Both commands are prepared and **unexecuted**. A teardown review expires after 15 minutes; its version/hash/source/input/code bindings and single-use claim are checked again. Exhausted credits do not themselves block approved cleanup on the same Free Plan account. RDS deletion intentionally takes no final snapshot and removes disposable data. State versions, bootstrap S3/ECR, planning/state roles and account-level IAM foundations are not explicitly destroyed. After deletion, independently verify removal of billable RDS/ALB/network/runtime resources and empty runtime managed state; successful Terraform exit alone is insufficient. Inactive ECS task-definition metadata and retained foundations can remain.

## Verification, limits and next approval

Implemented: proposed immutable-hash state policies; D3F-only backend capability alongside unchanged default D3E behavior; exact baseline/IAM review guards; read-only readiness inspection; fresh-plan, single-use apply and separate teardown entrypoints; package scripts and focused tests. No dependency or production Terraform resource definition changed. No schema, financial invariant or application behavior changed.

Executed verification:

| Check                                                                          | Result                                                                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Targeted repository deployment suite with new guard tests                      | PASS, 64 tests at that run                                                         |
| Final affected runtime-plan/release tests after state-history hardening        | PASS, 18 tests, zero skipped/failed                                                |
| `node_modules/.bin/tsc -p tsconfig.check.json --noEmit`                        | PASS                                                                               |
| Scoped ESLint and Prettier; `git diff --check`                                 | PASS                                                                               |
| Existing isolated offline demo workflow                                        | PASS: Terraform fmt, backend-disabled init, validate and 15 mocked plan-only tests |
| Actual existing saved-plan/source/hash inspection and live read-only readiness | PASS; prerequisite roles absent as recorded above                                  |

Actual state-role admission, a new state-capable saved plan, infrastructure apply, state persistence, teardown and hosted behavior were **NOT RUN**. Tests establish local guards, not successful future cloud mutations. Full application/Next.js/database regressions were not repeated for this deployment-only preparation. Prior D3E changes were preserved, not committed. Changed D3F files are the three new runtime release/review/state-role modules, proposed state JSON files, new release tests, package scripts, the purpose-specific extension to runtime-plan, infrastructure instructions and this package.

**Stop for approval.** Immediate approval needed is **A**, then **B**. A live fresh review ID is required before **C** can be concrete. Confirm an attended four-hour window and cleanup authority before provisioning; DNS/Stripe credentials and source/book provisioning are later activation prerequisites, not permission to run them here. No additional architecture audit is required.
