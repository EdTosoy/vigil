# Sydney D3E — role diagnosis and non-deployable preview

**2026-10-28 follow-up: the explicitly approved planning role and inline policy are created and verified, including a restricted session.** See [creation evidence below](#approved-role-creation-and-verification). Remote saved-plan generation remains pending planner integration with that role. No Terraform plan was generated in this follow-up.

Historical diagnosis: 2026-10-28 local date; AWS observations 2026-10-27 UTC. Diagnosis complete, local preview successful, zero AWS mutations at that stage. Existing private inputs and failed execution evidence remain preserved. No commit/push.

## Root cause

I found and corrected a planner bug: it constructed `arn:aws:iam::747240980964:role/AccountFullAccessRole` from the STS role name. Authoritative `iam:GetRole` returned **`arn:aws:iam::747240980964:role/managed/AccountFullAccessRole`**. STS assumed-role names do not establish the IAM role path; the original request targeted the wrong ARN.

Correcting that path alone cannot enable the intended session. The actual role's entire trust policy allows **only** service principal `account-access.amazonaws.com`, actions `sts:AssumeRole` and `sts:SetContext`. It does not trust its own IAM principal. [AWS requires explicit trust for self-assumption](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_update-role-trust-policy.html).

| Control                    | Live evidence                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller                     | Existing guard passed: account `747240980964`, profile `edtosoy`, region `ap-southeast-2`, role `AccountFullAccessRole`; no session suffix retained |
| Identity permissions       | Only attached policy is AWS `AdministratorAccess`, default v1, Allow all actions/resources; no inline policies                                      |
| Permissions boundary       | None attached, per GetRole                                                                                                                          |
| Identity-policy simulation | `sts:AssumeRole` on the actual `/managed/` ARN: allowed; returned Organizations decision also allowed                                               |
| Target trust               | Service-only, no AWS self-principal; incompatible with the proposed self-assumption                                                                 |
| Original error             | Retained sanitized `AccessDenied / Cannot assume IAM Role / AssumeRole`, with the wrong requested ARN in the private backend artifact               |

A bounded Sydney CloudTrail lookup found no matching original denial event; its full raw SDK diagnostic was intentionally not retained. No other-region lookup or AssumeRole retry was made. The wrong ARN and incompatible trust are confirmed; current session/SCP restrictions were not exhaustively enumerated. Identity simulation does not simulate the target role's trust or prove live admission, as [AWS documents](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html).

The planner now preserves the verified IAM path and performs an early read-only trust check before any self-assumption attempt. It fails clearly for the observed service-only trust. **Do not edit this browser-login role's trust or add identity permissions as a workaround.** The exact Sydney lock-only authorization remains valid.

## Reviewed IAM proposal — historical approval material

Create a separate **backend-only** role:

```text
RoleName: VigilSydneyRuntimePlanRole
Path: /vigil/
ARN: arn:aws:iam::747240980964:role/vigil/VigilSydneyRuntimePlanRole
MaxSessionDuration: 3600 seconds (planner requests 15 minutes)
Inline policy: VigilSydneyRuntimePlanLockOnly
```

At diagnosis, `GetRole(VigilSydneyRuntimePlanRole)` returned NoSuchEntity; no creation was attempted until the separately approved follow-up below.

- [Exact trust policy](../../../infra/planning-role/trust.proposed.json): only the existing `/managed/AccountFullAccessRole` principal, with `sts:RoleSessionName` matching `vigil-d3e-*`. No account-root wildcard, service or cross-account trust.
- [Exact permissions policy](../../../infra/planning-role/permissions.proposed.json): read only the runtime state and lock objects, bucket location and restricted `demo/*` / `env:/*` discovery; caller-identity read; conditional PutObject and DeleteObject only for `demo/terraform.tfstate.tflock`. Explicit denies cover state/foreign writes, nonconditional lock puts and every other mutation. No workload/deployment permissions or managed policy attachment.
- Native Terraform lock-ID ownership checks and fixed wrapper commands govern normal release; IAM DeleteObject alone cannot distinguish owned release from force-unlock. The wrapper continues to prohibit force-unlock and arbitrary commands.
- The new role is only for the S3 backend. The initial caller remains the existing exact `edtosoy` identity. No new user, long-term key, default profile, existing-role permission change or unrestricted remote-locking fallback is proposed.

This proposal reuses the existing named-operation lock policy, narrowed for bucket discovery; it is not a deployment policy inferred from application resources. Official S3 service-reference metadata confirmed GetObject/ListBucket/GetBucketLocation/PutObject/DeleteObject and the scalar String `s3:if-none-match` key. Read-only AWS IAM custom simulations confirmed: conditional lock Put and lock Delete allowed; state Get allowed; state Put/Delete explicitly denied even with the conditional header; nonconditional lock Put and other mutations denied; `env:/` discovery allowed and bootstrap discovery denied. Simulations are not actual S3 operations or proof of future role admission. Initial CLI list-serialization simulation requests were rejected with ValidationError; corrected structured requests were evaluated, with exact-resource checks resolving aggregate mixed-resource results.

Approval binds these current policy files:

```text
trust.proposed.json       54d5d808e2e3e814240ca586275d7d8bf64176516c0ba9b555879a363676d6b8
permissions.proposed.json 8363956664cefae06f41839d6f9fe9ff3e15f9e43579cd3c3bfcaaa7d0ab782c
```

Only **two IAM mutation API operations** would be requested: `iam:CreateRole` for that new role, then `iam:PutRolePolicy` for that one inline policy. No UpdateAssumeRolePolicy or change to AccountFullAccessRole. No automatic cleanup after a partial failure. The planning role would be a separately owned persistent foundation, outside the approved twelve-resource bootstrap state and disposable runtime; no import/migration is proposed. Future cleanup needs its own IAM scope.

The concrete commands below were **approval-review material**, not authorization. The subsequent explicit user instruction authorized only CreateRole and PutRolePolicy; execution omitted the proposed tags, avoiding any additional tagging permission or operation:

```sh
aws iam create-role --profile edtosoy --region ap-southeast-2 \
  --role-name VigilSydneyRuntimePlanRole --path /vigil/ \
  --max-session-duration 3600 \
  --description 'Vigil Sydney Terraform backend planning only; no state writes' \
  --assume-role-policy-document file://infra/planning-role/trust.proposed.json
aws iam put-role-policy --profile edtosoy --region ap-southeast-2 \
  --role-name VigilSydneyRuntimePlanRole \
  --policy-name VigilSydneyRuntimePlanLockOnly \
  --policy-document file://infra/planning-role/permissions.proposed.json
```

After explicit approval, recheck identity/absence, create and verify only that role/policy, then separately wire its exact ARN into the bounded backend contract and tests. Retain the failed preparation/claim and reuse the existing password in a fresh preparation. Do not ask again for the same S3 lock authorization. A real saved plan still needs fresh backend/state/image validation. Runtime provisioning/state-write approval remains separate.

## Explicit local preview

`AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:runtime:preview` succeeded using Terraform 1.15.3 and provider 6.68.0. It copies only allowlisted committed sources into a fresh private `previews/` namespace, deliberately omits `backend.tf`, uses separate TF_DATA_DIR and `init -backend=false`, then runs normal locally locked `plan -json` **without `-out`**. It reuses the existing in-memory administrator input and exact immutable images with services/DNS activation false. It does not consume the failed remote preparation or connect to S3 state.

Result: **75 creates, zero updates, replacements or deletes**. These are proposed actions, not actual mutations.

| Group                                        | Proposed resources |
| -------------------------------------------- | -----------------: |
| VPC, subnets, routing, security groups/rules |                 41 |
| Private RDS instance/subnet/parameter groups |                  3 |
| Initial admin URL SecureString parameter     |                  1 |
| ECS cluster/task definitions                 |                  6 |
| Runtime IAM roles/inline policies            |                 15 |
| CloudWatch log groups                        |                  5 |
| ALB and target groups                        |                  3 |
| ACM certificate request                      |                  1 |

No ECS services/listeners, NAT, Route 53 zone or duplicate budget are in the preview. The proposed backend-only planning role is **not** part of these 75 runtime resources. Runtime source remains private Single-AZ PostgreSQL, strict TLS, digest-pinned non-root X86_64 tasks and NAT-free networking. This UI inventory is not full saved-plan JSON/security approval or a remote conflict/state assessment.

Private sanitized review:

```text
.deployment/747240980964/ap-southeast-2/demo/previews/
  af92058e-6c8a-42bd-b762-d7af3d041182/preview-review.json
SHA256: 7a221e9b6e7c7db342a4163ab63f4477962a923ee7ef4de7f0264eea5849fe9d
```

This is a 0600 **NON_DEPLOYABLE_LOCAL_BACKEND_PREVIEW** JSON artifact, not a Terraform binary plan/hash. No executable plan or persisted local state was produced. It cannot be promoted to a remote-plan receipt or used for provisioning. No RDS endpoint, financial mapping, Stripe credential or ACM token was invented.

## Verification and stop

- PASS: 54 deployment safety tests, including role-path/service-trust regression, backend/state injection refusal and non-executable preview checks.
- PASS: actual local preview formatting, isolated backend-disabled init, validation and live read-only plan; 75-create UI inventory.
- PASS: deployment TypeScript, scoped lint/formatting and `git diff --check`. Root Next.js typecheck was not repeated.
- Bootstrap state/recovery remain unshared 0600 files with original SHA-256 `83a22793b582723d0849a1840a7236e4dd2c6d1aefdf7a332e4cca32ce956235`. Existing private password and failed remote preparation remain intact.
- AWS account operations were read-only STS GetCallerIdentity; IAM GetRole/ListAttachedRolePolicies/ListRolePolicies/GetPolicy/GetPolicyVersion/SimulatePrincipalPolicy/SimulateCustomPolicy; CloudTrail LookupEvents; and provider read-only metadata queries during preview. All account calls used the guarded Sydney `edtosoy` target; the historical account was never contacted. SDK per-request tracing was not enabled. No AssumeRole retry, S3 object operation, IAM mutation, resource creation, secret/DNS/Stripe change, remote init, migration, apply/destroy, commit or push occurred in this follow-up.

The diagnosis stopped pending approval of the one named role and inline policy. That approval and execution are recorded below; existing lock-only approval remains preserved and unexercised.

## Approved role creation and verification

Executed 2026-10-28 UTC using only profile `edtosoy`, account `747240980964`, region `ap-southeast-2`, exact caller role `AccountFullAccessRole`. The named profile contains only Sydney region and browser-login configuration; no inherited AWS/Terraform credential, profile, endpoint or region overrides were present. STS identity was checked immediately before each mutation. The AWS connector cannot select this local profile, so execution used AWS CLI 2.34.24 with explicit profile/region and automatic request retries disabled.

Both reviewed policy files retained their approval-bound SHA-256 values above. Preflight GetRole and GetRolePolicy both returned NoSuchEntity. The original administrator role's configuration, trust, boundary, attached policies, inline policies and attached managed-policy default document/version were captured before execution and compared after it.

Policy/API review used the official [CreateRole](https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateRole.html), [PutRolePolicy](https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutRolePolicy.html), [IAM/STS condition-key](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html) and [S3 conditional-write](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html) references. The reviewed policies were not edited.

Exactly two AWS mutation requests succeeded, once each:

1. `iam:CreateRole`: `VigilSydneyRuntimePlanRole`, path `/vigil/`, created **2026-10-28T03:46:28Z**, reviewed trust document, maximum session duration 3600 seconds, description as reviewed, no tags or permissions boundary.
2. `iam:PutRolePolicy`: only `VigilSydneyRuntimePlanLockOnly`, with the unchanged reviewed permissions document.

Verified role ARN:

```text
arn:aws:iam::747240980964:role/vigil/VigilSydneyRuntimePlanRole
```

| Read-only verification                      | Result                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| GetRole ARN, path and maximum duration      | PASS: exact ARN, `/vigil/`, 3600 seconds                                                                                                 |
| Retrieved trust policy                      | PASS: parsed JSON equals the reviewed file; only `/managed/AccountFullAccessRole`, AssumeRole, `vigil-d3e-*`                             |
| GetRolePolicy and ListRolePolicies          | PASS: exact reviewed permissions JSON; exactly the one named inline policy                                                               |
| ListAttachedRolePolicies                    | PASS: empty; no managed policies attached                                                                                                |
| Original AccountFullAccessRole              | PASS: before/after configuration and policy comparison equal; its service-only trust and AdministratorAccess attachment remain unchanged |
| Restricted AssumeRole and GetCallerIdentity | PASS: one 900-second `vigil-d3e-*` session admitted as the new role                                                                      |
| Restricted S3 reads                         | PASS: Sydney bucket location and `demo/` / `env:/` listings; both listings returned zero keys                                            |
| Restricted negative read probes             | PASS: IAM GetRole and S3 `bootstrap/` listing returned expected AccessDenied                                                             |

Role/policy verification completed at **03:47:27Z**; session verification completed at **03:47:48Z**. No IAM propagation delay or unexpected permission denial was observed; no IAM mutation or AssumeRole retry occurred. The initial sandbox STS attempt could not reach its endpoint; the same profile succeeded with network permission. A local snapshot-file handling error occurred before any mutation. CreateRole succeeded but omitted MaxSessionDuration from its response, causing a local response check to stop; subsequent GetRole verified the stored 3600-second value before policy attachment. Neither local issue caused an extra mutation request.

Private, gitignored comparison evidence is retained under `.deployment/747240980964/ap-southeast-2/demo/planning-role-verification-20261028T034628Z/`, directory mode 0700 and files 0600. Temporary session credentials were used only in memory and child-process environment; none were printed or persisted. No state payload was fetched. State-write and lock-write denial/allowance remain policy inspection and the earlier simulation evidence, rather than actual write probes.

**Remaining D3E blocker:** `tools/runtime-plan.ts` still targets the browser role for backend self-assumption and retains its self-trust guard. Wiring the verified planning-role ARN into the bounded backend contract and tests is a separate follow-up. Preserve the failed claim and existing password; any later authorized attempt requires fresh preparation and backend/state/image validation. Role admission alone does not verify Terraform backend compatibility or produce a saved plan.

Local verification: PASS, repository-installed `node_modules/.bin/prettier --check` on both updated D3E documents and both unchanged policy files, policy SHA-256 comparison, private evidence Git exclusion and `git diff --check`. The initial `pnpm exec prettier` invocation produced no output and was interrupted; the installed formatter was then invoked directly. Application/deployment tests were NOT RUN because only documentation changed locally; no application, schema, financial invariant or planner implementation changed.

Stopped after IAM/session verification and documentation. Zero S3 PutObject/DeleteObject requests, state writes, lock operations, Terraform runs, runtime infrastructure, DNS/Stripe changes, Free Plan upgrades, commits or pushes in this follow-up. No administrator-role modification or other IAM mutation occurred. The planning role remains a separately owned persistent foundation outside bootstrap/runtime Terraform state; future cleanup requires separate authorization.
