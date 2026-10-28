# Sydney recovery teardown — saved proposal, not executed

Prepared 2026-10-28 for account `747240980964`, profile `edtosoy`, region `ap-southeast-2`, bucket `flow-demo-tfstate-747240980964-ap-southeast-2`, key `demo/terraform.tfstate`.

The separate `tools/runtime-recovery.ts` command supports **plan and review only**. It does not add apply/destroy execution, state push, import, force-unlock or deletion APIs. The existing release/teardown guards are unchanged and still reject the original-to-expanded state transition. The unrelated staged `nx.json` edit is preserved.

## Verified live state and scope

The original version identified by the first-apply receipt has serial **3**, **75 managed instances**. The fetched current version has serial **5**, **90 managed instances**, with the **same lineage**. Recovery accepts only this explicit transition, not arbitrary later serials or supersets. It validates exact addresses, provider/root ownership, original physical IDs (except explicitly validated ECS task-definition family revisions), ARN account/region, ownership tags where present, and service/cluster/task, listener/ALB and certificate relationships.

The additions are eight runtime SSM parameters, three ECS services, certificate validation, two ALB listeners and one listener rule. This expansion is reviewed independently of the unchanged original guard.

| Affected Terraform type             | Deletions |
| ----------------------------------- | --------: |
| aws_acm_certificate                 |         1 |
| aws_acm_certificate_validation      |         1 |
| aws_cloudwatch_log_group            |         5 |
| aws_db_instance                     |         1 |
| aws_db_parameter_group              |         1 |
| aws_db_subnet_group                 |         1 |
| aws_ecs_cluster                     |         1 |
| aws_ecs_service                     |         3 |
| aws_ecs_task_definition             |         5 |
| aws_iam_role                        |        10 |
| aws_iam_role_policy                 |         5 |
| aws_internet_gateway                |         1 |
| aws_lb                              |         1 |
| aws_lb_listener                     |         2 |
| aws_lb_listener_rule                |         1 |
| aws_lb_target_group                 |         2 |
| aws_route                           |         1 |
| aws_route_table                     |         2 |
| aws_route_table_association         |         4 |
| aws_security_group                  |         7 |
| aws_ssm_parameter                   |         9 |
| aws_subnet                          |         4 |
| aws_vpc                             |         1 |
| aws_vpc_security_group_egress_rule  |        12 |
| aws_vpc_security_group_ingress_rule |         9 |
| **Total**                           |    **90** |

Every change is delete-only and its physical ID matches the frozen live snapshot. The exact allowlist excludes state buckets/history, ECR repositories/images, budgets, DNS and unrelated resources, backend/browser roles and account-level IAM foundations.

## Saved plan and next review

```text
.deployment/747240980964/ap-southeast-2/demo/recovery-teardown/
  c83ca63d-73cd-46cd-b795-2405d7374529/destroy.tfplan
SHA256: a920653991760e3dfb1048b56395fbbdc4544a173e1a5a764d0b84fa031f4bc7
```

Plan, both exact versioned state snapshots, copied deployed sources/activation inputs and sanitized receipts are private 0600 files under a fresh owner-only workspace. Raw Terraform output and state/secret values were not printed. Existing secret values were reused only in the Terraform child environment; no credentials were regenerated. Deployed source hashes match the retained deployment manifest; no production Terraform source was edited.

Next command is **read-only review**, not deletion:

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 node --import tsx tools/runtime-recovery.ts review --reviewed c83ca63d-73cd-46cd-b795-2405d7374529:a920653991760e3dfb1048b56395fbbdc4544a173e1a5a764d0b84fa031f4bc7
```

Review rechecks exact caller/environment, binary/source/input/snapshot/code hashes, remote state version/ETag, absent lock and a 15-minute freshness limit. Changed state or expired plans require a newly prepared plan, not an edited receipt. `pnpm aws:runtime:recovery` is the equivalent script entrypoint. There is no recovery execution subcommand.

## Safety findings and limitations

- The profile initially had an expired login. Work resumed only after the operator refreshed `edtosoy` and exact STS checks passed; no fallback identity was used.
- Backend operations use verified `VigilSydneyRuntimePlanRole` with its exact lock-only policy, which explicitly denies state-payload writes. Backend STS responses during init/plan confirmed the restricted session. Provider refresh reads retain the approved browser identity.
- Before/after state version, ETag and full state-key version/delete-marker inventories match. Exactly one new `.tflock` version and one owned-release delete marker appeared; no state payload/history changed. No infrastructure deletion, state write, DNS/Stripe action or commit occurred.
- **Do not apply this binary.** Its embedded backend cannot persist the intermediate/final state necessary for safe deletion. A future explicitly authorized execution workflow needs a fresh state-write-backed recovery plan, the same 90-resource and drift checks, and concrete review/approval. Do not bypass the original 75-resource guard or execute a local-state workaround.
- Future deletion removes the AWS dashboard and Stripe ingress, its services, secrets and disposable database. Live RDS settings have `skip_final_snapshot=true` and zero backup retention: deletion would discard data. This task does not retire Stripe destinations or edit DNS; those remain separately authorized actions.
- Runtime resources remain running/billable. This proposal is not evidence of teardown or stopped charges. Inactive task-definition metadata, retained state/history, ECR, budgets and account-level foundations are outside the deletion set.

## Executed verification

- PASS: 14 focused recovery/original-release tests, including extra/foreign resources, serial/lineage/physical-identity drift, stale/future reviews, deletion-only inventory and rejection of execution commands.
- PASS: deployment TypeScript (`tsc -p tsconfig.check.json --noEmit`), scoped ESLint, Prettier and `git diff --check`.
- PASS: actual Terraform 1.15.3 version/fmt/init/validate/refreshing destroy-plan/show; all exit zero. Exactly 90 deletes validated against the protected live snapshot.
- PASS: read-only saved-plan review and unchanged remote state/history proof.
- NOT RUN: destruction or state persistence; no execution capability was added. No financial/schema/application behavior changed.
