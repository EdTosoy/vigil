# Sydney redeployment audit and operator runbook

Audited 2026-10-29. Target: account **747240980964**, profile **edtosoy**, region **ap-southeast-2**, hostname **vigil.edtosoy.com**.

**Local remediation follow-up:** the separate [Sydney cycle executor](sydney-cycles.md) now implements and locally tests repeat deployment, staged activation/full teardown and current-HEAD auth configuration. The findings below remain the authoritative starting audit, rather than new live observations. Cloud execution, image publication, hosted acceptance and actual cleanup of the new path remain unverified and unauthorized.

**Audit complete; deployment is blocked by repeat-cycle and teardown tooling.** Temporary browser credentials work. Do not provision a demo until the whole deployment/activation/cleanup cycle is supported and reviewed. This audit performed no IAM changes, state/lock writes, remote backend initialization, resource provisioning/deletion, DNS/Stripe changes, publication, commit or push.

## Authoritative workflow

Use the [Sydney decision](../architecture/adr/019-sydney-offline-portability.md), `infra/AGENTS.md`, tracked `infra/demo` sources and this runbook together. The runtime remains ephemeral ECS Fargate, public HTTPS ALB/ACM and private Single-AZ RDS. Persistent Sydney S3/ECR foundations already exist. Manual Cloudflare DNS replaces the historical Route 53 delegation workflow; the existing account-wide USD 5 gross budget is externally owned.

| Path                                                               | Authority and present limitation                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/bootstrap`                                                  | Persistent S3/ECR source definitions. Do not recreate foundations or rerun seed bootstrap against existing resources. Tracked sources have no remote backend. |
| `infra/demo`                                                       | Authoritative ephemeral Sydney runtime configuration. Source-only assembly excludes generated backends/caches/state.                                          |
| `tools/runtime-release.ts`                                         | Guarded **first-cycle** infrastructure plan/apply and initial-inventory teardown. It is not a redeployment or complete activated-runtime lifecycle.           |
| `tools/runtime-recovery.ts`                                        | Historical 75-to-90-resource recovery plan/review only; no execution command and no reusable redeploy support.                                                |
| `tools/deploy.ts`, `tools/demo-deploy.ts`, `tools/demo-observe.ts` | Legacy mutation paths remain disabled by `assertDeploymentPrepared()`. Only their documented preflight/local preparation surfaces are usable.                 |
| `infra/startup`                                                    | Separate ARM64 EC2/self-managed PostgreSQL proposal. Locally tested, not the approved ephemeral hosting workflow. Do not deploy it for this task.             |
| Earlier D1–D3 reports / US East Phase 15 report                    | Historical evidence, not current admission or execution authority. In particular, D3F's missing foundation-role findings have since been resolved.            |

The ignored local `infra/bootstrap/backend.generated.tf` still names account **163596511125**, `us-east-1`. It was not edited or removed. Never run `terraform init` in any source root, copy its `.terraform` directory, migrate/copy historical state, or use `-force-copy` to repair this. Run the source-copy validators below. Existing allowlists exclude the foreign backend.

## Findings, ranked

| Severity                      | Finding and evidence                                                                                                                                                                                                                                                                                                                                      | Required response                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 — launch blocker           | `runtime-release.ts` requires the absence of `first-runtime-apply-attempt.json`; that claim exists. Its planner also requires absent state, and its apply guard rejects **all state-key history**. The user-confirmed empty current state has **11 retained versions**, not a never-created state key.                                                    | Add a separately reviewed repeat-cycle path that binds the existing empty state version/lineage and absent runtime inventory to a new cycle. Preserve all history and old claims. Do not delete claims, state versions, objects or locks to satisfy first-use guards.                                                                                                                                          |
| P1 — cleanup blocker          | Release teardown accepts only initial-runtime addresses and the original observed state version. Activation adds services, parameters and listeners; `runtime-recovery.ts` is a historical, plan-only special case. Existing activation/provision/proof mutation wrappers are disabled.                                                                   | Before provisioning, support and test staged activation and deletion of the **actual full cycle inventory**, with physical identities, current state version, fresh saved plans and unknown-outcome recovery. A successful infrastructure apply is insufficient.                                                                                                                                               |
| P1 — stale inputs             | The local input checker reports all secret fields/bindings populated, but these include a prior database endpoint and prior source/book UUIDs. Its own result says `bindingsVerified=false`, `dnsConfirmed=false`, `planExecutable=false`.                                                                                                                | Prepare fresh cycle intent and private credentials. Clear obsolete bindings through a reviewed new-cycle preparer, without editing historical evidence. Use actual outputs from the new database/provisioner before activation. Never interpret a syntactically valid UUID as an existing identity.                                                                                                            |
| P1 if deploying current HEAD  | The retained images are from commit `c4ff82ae980b…`, preceding application authentication. Current `apps/ops/server/read.ts` requires auth outside public snapshot mode, while `infra/demo/compute.tf` supplies only operations/demo Basic inputs; it has no `DATABASE_AUTH_URL`, `BETTER_AUTH_*`, application auth seeding or related parameter mapping. | The smallest existing-demo scope is the coherent, previously verified image trio below, with its historical UI/access behavior explicitly accepted. To ship current HEAD, first align ECS configuration, provisioning and narrowly reviewed secret permissions with the new auth boundary. Do not disable auth or switch to public snapshot mode to obtain readiness. No IAM policy was changed in this audit. |
| P2 — wrong-account hazard     | Generated bootstrap backend/cache can target the historical US East account despite Sydney tracked sources.                                                                                                                                                                                                                                               | Keep source-only isolation; never execute Terraform in source roots. No bootstrap reinitialization is needed for this redeployment.                                                                                                                                                                                                                                                                            |
| P2 — permission assurance gap | Plan/State roles are backend-only by design. STS and reads do not prove future resource creation, runtime-role creation/PassRole, service admission or deletion is permitted by SCPs.                                                                                                                                                                     | Keep provider credentials on the existing browser identity; backend uses the restricted State role. Do not widen backend roles, self-assume the browser role or attempt GitHub OIDC as a workaround. Stop on denials, retain state and review recovery.                                                                                                                                                        |
| P2 — cost boundary            | One running `t4g.small` and one attached 30 GiB EBS volume belong to **abox-demo**, not Vigil. Their public IPv4 and other costs share the USD 5 account budget. Budget notification configuration does not establish delivery.                                                                                                                           | Leave unrelated resources untouched. Recheck account-wide gross spend, credit/plan status and operator-confirmed alert delivery before a runtime window; budget is not a spending cap.                                                                                                                                                                                                                         |
| P3 — image refresh            | `d3a-publication.json` is retained; `publish-images.ts` rejects another publication under that singleton claim.                                                                                                                                                                                                                                           | Reusing the existing trio needs no push. A future new-image publication needs a reviewed cycle-aware claim, not deletion of the old claim.                                                                                                                                                                                                                                                                     |

## Browser credentials and role separation

**Yes: this deployment can use local temporary browser credentials without GitHub OIDC.** The live CLI profile contains `region` and `login_session`; it has no `credential_process` helper. AWS CLI 2.34.24 authenticated as the expected `AccountFullAccessRole` in the target account. An isolated, backend-free Terraform 1.15.3 / AWS provider 6.68.0 configuration containing only an STS identity data source successfully planned using that profile. No exported credential values, long-lived keys or profile changes were needed.

Both existing backend roles were assumed using their restrictive session policies; each returned its expected STS identity and successfully read the existing demo state's **metadata**. Both live inline policies match the repository's reviewed documents, with no attached managed policies. All three ECS/ELB/RDS service-linked roles now exist. No IAM foundation change is presently indicated by these checks.

| Credential path                                             | Purpose                                                                                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edtosoy` browser role `/managed/AccountFullAccessRole`     | Terraform AWS provider and explicitly reviewed operator operations. Resource-write/delete admission remains untested. Its service trust is not a self-assumption interface. |
| `/vigil/VigilSydneyRuntimePlanRole`, session `vigil-d3e-*`  | State reads and conditional owned-lock operations. **Cannot persist state; never apply a plan carrying this backend.**                                                      |
| `/vigil/VigilSydneyRuntimeStateRole`, session `vigil-d3f-*` | Exact `demo/terraform.tfstate` persistence and native owned-lock operations. No infrastructure-management permissions. Use for fresh executable plans and teardown.         |
| Runtime ECS execution/task roles                            | Existing narrow ECR/SSM/log access and workload isolation; owner DB credentials belong only to one-shot administration.                                                     |

The SCP blocking GitHub OIDC is user-confirmed; no OIDC provider or forbidden mutation was probed. It does not require using OIDC for local CLI deployment. An SCP denial still overrides IAM allows, so changing credential delivery cannot bypass a denied resource action. [AWS browser login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html), [SCP evaluation](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html).

Reauthenticate interactively when required; recheck STS immediately before each future mutation. Browser credential refresh and one-hour backend sessions are separate lifetimes. This audit did not test long-running refresh or remote Terraform backend initialization. AWS's generic SDK support matrix varies; the pinned provider's live identity probe above is the evidence for this workstation, not a promise about all SDKs/versions.

## Safe commands available now

Run from a clean shell without inherited credential, endpoint, region or Terraform overrides. The repository guards reject overrides rather than silently choosing credentials.

```sh
cd ~/projects/flow
export AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2
export AWS_DEFAULT_REGION=ap-southeast-2 AWS_PAGER=
umask 077

# Only if the browser session needs renewal:
aws login --profile edtosoy --region ap-southeast-2

aws sts get-caller-identity --profile edtosoy --region ap-southeast-2
pnpm aws:demo preflight
pnpm aws:validate:offline
pnpm aws:startup:validate:offline
pnpm test:deployment
pnpm test:startup
pnpm aws:runtime:inputs check
```

Expected STS account: `747240980964`; role: `AccountFullAccessRole`. Offline validation initializes only copied sources with `-backend=false`, validates configuration and runs mocked plan-only tests. It does not prove runtime credentials, service admission, financial correctness or a deployment plan. Input checking reports presence, not current database/source/DNS proof.

Read-only preflight and post-cleanup inventory commands:

```sh
aws s3api get-bucket-versioning --bucket flow-demo-tfstate-747240980964-ap-southeast-2 --expected-bucket-owner 747240980964
aws s3api head-object --bucket flow-demo-tfstate-747240980964-ap-southeast-2 --key demo/terraform.tfstate --expected-bucket-owner 747240980964 --query '{Version:VersionId,ETag:ETag,Modified:LastModified,Bytes:ContentLength}'
aws s3api list-object-versions --bucket flow-demo-tfstate-747240980964-ap-southeast-2 --prefix demo/terraform.tfstate --expected-bucket-owner 747240980964 --query '{Versions:Versions[].{Key:Key,Version:VersionId,Latest:IsLatest},DeleteMarkers:DeleteMarkers[].{Key:Key,Latest:IsLatest}}'
aws ecs list-clusters
aws rds describe-db-instances --query 'DBInstances[].{Id:DBInstanceIdentifier,Status:DBInstanceStatus,Public:PubliclyAccessible}'
aws elbv2 describe-load-balancers --query 'LoadBalancers[].{Name:LoadBalancerName,State:State.Code}'
aws ec2 describe-nat-gateways --query 'NatGateways[].{Id:NatGatewayId,State:State}'
aws ec2 describe-addresses --query 'Addresses[].{Allocation:AllocationId,Association:AssociationId}'
aws ec2 describe-vpc-endpoints --query 'VpcEndpoints[].{Id:VpcEndpointId,Type:VpcEndpointType,State:State}'
aws rds describe-db-snapshots --query 'DBSnapshots[].{Database:DBInstanceIdentifier,Type:SnapshotType,Status:Status}'
aws ssm describe-parameters --parameter-filters 'Key=Name,Option=BeginsWith,Values=/flow/demo/' --query 'Parameters[].Name'
aws logs describe-log-groups --log-group-name-prefix /flow/demo/ --query 'logGroups[].{Name:logGroupName,Retention:retentionInDays,Bytes:storedBytes}'

# These account-level APIs use their global/control-plane endpoint; account is unchanged.
aws freetier get-account-plan-state --region us-east-1
aws budgets describe-budget --account-id 747240980964 --budget-name mdp-monthly-gross-usd-5 --region us-east-1 --query 'Budget.{Limit:BudgetLimit,Actual:CalculatedSpend.ActualSpend,Costs:CostTypes,Filters:CostFilters}'
```

Keep metadata receipts private. Never print state bodies, `ssm get-parameter --with-decryption` output or raw credential exports. An absent/empty state does not prove absent resources: verify both. A 403 is not proof that a lock/object is absent. Do not disable locking or force-unlock to proceed.

## Minimal work required before launching

1. Implement and verify one repeatable, attended **demo cycle** over the existing state key. Pin the reviewed empty-state VersionId/ETag/lineage and source/image manifests; require fresh actual inventory and an exclusive new cycle claim. Preserve old claims, state history and unknown outcomes. Do not modify or broaden the existing first-use guard to accept arbitrary prior states.
2. Complete the bounded staging/provisioning/activation/proof path and **test teardown against its final full inventory**, including changed ECS definitions, services, SSM parameters, ACM validation and ALB listeners. Refresh/version drift invalidates a saved plan; partial/unknown outcomes require an explicit recovery review. Cleanup permission and commands must be ready before creation.
3. Create new local cycle inputs without repurposing the old database endpoint/source UUIDs. Keep Stripe and synthetic dashboard books distinct. Preserve secrets in the existing private store/in-memory/write-only path, not argv or Terraform variables files. Recheck the sandbox account and current hosted destination/signing secret before activation.
4. Prefer the existing verified image trio for the smallest existing-demo scope. If current HEAD is required, separately review auth wiring, provisioning and scoped execution-policy changes, rebuild/test/publish coherent images, then produce a new full configuration baseline. No such IAM/source/image changes are included here.

No financial-core refactoring, new dependency, NAT, Redis, GitHub OIDC, new backend bucket, alternate state key, broader state role or always-on EC2 deployment is needed for this work.

## Immutable image inputs for the existing-demo scope

These three ECR digests were re-observed during this audit. Their prior publication record proves the `linux/amd64` source-linked set at `c4ff82ae980b6442bb74c6cc5027d1d8c3a5e402`; this audit did not rerun their application smoke or vulnerability scan. Do not combine them with assumptions about current HEAD's new login feature.

```text
admin  = 747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/admin@sha256:2c5730a3d9490c18bfe611fd38671140f9f18319f512e193f63ebb8a30dfe223
ops    = 747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/ops@sha256:06856e82365e186db47f2ed1c8906fca97e59194031d767eefad34e01e929ca9
stripe = 747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/stripe@sha256:0c53fce38d2dad143ef243516b0a337ccf127d6ba59003902bbabd01108a2c8a
```

## Deployment sequence and exact Terraform primitives — blocked until remediation

**This is a reference for the reviewed cycle executor, not a way to bypass current wrappers.** No currently implemented command can safely redeploy and fully activate/tear down this existing lineage. `aws:runtime:release plan` is first-use only; `aws:demo plan/apply/provision/enable/proof/destroy-plan` remain disabled; the historical recovery plan is not executable. Do not delete their evidence or call Terraform manually to evade them.

After the blockers above are fixed, obtain separate approval of the concrete saved resource plan and intended state writes. The executor must emit an actual private cycle directory, allowlisted source/lock manifest, fixed backend JSON, stage variables without secrets, current state metadata and a restricted Terraform CLI configuration. Define these actual paths in its environment; do not invent a review ID or use a historical plan. Paths must remain under `.deployment/747240980964/ap-southeast-2/demo/`, be owned by the operator and reject symlinks; directories 0700, sensitive files 0600.

The backend file must preserve bucket `flow-demo-tfstate-747240980964-ap-southeast-2`, key `demo/terraform.tfstate`, region/profile/account guard, encryption, `use_lockfile=true`, default workspace, and `runtimeStateBackend(<cycle-uuid>)`'s existing State-role assumption plus restrictive policy. It must not carry the Plan-role session policy. The provider continues to use `edtosoy` separately.

Below, `VIGIL_CYCLE_DIR`, `VIGIL_TF_WORK`, `VIGIL_BACKEND`, `VIGIL_STAGE_VARS` and `VIGIL_REVIEWED_PLAN` are **outputs of that future reviewed executor**, not present capabilities. It must supply the validated `TF_VAR_secrets` only in the child process environment, with the same semantic values at plan and apply. Never place secrets into the backend file or CLI arguments. Each stage requires a new saved plan and approval, including cleanup authority before first creation.

```sh
# Future executor only. No remote init/plan/apply was performed in this audit.
export TF_DATA_DIR="$VIGIL_CYCLE_DIR/terraform-data"
export TF_CLI_CONFIG_FILE="$VIGIL_CYCLE_DIR/terraform.rc"
export TF_WORKSPACE=default

terraform -chdir="$VIGIL_TF_WORK" init -reconfigure -input=false -lockfile=readonly -backend-config="$VIGIL_BACKEND"
terraform -chdir="$VIGIL_TF_WORK" validate -no-color
terraform -chdir="$VIGIL_TF_WORK" plan -input=false -no-color -lock-timeout=30s -var-file="$VIGIL_STAGE_VARS" -out="$VIGIL_REVIEWED_PLAN"
terraform -chdir="$VIGIL_TF_WORK" show -json "$VIGIL_REVIEWED_PLAN" > "$VIGIL_CYCLE_DIR/review-private.json"
sha256sum "$VIGIL_REVIEWED_PLAN"

# Only after concrete saved-plan approval, matching code/inputs/backend/state,
# fresh STS, and a still-valid review (existing review bound: 15 minutes):
aws sts get-caller-identity --profile edtosoy --region ap-southeast-2
terraform -chdir="$VIGIL_TF_WORK" apply -input=false -no-color "$VIGIL_REVIEWED_PLAN"
```

Never pass secrets through `-var` or apply the restricted historical D3E/recovery binaries. A future S3-backed plan itself uses lock writes/deletes, so planning also needs explicit authorization; it is not part of a read-only audit. Backend-disabled validation does not authorize remote initialization. [Terraform 1.15 backend and permissions](https://developer.hashicorp.com/terraform/language/v1.15.x/backend/s3).

Use the following stages in the approved executor:

1. **Infrastructure stopped:** `initial_infrastructure_only=true`, `defer_webhook_secret=true`, `start_services=false`, `certificate_dns_confirmed=false`, no stale source/dashboard bindings. Review exact resources; the prior equivalent first-stage proposal had 75 creates. Counts alone are not proof. Creation starts the billable window even while tasks are stopped.
2. **Actual DNS/HTTPS:** get actual ACM validation CNAMEs and ALB hostname from the new outputs. Operator publishes only `vigil` records DNS-only in Cloudflare; independently verify public DNS and ACM ISSUED. Never touch `flow.edtosoy.com`, create Route 53 resources or supply Cloudflare credentials. Review HTTPS changes with services still stopped.
3. **Private provisioning inputs:** `initial_infrastructure_only=false`, `defer_webhook_secret=true`, services stopped. Install real write-only pre-webhook SSM inputs. Run exactly one approved admin task with a ten-minute bound; verify exit status, migration/narrow-login receipt and distinct actual Stripe source/synthetic-book outputs. Never retry an unknown financial/commit outcome blindly. Bind those outputs, not historical UUIDs.
4. **Destination then activation:** explicitly authorize registering/rebinding the dedicated sandbox destination and retain its real signing secret in the private input store. Set `defer_webhook_secret=false`, actual source/dashboard bindings, verified DNS and `start_services=true` only in a newly reviewed activation plan. Do not initiate sandbox payment demonstrations before ingress and workers are ready. Do not toggle staging flags backward on an active runtime to force deletion of secrets.
5. **Independent proof:** perform the checks below and retain sanitized evidence. Technical readiness does not establish reconciliation, completeness or financial PASS.

## Cost controls

Use one attended **four-hour resource window**, including provisioning and removal. Start cleanup by **T+3h**, finish by **T+4h**. Stop before creation if cleanup cannot be executed/recovered safely. No scheduled or always-on deployment, automatic retry loop, account upgrade, extra replicas, NAT, paid private endpoints, enhanced ECR scanning or additional hosted zone is needed.

The [2026-10-26 estimate](sydney-cost-estimate.json) models approximately **USD 0.13/hour** for an active demo, **USD 1.80** for one four-hour monthly session or **USD 3.44** for four such sessions with its allowances, before tax and unexpected usage. These are dated planning figures, **not a refreshed quote or hard cap**. They conservatively include a USD 0.50 hosted-zone allowance that manual Cloudflare does not need; published-image storage was smaller than its 2 GB allowance. The current three compressed image sizes sum to 261,816,198 bytes. Preserve reproducible images/state history rather than deleting them for negligible savings.

Recheck gross account usage, all concurrent workloads and alert delivery before each session. At audit time the Free Plan was FREE/ACTIVE with USD 139.16 credits, expiry 2027-04-26; the gross USD 5 monthly budget reported USD 0.001, subject to billing delay. Credits do not change gross costs. The unrelated `abox-demo` VM consumes this same account budget. Four budget notifications exist; actual subscriber delivery was not tested or assumed.

The main avoidable cost is leaving RDS/ALB/networked tasks alive between demos. Stopping ECS leaves RDS/ALB charges; stopping RDS retains storage charges and is not permanent teardown. Existing runtime settings use private encrypted Single-AZ `db.t4g.micro`, 20 GiB gp3, no automatic storage growth, zero backup retention/no final snapshot for explicitly disposable demo data, 0.25 vCPU per service and three-day logs. Preserve those limits and review snapshot/data disposition before deletion. [RDS stopped-instance billing](https://aws.amazon.com/rds/faqs/), [IPv4 pricing](https://aws.amazon.com/vpc/pricing/).

## Verification during the approved demo

```sh
curl --fail --silent --show-error https://vigil.edtosoy.com/health/live
curl --fail --silent --show-error https://vigil.edtosoy.com/health/ready
aws ecs describe-services --cluster flow-demo --services flow-demo-ops flow-demo-ingress flow-demo-worker --query 'services[].{Name:serviceName,Desired:desiredCount,Running:runningCount,Pending:pendingCount,Deployments:deployments[].rolloutState}'
aws rds describe-db-instances --db-instance-identifier flow-demo --query 'DBInstances[0].{Status:DBInstanceStatus,Public:PubliclyAccessible,Encrypted:StorageEncrypted,MultiAZ:MultiAZ,BackupDays:BackupRetentionPeriod}'
aws acm describe-certificate --certificate-arn "$VIGIL_CERTIFICATE_ARN" --query 'Certificate.{Domain:DomainName,Status:Status}'
aws elbv2 describe-target-health --target-group-arn "$VIGIL_OPS_TARGET_GROUP_ARN"
aws elbv2 describe-target-health --target-group-arn "$VIGIL_INGRESS_TARGET_GROUP_ARN"
```

Use actual ARNs from the reviewed cycle's outputs. The chosen immutable-image set determines the expected unauthenticated access behavior: verify the protected demo boundary for the historical trio, or real Admin/Viewer sessions and book grants after current-HEAD auth support is completed. Inspect readiness, task exit/restart/attempt history and TLS verification; no owner credential belongs in a serving task. Use the separately approved sandbox proof task to verify exact-byte signed acceptance, durable work, worker processing, replay deduplication and supported capture/fee evidence. Preserve UNKNOWN and distinguish synthetic bank data from real external proof. Do not send secrets through curl arguments or print raw application payloads/state.

## Teardown and unknown outcomes — must be ready before creation

After separate deletion approval, use a **fresh State-role-backed** plan bound to the current cycle's actual final state version and full physical inventory. Do not reuse the original 75-resource plan or the historical 90-resource recovery binary. The executor must pass the required same-cycle ephemeral inputs to teardown planning, retain the exact backend/source manifests and verify deletion-only actions against the current inventory.

```sh
# Future reviewed cycle executor only; all blockers above must be resolved.
terraform -chdir="$VIGIL_TF_WORK" plan -destroy -input=false -no-color -lock-timeout=30s -var-file="$VIGIL_STAGE_VARS" -out="$VIGIL_TEARDOWN_PLAN"
terraform -chdir="$VIGIL_TF_WORK" show -json "$VIGIL_TEARDOWN_PLAN" > "$VIGIL_CYCLE_DIR/teardown-private.json"
sha256sum "$VIGIL_TEARDOWN_PLAN"

# After separate deletion-plan approval, fresh STS and unchanged state/manifest:
aws sts get-caller-identity --profile edtosoy --region ap-southeast-2
terraform -chdir="$VIGIL_TF_WORK" apply -input=false -no-color "$VIGIL_TEARDOWN_PLAN"
```

Do not use a fresh unsaved `terraform destroy`. Deletions must exclude bootstrap S3/ECR/history, backend/browser/service-linked roles, the existing budget, Cloudflare parent DNS and all `abox-demo`/unrelated resources. Retirement of only this cycle's sandbox destination and `vigil` application DNS is separately approved; failed/retried delivery evidence must remain explainable.

After successful deletion, verify **both empty managed-resource state and actual removal**, using the read-only inventory commands above plus cycle-specific task, VPC/ENI, runtime-IAM and ACM identities. Ensure no running/pending demo tasks, cluster/services, RDS/snapshots, ALB/listeners/targets, runtime SSM/logs/IAM/network resources or billable demo IPs remain. Inactive ECS task-definition revisions may be retained as non-running metadata; account-level service-linked roles and S3/ECR/state history survive. A successful Terraform exit code alone is not proof of stopped charges.

On expiry, denial, crash, partial apply/delete or uncertain commit: retain all state, locks, manifests, attempts and results; reauthenticate, read actual current state/inventory, then review a specific recovery plan. Never reset, rewind, push, import, migrate, delete state/history, force-unlock or automatically retry the command to make the records look clean. Credit exhaustion must not itself prevent authorized cleanup. Financial history must never be repaired by infrastructure recovery.

## Executed audit verification

| Check                                                                     | Result                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exact-profile STS                                                         | PASS, expected account/browser role; CLI 2.34.24.                                                                                                                        |
| Read-only audit                                                           | PASS, 29 successful inventory/policy/metadata requests in the main batch; separate ownership and STS-role probes also succeeded. No state body or secret values printed. |
| Native provider/browser profile                                           | PASS, Terraform 1.15.3 / provider 6.68.0, backend-free STS-only plan, no managed resources or saved plan.                                                                |
| Existing role assumption / state metadata                                 | PASS for both restricted roles; policy equality checked against repository documents. No write probes performed.                                                         |
| `AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:validate:offline` | PASS: bootstrap fmt/init/validate + 7 mocked plans; demo fmt/init/validate + 15 mocked plans.                                                                            |
| `pnpm aws:startup:validate:offline`                                       | PASS: fmt/init/validate + 4 mocked plans.                                                                                                                                |
| `pnpm test:deployment`                                                    | PASS: 69 tests, including rejection of historical state and full-inventory limitations.                                                                                  |
| `pnpm test:startup`                                                       | PASS: 3 tests.                                                                                                                                                           |
| `pnpm aws:runtime:inputs check`                                           | PASS as a local presence check only; current bindings/activation remain unverified.                                                                                      |

Main sanitized evidence: `/tmp/vigil-sydney-audit-4af6611f-6dde-4325-8447-506a04ce7645.json` (0600). Provider identity logs: `.deployment/747240980964/ap-southeast-2/demo/offline/credential-probe-HlkPFZ/`. Bootstrap/demo offline runs: `800f9c94-4033-4e9a-9e98-90bd7db71f4d` / `15dd2105-3dec-40fe-92a4-57875998c690`; startup logs: `/tmp/vigil-startup-validation-Hzw6MF/`. Current ECS/RDS absence and bucket versioning were user-confirmed; additional inventory verified the absence of ALB, NAT, EIPs, interface endpoints, RDS snapshots and demo log groups/SSM parameters. No absence of unrelated EC2/EBS is claimed.

No new quote, runtime permission/admission test, remote init/locked plan, apply/destroy, browser/financial integration regression, public DNS/certificate test, sandbox API call, budget-delivery test, ARM64 or EC2 bootstrap test was performed. This task changes documentation only, with no dependency, schema, application, financial invariant, Terraform source, IAM policy or state changes. The historical reports remain intact.

Final documentation review: PASS, `node_modules/.bin/prettier --check README.md docs/phase15/README.md docs/phase15/sydney-redeployment.md`, `git diff --check` and relative Markdown link existence checks for those three files. The retained audit JSON and offline validation directories remain available. Browser-login, SCP and Terraform 1.15 S3-backend guidance was checked against the official references linked above. Earlier application/deployment checks were not repeated for this documentation-only completion; no new AWS account request was made.

Suggested commit: `docs(deploy): audit Sydney redeployment and document safe ephemeral runbook`
