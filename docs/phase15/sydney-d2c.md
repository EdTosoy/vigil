# Sydney D2C — bootstrap provisioned and verified

2026-10-27. **SUCCESS: exactly 12 creates, 0 updates, 0 deletes/replacements.** Only the approved new-account S3/ECR foundations were provisioned. No runtime, images, DNS, Stripe or state migration. No commit/push.

## Authorization, identity and budget

The user explicitly approved the unchanged twelve D2B creates: `edtosoy`, account `747240980964`, `ap-southeast-2`, exact assumed role `AccountFullAccessRole`. Existing STS guards passed initially, immediately before apply and during verification. Full ARN structure/session validity was checked; the rotating session identifier was not recorded. Free Plan was FREE / ACTIVE, USD 120 credits, expiry April 26, 2027. Actual creation succeeded without account upgrade or substitution; this proves admission for this bootstrap, not runtime services.

The USD 5 monthly COST budget `mdp-monthly-gross-usd-5` remains read-only, credits/refunds excluded and tax included, account-wide with no alternate billing view. The user confirmed in the Billing console: ACTUAL 50% / 80% / 100% = USD 2.50 / 4 / 5; FORECASTED 100% = USD 5. The API still omits units; console evidence resolves the earlier unit stop.

**Recipient inactive; risk explicitly accepted by the user. Alert delivery is not claimed.** This supersedes D2A's earlier delivery attestation for current readiness. No subscription or budget setting was repaired, imported or duplicated. Post-verification confirmed the gross configuration and returned notification values/types/comparisons unchanged.

## Plan and bounded execution

Infrastructure baseline: committed D2B `5d0a31eaa267e96182356253c3b75334aac35b47`. Tracked Terraform/lock sources are unchanged. The new `aws:bootstrap:execute` accepts no arguments or target/plan/state overrides. It uses the D2B fresh local planner, compares full managed changes and Terraform configuration with the checksum-pinned approved D2B binary, verifies exact source-manifest hashes, private paths/permissions, absent state/backend metadata, input/plan hashes and freshness, then rechecks STS and plan integrity immediately before one saved-plan apply. Existing general deployment, destroy, publication and migration gates remain unconditional.

The durable `first-bootstrap-execution.json` is claimed exclusively before apply and prevents reuse, including after partial failure. No automatic apply retry, remote initialization, migration, force-unlock or `-lock=false`. Normal local state locking and serial execution were retained. Execution used the saved plan, without an automatic replacement plan.

- Run: `7672de2b-8c20-4488-b356-68075ce9b0d5`.
- Plan SHA-256: `dfc78538a3f59485fdb4ca03bc91216d55772800e56d931116c9c09b5270a2a7`.
- Apply: **11:06:59–11:07:29 UTC**, exit 0, `12 added, 0 changed, 0 destroyed`.
- Original D2B SHA-256 used for semantic comparison: `a4090bcca4ca16450c1bbbbf08c1f17e8f5f1f1a7449bc14b0cfb5418fd8876f`.

Earlier authentication and budget-unit stops created zero resources. They were resolved by manual browser login and the user's explicit console confirmation/risk acceptance, not by bypassing Terraform identity/resource guards.

## Actual resources and security verification

All resources are in account `747240980964`, Sydney. All survive runtime teardown.

| Created Terraform resources                                        | Exact name / verified safeguards                                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `aws_s3_bucket.state`                                              | `flow-demo-tfstate-747240980964-ap-southeast-2`; expected-owner requests and Sydney location pass                                   |
| `aws_s3_bucket_ownership_controls.state`                           | Same bucket; BucketOwnerEnforced                                                                                                    |
| `aws_s3_bucket_public_access_block.state`                          | Same bucket; all four blocks true; policy status not public                                                                         |
| `aws_s3_bucket_versioning.state`                                   | Same bucket; Enabled                                                                                                                |
| `aws_s3_bucket_server_side_encryption_configuration.state`         | Same bucket; AES256 / SSE-S3                                                                                                        |
| `aws_s3_bucket_policy.state`                                       | Same bucket; exact HTTPS-only deny policy matches approved plan                                                                     |
| `aws_ecr_repository.image["admin"]`, `["ops"]`, `["stripe"]`       | `flow-demo/admin`, `flow-demo/ops`, `flow-demo/stripe`; exact new-account regional ARNs/URIs, AES256, IMMUTABLE, BASIC scan-on-push |
| `aws_ecr_lifecycle_policy.image["admin"]`, `["ops"]`, `["stripe"]` | Exact matching policies; only untagged remnants expire after seven days                                                             |

Read-only post-verification found all three repositories empty and exactly twelve managed state instances with the approved addresses/types, live names/account/region and lifecycle policies; recovery-copy bytes match authoritative state. Bounded inventory found zero ECS clusters, RDS instances, load balancers, NAT gateways, `/flow/demo/` SSM parameters and hosted zones, consistent with D2A's empty runtime baseline. No unfamiliar resource was deleted or imported. Verification passed with no partial failures or unexpected changes.

## State custody and recovery

Durable private run root:

```text
.deployment/747240980964/ap-southeast-2/bootstrap/plans/7672de2b-8c20-4488-b356-68075ce9b0d5/
```

Authoritative state: `work/terraform.tfstate`. Recovery copy: `state-custody-backup.tfstate`. Both are 0600 under the private namespace and gitignored; no state/plan was published. State serial **13**, lineage `ddd179f4-cd40-c3e8-b207-ef1348160a63`, SHA-256 `83a22793b582723d0849a1840a7236e4dd2c6d1aefdf7a332e4cca32ce956235`.

Keep state, backup, execution marker, receipt and logs together. A same-disk copy is not off-device disaster recovery. Do not remove the marker, rerun first bootstrap, destroy foundations, rewind/overwrite state or migrate it automatically. Future state migration needs separate review/approval of this exact lineage, bucket ownership/security and destination. Bootstrap/runtime keys remain separate. A future failure requires read-only inventory plus a reviewed recovery plan, never automatic retry or cleanup.

Private evidence: `plan-receipt.json`, `execution-result.json`, `post-verification.json`, `state-consistency.json`, `mutation-events.json`, `apply.log`, plan/inputs/source manifests. Do not publish raw plans/state/logs.

## Mutation ledger and verification

Existing CloudTrail management-event history was read only for S3/ECR in the exact apply window; no trail was enabled. Returned successful mutation events:

| Observed API action             | Successful events |
| ------------------------------- | ----------------: |
| `s3:CreateBucket`               |                 1 |
| `s3:PutBucketEncryption`        |                 1 |
| `s3:PutBucketVersioning`        |                 1 |
| `s3:PutBucketOwnershipControls` |                 1 |
| `s3:PutBucketPolicy`            |                 1 |
| `s3:PutBucketPublicAccessBlock` |                 1 |
| `ecr:CreateRepository`          |                 3 |
| `ecr:PutLifecyclePolicy`        |                 3 |

This is observed management-event evidence, not a complete wire/retry audit. No failed mutation event was returned. The bounded window/source query does not claim an account-wide mutation audit.

Current successful execution/verification made **34 direct read-only invocations**, including planner reads, final pre-apply STS and verification/event-history reads. Private ledgers record: STS GetCallerIdentity; Free Tier GetAccountPlanState; Budgets DescribeBudget/DescribeNotificationsForBudget; S3 HeadBucket/GetBucketLocation/GetBucketVersioning/GetBucketEncryption/GetPublicAccessBlock/GetBucketOwnershipControls/GetBucketPolicy/GetBucketPolicyStatus; ECR DescribeRepositories/GetRegistryScanningConfiguration/GetLifecyclePolicy/ListImages; ECS ListClusters; RDS DescribeDBInstances; ELB DescribeLoadBalancers; EC2 DescribeNatGateways; SSM DescribeParameters; Route 53 ListHostedZones; CloudTrail LookupEvents. Provider reads/polling are additional and not counted as CLI invocations. Earlier stopped D2C attempts made five read-only invocation attempts, separate from these 34. No historical-account request.

Targeted checks: **31 deployment tests passed**, including exact configuration drift, extra/missing/replaced/deleted resources, foreign identity/arguments and existing state/execution refusal. CLI tests use an isolated mocked checkout and cannot inspect real state. Deployment/root TypeScript and scoped ESLint passed; fresh Terraform formatting, backend-disabled init and validation passed through the actual planner. Repository/report formatting and `git diff --check` passed. Full workspace typecheck was not rerun; its previously documented generated Next.js duplicate-declaration limitation remains separate. No financial/schema changes.

## Costs and next step

Persistent planning baseline remains approximately **USD 0.25/month** after later image retention (2 billing GB ECR plus state/request allowance), before tax/unexpected usage; currently repositories are empty. Tagged images/versioned state can accumulate. Credits do not reduce gross-budget accounting, and an inactive recipient provides no working email warning. Budget is not a spending cap.

**GO for D3 preparation; NO-GO for runtime apply or automatic state migration.** See [D3 preparation](sydney-d3-preparation.md) for exact dated cost arithmetic, remaining image/backend/secret gates, manual DNS/Stripe steps and teardown command intents. Runtime creation requires a separate concrete plan and approval. No runtime, image publication, DNS/Stripe mutation, account upgrade, state migration, commit or push occurred.

Files changed: `tools/bootstrap-execute.ts`, `package.json`, `tests/bootstrap-plan.test.ts`, `infra/AGENTS.md`, this report and `sydney-d3-preparation.md`. Terraform/financial/schema sources were not changed.
