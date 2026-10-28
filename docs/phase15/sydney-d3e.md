# Sydney D3E — bounded runtime planner, permission stop

Follow-up: [IAM diagnosis and local preview](sydney-d3e-session-diagnosis.md) identifies the missing `/managed/` path and service-only role trust. The path bug is corrected with an early trust guard; a separate backend-only role is proposed for approval. A real **non-deployable local preview** now reports 75 creates. No remote saved plan exists; the execution evidence below describes the earlier denied attempt.

2026-10-28, infrastructure source `c7c68e1`. **Saved-plan generation: BLOCKED. NO-GO for runtime provisioning.** STS authentication now passes; backend initialization was refused when AWS denied the restricted same-role session. No saved runtime plan/hash exists. No commit/push.

## Result and exact blocker

Existing preflight verified profile `edtosoy`, account `747240980964`, region `ap-southeast-2`, exact assumed role `AccountFullAccessRole` and no inherited credential conflicts. No individual session suffix is recorded. The previous authentication stop is resolved.

The new executor attempted the initial plan using the existing private preparation. Its backend must assume `arn:aws:iam::747240980964:role/AccountFullAccessRole` with a restrictive temporary session policy. AWS returned **AccessDenied / Cannot assume IAM Role / AssumeRole** during `terraform init`. The role's permissions/trust do not admit this attempted restricted session; the precise policy/trust cause was not investigated or changed. No fallback or retry occurred. This is a permission/session-access blocker, not a request to renew the existing S3 lock approval.

Terraform version/fmt passed. Remote backend initialization did **not** complete; live validation, planning and saved-plan inspection were not reached. Resource creates/updates/replacements/deletes and a plan-derived cost/security review are therefore **unavailable**, rather than a zero-change plan. The source-derived initial allowlist contains 75 expected creates, but that is not a generated resource proposal.

## Bounded implementation and custody

`AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:runtime:plan` now invokes only `tools/plan-runtime.ts` / `tools/runtime-plan.ts`, with no arguments or target/command overrides. It:

- Reuses exactly one unclaimed preparation, existing source manifest/non-secret tfvars and validated in-memory `admin_password`. It never regenerates credentials. Source, private inputs, Git exclusion, backend and fresh-state conditions are checked; committed-source and revision checks also protect future attempts.
- Pins Terraform 1.15.3, provider lockfile, exact Sydney backend/account/profile, default workspace and all three D3A immutable ECR references. Initial flags remain `initial_infrastructure_only=true`, `defer_webhook_secret=true`, `start_services=false`, `certificate_dns_confirmed=false`; no endpoint or financial binding is invented.
- Allows only fixed version/fmt/init/validate/plan/show argv. No apply/destroy/import/migration/unlock/workspace operation, arbitrary argument or `-lock=false` exists. Existing general provisioning wrappers remain disabled.
- Requires a same-role temporary backend session, with explicit denies on state payload/foreign object writes, other mutations, and lock puts without `If-None-Match: *`. Only native conditional lock creation and normal same-owned-lock release can proceed. No IAM resource/policy attachment was created or modified. See [Terraform backend session policy support](https://developer.hashicorp.com/terraform/language/backend/s3), [AWS session-policy evaluation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#policies_session) and [S3 conditional-write conditions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html). Policy semantics passed local negative tests; AWS never admitted the restricted session here.
- Uses owner-only directories/files and retains a one-use execution claim even on failure. Raw AWS/Terraform output, administrator password, credentials and plan JSON are not printed or written to logs. Only fixed diagnostic labels/status are retained. A successful future proposal must pass exact create-only inventory, image, TLS, private-RDS, task, IAM-trust and disabled-service checks before receiving a private SHA-256 review receipt.

Preparation retained unchanged:

```text
.deployment/747240980964/ap-southeast-2/demo/plan-preparation/
  4651c1f3-45eb-4abf-80f5-95c700f457e1/
```

Its eleven source hashes still match current infrastructure and copied work files. `plan-execution.json`, `plan-backend.tfbackend.json`, `init-result.json` and `aws-evidence.json` are private/gitignored. `runtime.tfplan` does not exist. The prepared password remains in its original private store and was not passed to Terraform, because the plan operation was never reached.

Bootstrap authoritative state and recovery copy retain SHA-256 `83a22793b582723d0849a1840a7236e4dd2c6d1aefdf7a332e4cca32ce956235`, regular/unshared 0600 files with unchanged size/mtime. No bootstrap state migration or modification occurred.

## Live evidence and mutation boundary

Verified before initialization: expected bucket owner and Sydney location; runtime state/lock absent; no prior runtime state versions/delete markers; all three exact D3A image digests exist and their manifest hashes match. No publication occurred.

After the denied initialization, bounded read-only checks again found state/lock absent. Before/after `demo/` version inventories were both empty: **zero object versions, zero delete markers**. Thus no lock creation/release or state payload write/delete occurred. Bootstrap custody also matched. No AWS infrastructure mutation command was run; backend stopped at role assumption, before resource planning/provisioning.

| API action                                            | Resumed attempt evidence                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `sts:GetCallerIdentity`                               | 3 successful direct CLI invocations, including standalone preflight                    |
| `s3:HeadBucket`                                       | 1, read-only, expected owner                                                           |
| `s3:GetBucketLocation`                                | 1, read-only, Sydney                                                                   |
| `s3:HeadObject`                                       | 6, read-only, expected 404 absence across pre/postchecks                               |
| `s3:ListObjectVersions`                               | 2, read-only, matching empty inventories                                               |
| `ecr:BatchGetImage`                                   | 3, read-only, exact digest/manifest verification                                       |
| `sts:AssumeRole`                                      | Backend SDK authentication attempt denied; SDK invocation/retry count was not captured |
| `s3:PutObject`, `s3:DeleteObject`                     | **0**; authorized lock operations were never reached                                   |
| Infrastructure, secrets, DNS, Stripe, image mutations | **0**                                                                                  |

Direct CLI total is 16; backend SDK authentication is listed separately. No historical account was contacted. This is evidence of this workflow, not a general account-wide audit of other actors.

## Security, cost and checks

Runtime source remains private encrypted Single-AZ PostgreSQL 18.6 / `db.t4g.micro` / 20 GiB gp3, strict Sydney RDS CA verification, NAT-free public task networking with private database ingress, X86_64 non-root digest-pinned task definitions, narrowly scoped execution policies and owner-free runtime roles. No ECS service or ALB listener is proposed in the initial stage; actual rendered-plan security remains unverified because no live plan exists.

No runtime cost was started. The dated [D3B four-hour model](sydney-d3b.md) remains approximately **$1.33 gross**, including its session and monthly retention allowances, against the proposed $2 envelope; this is not a fresh live-plan estimate or a guaranteed spending cap. Existing ECR/state storage and read-request costs remain applicable; no new persistent resource was created. Budget email delivery is not claimed.

| Check                                                                                                                                                                                                                           | Result                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Deployment safety suite, including six new executor negative-test groups                                                                                                                                                        | PASS, 50 tests                                |
| Wrong account/profile/region, credential conflicts, foreign buckets/keys/policy, state/other writes, nonconditional puts, extra commands, stale state/plan/preparation, updates/deletes/replacements, unsafe plan configuration | Rejected in deterministic tests               |
| Terraform formatting, separate isolated backend-disabled init, validation and mock-provider plans                                                                                                                               | PASS, 15 mocked plans; no remote retry        |
| Deployment TypeScript and scoped ESLint                                                                                                                                                                                         | PASS                                          |
| Scoped formatting and `git diff --check`                                                                                                                                                                                        | PASS                                          |
| Live saved-plan generation/hash/security/cost inspection                                                                                                                                                                        | BLOCKED at restricted-session permission gate |

Full root lint/Next.js typecheck was not repeated; prior documented limitations remain. Tests establish local policy/guard behavior, not successful AWS admission or provisioning permissions. New source/tests have not been committed. Changed files: `tools/runtime-plan.ts`, `tools/plan-runtime.ts`, `tests/runtime-plan.test.ts`, private input read/status support in `tools/runtime-inputs.ts`, source-name reuse in `tools/deployment-sources.ts`, package command/test registration, `infra/AGENTS.md`, and this report. No Terraform resource definitions, financial code, schemas or images changed.

## Next step

**Stop here.** Separately review the denied same-role session capability and its IAM/trust constraints before another live attempt; do not automatically add permissions, alter trust, create a role or use unrestricted backend credentials. Browser login is not the current blocker. Existing exact lock-only authorization remains valid.

After that blocker is explicitly resolved, retain the failed claim/evidence and create a fresh preparation with the existing password:

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:runtime:inputs prepare-plan
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:runtime:plan
```

Do not run these as a retry now. Any successful D3E proposal embeds the restrictive backend policy; it must never be applied as-is. Later provisioning needs separately authorized state-write capability and a freshly generated/compared plan before approval, preventing resource creation followed by failed state persistence. Runtime apply, ACM/DNS, credentials/provisioning, Stripe registration, activation and teardown remain separate unapproved stages.
