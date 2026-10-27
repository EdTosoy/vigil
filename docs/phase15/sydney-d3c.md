# Sydney D3C — private inputs and backend readiness

2026-10-27, baseline `2df2370`. **Preparation complete; runtime planning/provisioning remains blocked. Zero AWS mutations.** The new local-only workflow stores no values unless the operator enters them. This run created only a non-secret configuration and review-only backend scope; all credentials and financial bindings remain missing. No commit/push.

## Inputs and secure local setup

Use `pnpm aws:runtime:inputs`. It reuses D1A target/path guards and existing sandbox-key validation, requires explicit `edtosoy` / `ap-southeast-2`, rejects inherited credential conflicts, and never calls AWS, Stripe, PostgreSQL or Terraform.

Local directory:

```text
.deployment/747240980964/ap-southeast-2/demo/runtime-inputs/
```

Directory/ancestors are owner-only 0700; files are exclusively created at 0600. Existing permissive, foreign-owned, symlink or hard-linked paths are refused rather than repaired. Each file must be Git-ignored/untracked. Secret updates use a private temporary file and atomic rename. Values and parsing errors are never printed. This is a permission-protected **plaintext local credential store**, not encrypted storage; use a trusted encrypted local disk. No previous-account file or environment file is imported.

- `configuration.json`: initialized, **non-secret**, fixed target/images plus explicitly missing endpoint/IDs; not directly usable as Terraform tfvars.
- `backend-plan-scope.json`: initialized proposal, `NOT_GRANTED`, `executable=false`. Editing it grants no permission.
- `secrets.json`: **absent**. Created only after successful hidden terminal entry; never edit secret values into source or chat.

| Category               | Exact input / existing contract                                                                                                   | Current status                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| AWS selection          | `aws_account_id=747240980964`, `aws_profile=edtosoy`, `aws_region=ap-southeast-2`, role `AccountFullAccessRole`                   | Fixed; live STS passed                                                                    |
| Images                 | `images.admin/ops/stripe`                                                                                                         | Exact D3A digest URIs prefilled; no publication                                           |
| Sandbox                | `stripe_account_id=acct_1UOVU2AoTLlql5uC`                                                                                         | Fixed; secret/account association not verified                                            |
| DNS/region             | `hostname=vigil.edtosoy.com`, `availability_zones=[ap-southeast-2a,ap-southeast-2b]`                                              | Fixed; no DNS confirmation                                                                |
| Database configuration | `flow-demo`, DB `flow`, user `flow_admin`, port 5432; PostgreSQL 18.6 micro/20-GiB private Single-AZ settings remain in Terraform | Endpoint missing; `sslmode=verify-full`, Sydney `container/rds-ca.pem` fixed              |
| DB credentials         | `secrets.admin_password`, `operations_password`, `ingress_password`, `stripeworker_password`                                      | Missing; fresh 40–100 URL-safe characters each                                            |
| Operator access        | `secrets.demo_username`, `demo_password`                                                                                          | Missing; username 1–64 safe characters; password 40–100 URL-safe characters               |
| Stripe credential      | `secrets.stripe_key` → `STRIPE_SECRET_KEY`                                                                                        | Missing; only real `sk_test_`/`rk_test_` accepted                                         |
| Signature credential   | `secrets.webhook_secrets` → `STRIPE_WEBHOOK_SECRETS`                                                                              | Missing; real `whsec_` value or comma-separated rotation list                             |
| Provisioning           | `secrets.provisioning`                                                                                                            | Missing; compact JSON containing `bookId`, expected `accountId`, exact password map below |
| Stripe identities      | Local `bindings.stripe_book_id`; Terraform `stripe_source_id`                                                                     | Both missing/unverified; source ID means `ingestion.source_account.id`, not `acct_…`      |
| Dashboard identity     | Terraform `ops_book_id`                                                                                                           | Missing/unverified; existing workflow uses the provisioner's **syntheticBookId**          |
| Activation/version     | `start_services=false`, `certificate_dns_confirmed=false`, `secrets_version=1`                                                    | Fixed; local edits cannot enable services/DNS authorization                               |

Provisioning password keys are case-sensitive: `operations`, `ingress`, `stripeWorker`, `ingestion`, `processor`, `bank`, `reconciliation`, `exceptions`, `controls`, `worker`, `integrity`. Each must be strong; operations/ingress/stripeWorker must match their three Terraform password inputs. `provisioning.bookId` must match local `bindings.stripe_book_id`, **not** the dashboard's synthetic book. No book/source UUID or password was generated in D3C.

### Operator entry procedure

In Stripe Dashboard, select the existing sandbox and confirm its account ID. Retrieve an existing sandbox API key from its API-keys page/vault; inspect an existing dedicated endpoint's signing-secret panel only if it already corresponds to the intended sandbox/URL. Do not create/rotate keys, register endpoints, reuse the historical endpoint's secret or change Stripe during D3C. If a credential is unavailable, leave it missing and request the appropriate later step. Key prefixes/syntax do not prove account ownership.

Use a password manager to prepare fresh local DB/operator passwords; never print them with shell generation commands. Run commands from an interactive terminal; paste **only after the hidden prompt**. No value argument, redirected input, chat, shell-history literal or `TF_VAR_secrets` export.

```sh
export AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2
# Already initialized here. On a fresh checkout only, if absent:
# pnpm aws:runtime:inputs init
pnpm aws:runtime:inputs check
pnpm aws:runtime:inputs set stripe_key
pnpm aws:runtime:inputs set webhook_secrets
pnpm aws:runtime:inputs set admin_password
# Repeat "set <key>" for remaining names in the table; never append a value.
pnpm aws:runtime:inputs check
pnpm aws:runtime:inputs plan-scope
```

Edit only the non-secret configuration when actual endpoint/IDs are available, preserving 0600 permissions. Enter `provisioning` as one compact JSON line only after its real book/account/password inputs are established. Do not use `pending-hosted-destination`, guessed mappings or dummy credentials. The package manager may print command arguments before the CLI rejects them, so values must never be placed in arguments.

## Actual binding verification

No IDs were supplied, and guarded `DescribeDBInstances(flow-demo)` returned DBInstanceNotFound. There is no configured Sydney database to validate against. `check` validates local syntax/permissions and reports missing fields, **always** `bindingsVerified=false`, `credentialAccountVerified=false`, `planExecutable=false` in D3C—even if plausible UUIDs are entered. An exit-0 syntax check is not deployment readiness.

After separately approved database migration/provisioning, use its actual outputs through an approved private network path and existing narrow principals:

1. Match the RDS endpoint to its guarded new-account regional ARN; hostname syntax alone is not account ownership proof.
2. Join actual `ingestion.source_account`, `ingestion.source` and `stripe.source`: requested source UUID must belong to the Stripe book, provider `stripe`, environment `test`, and external/account IDs must equal the supplied sandbox account. Use a read-only transaction/authorized read surface, not new records or grants.
3. Under the ingress login, existing `SELECT stripe.ready($1::uuid,$2)` must confirm the source/account/principal binding; also verify the worker's actual `stripe.principal_binding` capability.
4. Under the operations reader, `operations.read_v1` must resolve the actual dashboard book; match the approved provisioner's synthetic-book output separately. Never equate it with the Stripe book merely to satisfy validation.

These live DB checks were **not run**. They require real configured identities after authorized provisioning; local JSON assertions cannot replace them. Initial infrastructure/service-activation stages must remain distinct; D3C does not invent a book to break that dependency.

## DNS and ACM observations

Read-only Sydney ACM listing across key types returned no matching certificate. Public DNS: `edtosoy.com` uses `albert.ns.cloudflare.com` / `nora.ns.cloudflare.com`; `vigil.edtosoy.com` A/CNAME/CAA returned NXDOMAIN; parent CAA returned NOERROR/no answer. These are resolver observations, not control-panel access proof.

The Cloudflare connector refused `GET /zones` because Zone Read scope was unavailable. Public DNS was the read-only fallback; manual Cloudflare access remains unverified. No DNS change or certificate request occurred.

Later approved ACM creation must supply real validation CNAMEs via `acm_validation_records`; publish them DNS-only and verify DNS plus ACM ISSUED before enabling the validation/listener gate. Then configure Cloudflare `vigil` CNAME to the actual `alb_dns_name`, initially DNS-only. Do not guess tokens/ALB names, create Route 53 zones or touch `flow.edtosoy.com`. Future webhook URL: `https://vigil.edtosoy.com/webhooks/stripe`; registration/signing-secret setup is a separate later gate.

## Proposed plan-only backend authorization

Live reads verified expected bucket owner, Sydney region, Enabled versioning and AES256 encryption. Both exact `demo/terraform.tfstate` and `demo/terraform.tfstate.tflock` returned 404. Absence is not a reservation or permission to write.

| Scope                | Proposed future operation, not authorized here                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caller/backend       | Exact target/STS; provider and backend `allowed_account_ids`; default Terraform workspace only                                                             |
| State payload        | Read only `arn:aws:s3:::flow-demo-tfstate-747240980964-ap-southeast-2/demo/terraform.tfstate`                                                              |
| Discovery            | Bucket metadata; read-only `ListBucket` prefixes `demo/` and backend workspace discovery `env:/`                                                           |
| Only proposed writes | Conditional `PutObject` and normal owned-lock `DeleteObject` on `arn:aws:s3:::flow-demo-tfstate-747240980964-ap-southeast-2/demo/terraform.tfstate.tflock` |
| Forbidden            | State payload Put/Delete, other keys/workspaces, bootstrap state/migration, import/apply/destroy, force-copy/unlock, `-lock=false`                         |

Pinned [Terraform 1.15.3 backend source](https://github.com/hashicorp/terraform/blob/v1.15.3/internal/backend/remote-state/s3/backend_state.go) always includes `default` in workspace discovery, so its new-workspace state-initialization branch is not expected for this forced-default path. The [client source](https://github.com/hashicorp/terraform/blob/v1.15.3/internal/backend/remote-state/s3/client.go) uses conditional lock creation. This is source-reviewed design, not proof from a remote init/plan executed here. Future execution must stop instead of expanding permissions if a state payload write is attempted.

A later approved executor must assemble only allowlisted Sydney sources/locks into a fresh private work/data/run directory; verify owner/region, absent-or-reviewed state identity and no pre-existing lock; bind source/inputs/images/state to the saved plan; use native owned locking and recheck identity. The current broad operator role was not narrowed by an IAM change; the scope JSON is **neither an applied policy nor authorization**. Unknown locks require review, never deletion as a shortcut.

The exact intended CLI is installed but **unconditionally blocked**:

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:runtime:plan
```

After explicit lock-operation approval and implementation/verification of that bounded executor, its internal fixed commands are `terraform init -reconfigure -input=false -lockfile=readonly`, then `terraform plan -input=false -lock-timeout=30s -out=<private run plan>`. Run only through that executor, never directly in `infra/demo`. Secrets must be read privately into memory and supplied to the ephemeral child input, not persisted in the saved plan. No executor for those operations was enabled here; all runtime mutations remain blocked.

## Verification and remaining blockers

| Check                                                                          | Result                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Focused input/binding/privacy/lock-scope tests plus existing deployment guards | PASS, 42 tests                                                                                                                       |
| Local `init` and `check`                                                       | PASS: private non-secret config created; all nine secret fields and endpoint/bindings correctly reported missing; no credential file |
| Real pseudo-terminal hidden-entry smoke                                        | PASS with a disposable /tmp fixture: no echo, 0600 storage, fixture removed; no real credential used                                 |
| Deployment TypeScript (`tsc -p tsconfig.check.json --noEmit`)                  | PASS                                                                                                                                 |
| Scoped ESLint on new tool/tests                                                | PASS                                                                                                                                 |
| Formatting / `git diff --check`                                                | PASS                                                                                                                                 |
| Git exclusion, local modes and original bootstrap/recovery hashes              | PASS                                                                                                                                 |

Terraform files are unchanged; D3B's backend-disabled configuration validation and 11 mock-provider tests are reused, not rerun. No remote configuration validation/init occurred. Full repository lint/typecheck were not repeated; D3B documented the retained-archive ESLint ambiguity and D3A the generated Next.js declaration issue. No unrelated cleanup was included.

The CLI refuses unignored/tracked input paths; existing `.gitignore` covers inputs, plans, backend metadata, logs and state under the exact namespace. Tests exercise traversal/symlink/hard-link and permission failures, foreign configuration/credentials, false binding promotion and disabled plan execution. No ignore-rule change was needed. Bootstrap state/recovery remain untouched.

AWS ledger: **10 read-only CLI invocations**, including the initial standalone STS guard: STS GetCallerIdentity twice; S3 HeadBucket, GetBucketLocation, GetBucketVersioning, GetBucketEncryption, HeadObject twice; ACM ListCertificates; RDS DescribeDBInstances. No object body/secret value was downloaded. One Cloudflare read attempt was refused; five public DNS-over-HTTPS reads were made. Sanitized observations are `/tmp/vigil-d3c-cloud.json` and `/tmp/vigil-d3c-dns.json`. Mutation ledger is empty.

Remaining: operator-entered genuine credentials; actual database endpoint/Stripe source/book and synthetic dashboard-book proof; Cloudflare access and separately approved ACM/DNS steps; explicit exact-lock authorization and verified plan-only executor. No SSM/certificate creation, remote initialization, lock write/delete, migration, Terraform apply/destroy, ECR push, Stripe/DNS change, runtime enablement or Phase 16 work. Stop after D3C preparation; no commit/push.

Changed files: `tools/runtime-inputs.ts`, `tests/runtime-inputs.test.ts`, script/test registration in `package.json`, one durable rule in `infra/AGENTS.md`, and this report. Existing Git ignores already cover the new private directory.
