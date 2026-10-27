# Sydney D1A — identity guards and local isolation

Implemented locally on 2026-10-27. This increment adds exact STS verification, isolated artifact/backend/receipt contracts and deterministic negative tests. It does not retarget Terraform resources or establish Sydney deployment readiness. No real AWS API call, Terraform command, image publication, cloud migration, Stripe request or DNS modification was made for D1A. No commit or push was made. The operator owns the Commit checkpoint after review; stop here before D1B.

The approved target is profile `edtosoy`, account `747240980964`, region `ap-southeast-2`, STS assumed role `AccountFullAccessRole`. The account is on the Free Plan, with a $5 gross monthly budget, $120 credits observed at D0 and expiry April 26, 2027. These are dated planning inputs, not refreshed billing evidence. No account upgrade or budget-management operation is authorized.

## Manual browser login and safe preflight

The operator must complete browser login manually, selecting the new account and role. Do not export keys/tokens or change credential files to work around authentication. [AWS browser-login documentation](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html) describes temporary credentials and named-profile login.

```sh
# Manual prerequisite; Codex did not run this or change ~/.aws.
aws login --profile edtosoy --region ap-southeast-2

# Explicit profile AND region are required. These perform only STS GetCallerIdentity.
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:deploy preflight
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo preflight
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:observe preflight

# Optional local-only preparation, after STS: creates one private JSON contract per root.
# Does not invoke Terraform or create a bucket. Refuses to overwrite an existing file.
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:deploy prepare-backend-contract
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo prepare-backend-contract
```

Expected authoritative [STS response](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html): string `Account` exactly `747240980964`, a nonempty string `UserId`, and ARN exactly shaped as `arn:aws:sts::747240980964:assumed-role/AccountFullAccessRole/<session>`. Partition, service, empty region, account and role are parsed as complete fields; the session can rotate and must be a valid 2–64 character session name. Preflight reports only the stable target, root and local artifact path, never credentials or the session ARN. Failed CLI stdout/stderr is discarded, and generic unexpected errors are redacted.

Rejected configurations include missing/default/historical profiles, `iamadmin-general`, account `163596511125`, `us-east-1`, root or IAM users, other/prefix/suffix roles, alternate partitions, malformed identities and account/ARN disagreement. Missing or expired credentials fail closed without interactive login. Inherited static/session/web/container/role credentials, custom credential/config/login-cache paths, endpoint/CA overrides and all `TF_*`/`TERRAFORM_*` overrides are rejected, including empty overrides. `AWS_DEFAULT_PROFILE` and `AWS_DEFAULT_REGION`, if present, must agree. D1A commands reject extra arguments. Configured AWS service endpoints are ignored for the STS invocation. No implicit profile or region fallback is allowed.

Global Budgets/Free Tier/Pricing read endpoints may require `us-east-1` in a later separately scoped read-only implementation. There is no such exception in this deployment gate and no permission to launch workloads outside Sydney.

## Local isolation

Every deployment root uses `.deployment/747240980964/ap-southeast-2/{bootstrap,demo}/`. The `demo` namespace is the disposable runtime; observers use that same namespace. The shared legacy `.deployment/*` files and `infra/**/.terraform`, local state and generated backends remain untouched and are never fallback inputs.

| Artifact                                  | Location inside each root namespace                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| Terraform configuration/seed working root | `work/` (reserved; no source copied in D1A)                                     |
| Terraform cache/backend working metadata  | `terraform-data/`, future internally selected `TF_DATA_DIR`                     |
| Backend contract                          | `backend.s3.tfbackend.json`                                                     |
| Plan and receipt                          | `bootstrap.tfplan` / `bootstrap-plan.json`, or `demo.tfplan` / `demo-plan.json` |
| Inputs, environment and secrets           | root-specific `*.tfvars.json`, `environment.env`, `demo-secrets.json`           |
| Image manifest, observations and logs     | root-specific JSON/log files; Docker auth under `demo/docker/`                  |
| Cycle history and reset evidence          | `demo/history/<cycle>/`                                                         |

New contract directories are owner-only `0700`; the file is created exclusively at `0600`. Preparation refuses pre-existing permissive or foreign-owned target directories rather than repairing them. Paths reject traversal, absolute inputs, symlink components, special files and hard-linked files. These local checks assume an operator-controlled filesystem; they do not sandbox a malicious concurrent local user. No preflight failure writes an error file into a legacy/shared namespace. Existing `.deployment/` and state/plan ignores cover all private artifacts; `*.tfbackend` and `*.tfbackend.json` are also ignored.

The D1A receipt contract binds plan bytes, source/input hashes, durable state identity, apply/destroy intent, account/region/profile/role, root, absolute work/cache/plan paths, exact backend and default workspace. Legacy, changed, stale, cross-root and cross-checkout receipts are refused; bootstrap destroy receipts are forbidden. Receipt validation is not a signature or deployment authorization. D1A tests these contracts and file readers locally; the old plan/apply bodies are deliberately unreachable. D1B must wire them to actual fresh source/input/state evidence and recheck STS immediately before any future mutation. A cached identity receipt cannot authorize an apply.

## New state design, not provisioned

The proposed bucket is `flow-demo-tfstate-747240980964-ap-southeast-2`, with `bootstrap/terraform.tfstate` and `demo/terraform.tfstate` as separate keys. The exact backend contract selects `edtosoy`, `ap-southeast-2`, `allowed_account_ids=["747240980964"]`, `encrypt=true` and `use_lockfile=true`. Unknown backend fields, alternate keys/profiles/accounts/regions, credential literals or missing configuration fail closed. Only the default Terraform workspace is intended. [HashiCorp's S3 backend documentation](https://developer.hashicorp.com/terraform/language/v1.15.x/backend/s3) specifies encryption/account guards, native locking and recommends versioning.

Future bucket provisioning must enforce versioning, AES256 encryption, all public-access blocks, bucket-owner enforcement and HTTPS-only access. Provider restrictions must independently enforce the new account/region. Explicit ownership checks must confirm the bucket belongs to this account before connecting; allowed caller accounts alone do not prove bucket ownership. Nothing in D1A verifies an actual bucket or its properties.

D1B must populate isolated working roots using an explicit allowlist of intended Terraform sources, tests and pinned lockfiles. Never copy ignored generated backends, `.terraform`, state, plans, tfvars or secrets from `infra/`. The historical source roots still encode the historical account/provider/backend; neither an empty new directory nor a new bucket authorizes invoking them. Fresh bootstrap must eventually begin with new local seed state and migrate only that new lineage into its new bucket after approval, refusing an existing destination. No old state copy/download/import/migration, lineage replacement, force-unlock or remote init is authorized here.

## Protected and disabled commands

Each wrapper performs STS preflight before reaching any legacy body, and its child-command executor has a second unconditional D1B gate. All legacy commands then fail with a clear disabled message. Unknown operations and teardown attempts also fail closed. There is no bypass flag or automatic fallback to the historical target.

| Entry point        | Disabled workflows pending D1B and later authorization                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm aws:deploy`  | bootstrap plan/apply, DNS plan/verification, connect, remote init and state migration; bootstrap destruction remains forbidden                                                                                                             |
| `pnpm aws:demo`    | prepare/secret generation, image build/publication, runtime plan/apply/destroy, one-shot remote migration/provisioning/tasks, service enablement, Stripe destination/payment/backfill/proof, retirement, reset/history cleanup and outputs |
| `pnpm aws:observe` | deployed observation, state reads and teardown verification against legacy resource assumptions                                                                                                                                            |

The two D1A commands above are the only enabled wrapper operations. Container-local database/worker entrypoints and the local image bundler are unchanged; deployment cannot launch them remotely. Direct manual AWS/Terraform/Docker commands are outside the wrapper's control and remain unauthorized. Historical plan-policy tests still cover unsafe database/network/secret/image changes and the historical ten-dollar budget policy; they are not Sydney approval or authorization to create/modify any budget.

## Verification and remaining gates

`tests/deployment-sydney.test.ts` uses deterministic STS callbacks and fake executables. It verifies exact-role acceptance across sessions; foreign/malformed identity and inherited configuration refusal; missing credentials/expiry; missing/historical backend and plan refusal; traversal/symlinks/hard links; root/checkout/hash/state binding; private/exclusive contract creation; and actual deployment CLI refusal. The command-path tests allow only mocked STS calls and assert no Terraform, Docker, remote task, secret or Stripe path runs. Existing deployment and access tests retain their negative safety cases. No live AWS call is needed to prove rejection.

Executed local verification:

| Command                                                                                                                                     | Result                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                                                                                         | PASS                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm test:deployment`                                                                                                                      | PASS, 19 tests (8 new Sydney groups and 11 existing deployment/access tests); CLI tests verify 30 mocked STS invocations across enabled preflights, blocked workflows and expired-session failures, plus explicit override/account rejection                                                                                                                |
| `pnpm test:boundaries`                                                                                                                      | PASS, 5 tests                                                                                                                                                                                                                                                                                                                                               |
| `pnpm exec tsc -p tsconfig.check.json --noEmit`                                                                                             | PASS, all root TypeScript including changed deployment tooling/tests                                                                                                                                                                                                                                                                                        |
| `pnpm lint`                                                                                                                                 | FAIL during ESLint directory traversal: inaccessible sandbox-projected `.agents` instruction directory; Nx graph generation passed                                                                                                                                                                                                                          |
| `pnpm exec eslint . --ignore-pattern '.agents/' --ignore-pattern '.codex/' --max-warnings 0` and `node tools/check-oracle-dependencies.mjs` | PASS, all source linted with only inaccessible instruction directories excluded; oracle boundary passed for 24 packages                                                                                                                                                                                                                                     |
| `pnpm typecheck`                                                                                                                            | FAIL only in unchanged ops generated declarations: duplicate `LayoutProps`/incompatible `RouteContext` from both `.next/types` and `.next/dev/types`; root TypeScript passed. Existing ops tsconfig is identical to HEAD; its ignored `next-env.d.ts` imports dev types while tsconfig includes production types. These generated files were left untouched |
| `git diff --check` and `git check-ignore` for target backend/environment/image paths                                                        | PASS                                                                                                                                                                                                                                                                                                                                                        |

Initial sandbox pnpm attempts could not reach its pinned-version signature registry, and tsx IPC/child execution was blocked. Successful native pnpm checks above ran with the verified pinned launcher and local IPC available; signature verification was not disabled. The full operations typecheck remains an explicit verification gap. No build, database integration test, Terraform/backend command or live AWS API was needed for this increment.

D1B remains bounded offline preparation: explicit Terraform/provider/backend target configuration, allowlisted isolated source assembly, browser-login compatibility for pinned Terraform 1.15.x/provider 6.68.0, official Sydney/global RDS CA with verified TLS retained, existing $5 budget as a read-only guard (no duplicate/import/takeover), and explicit approved hostname/zone inputs. No unrelated repository or historical state is an input. Financial logic, PostgreSQL schemas, Stripe configuration, application access and worker semantics are unchanged.

Before D1B, the operator should review D1A and make the scoped commit if desired. Browser login is required only before running real STS preflight. Hostname/zone selection and budget ownership/alert verification are prerequisites for later deployment work, not for offline D1B changes.

D2/readiness and later resource creation require separate explicit instructions and current identity/Free Plan/credits/budget/service eligibility evidence plus reviewed concrete plans. Bucket/ECR creation, new-lineage state migration and child-zone creation require an approved bootstrap plan. After child-zone creation, report its actual nameservers and STOP for the operator's Cloudflare NS update; independently verify delegation before ACM/HTTPS. Runtime provisioning/publication/remote migrations and any hosted Stripe proof require their own approved scope and attended cost/teardown window. No Free Plan upgrade or automatic resource creation is permitted by D1A or offline D1B.
