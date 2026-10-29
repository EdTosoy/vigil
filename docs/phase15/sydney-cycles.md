# Sydney repeat cycles — local implementation

Target: **747240980964 / edtosoy / ap-southeast-2 / vigil.edtosoy.com**. Read the [authoritative starting audit](sydney-redeployment.md), `infra/AGENTS.md` and [ADR-021](../architecture/adr/021-attended-sydney-cycles.md). The new path is locally implemented and tested; no cloud execution is authorized or live-verified.

## Changes and boundaries

`tools/runtime-cycle.ts` owns private cycle inputs and staged lifecycle; `runtime-cycle-review.ts` validates state/inventory/plan identity; `runtime-cycle-aws.ts` implements the separately gated cloud driver. Historical D3E/D3F/legacy wrappers and their first-use guards remain intact.

A cycle exclusively claims the **current empty state version**, ETag, digest, lineage and serial and additionally requires absent actual AWS inventory. Retained versions and old claims are expected, never deleted. Every plan uses a new isolated allowlisted source assembly, the unchanged State-role backend, native locking and the default workspace. Apply requires exact saved-plan, source, executor, input and state identities and a fifteen-minute review. Competing plans cannot both apply. New cycles continue the retained lineage after actual teardown produces a new empty state version.

Stages advance through stopped infrastructure, provisioning inputs, current-database provisioning, HTTPS with desired counts zero, dedicated sandbox destination registration and activation. No stale endpoint/source/book values are copied. RDS URLs derive directly from the actual Terraform resource. The provisioner receipt identifies the current task and immutable RDS resource ID; an owner-free task checks existing immutable Stripe source/principal bindings and exact Admin/Viewer book grants. The source-to-book association comes from the pinned current-database provisioner receipt; worker permissions are not widened to read ingestion source tables.

Current HEAD's operations task receives separate `DATABASE_OPERATIONS_URL`, `DATABASE_AUTH_URL`, `BETTER_AUTH_SECRET` and exact HTTPS `BETTER_AUTH_URL`. Only the admin task receives private initial administrator email/password and the provisioning map containing its separate auth seeder password. The historical Basic-access parameters are no longer created. Existing secure sessions, denied signup, rate limits, role checks and synthetic-only Visitor grants remain unchanged.

Activation verifies actual public ACM/application CNAMEs, ACM issuance, current database/bindings and a dedicated sandbox destination. Its signing secret must be returned by this cycle's registration and retained privately; manually entered syntax or historical credentials are insufficient. Registration refuses an existing enabled endpoint for the same URL. No payment demonstration starts automatically.

Teardown binds deletions to every actual allowed physical instance, including services, HTTPS, auth/SSM parameters and task definitions. Its review also binds owned one-shot task ARNs, which are stopped before infrastructure deletion. Completion requires empty state **and** absent actual runtime inventory. Persistent bootstrap resources are excluded from ephemeral-tag discovery and deletion. Backend policy files are unchanged. Inactive task revisions may remain as non-running metadata.

Failed/uncertain operations retain their claims and evidence. Forward stages stop. Cleanup can receive a new, separately reviewed deletion plan from current full state after partial work; no automatic retry occurs. Orphans, physical drift, tainted/deposed instances or unpersisted error state need explicit recovery review, never import/state push/unlock. Dedicated sandbox destination retirement and manual application DNS changes remain separate approved actions.

## Local preparation

```sh
export AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2
umask 077
pnpm aws:runtime:cycle prepare
# Set VIGIL_CYCLE to the returned new UUID.
pnpm aws:runtime:cycle set "$VIGIL_CYCLE" admin_email
pnpm aws:runtime:cycle set "$VIGIL_CYCLE" stripe_key
```

`set` uses a real hidden terminal prompt; values never belong in argv. Fresh passwords and the auth session secret are generated independently. Inputs live under `.deployment/747240980964/ap-southeast-2/demo/cycles/<uuid>/inputs.json`, with owned 0700 directories and unshared 0600 files. A newly requested Stripe book UUID is not treated as an existing identity until provisioning proves it. No endpoint or source/synthetic-book UUID is accepted as configuration. Retrieve the generated administrator password privately from this file, never into shared output.

After actually confirming budget alert delivery, account-wide gross spend and an attended four-hour cleanup window, record those operator assertions:

```sh
pnpm aws:runtime:cycle operator-checks "$VIGIL_CYCLE" \
  --budget-alert-delivery-confirmed --account-spend-reviewed --cleanup-window-confirmed
```

These assertions expire after fifteen minutes and grant no cloud authority. The driver independently checks STS, Free Plan/credits, the gross USD 5 budget, versioned Sydney bucket and exact State-role policies. New resource work stops at T+3h; target completed removal by T+4h. Cleanup bypasses budget-window/headroom requirements so expired credits do not prevent approved deletion.

## Future execution — not authorized or run here

Every command below needs separate explicit authorization for its effects. `--cloud-approved` is an operator gate, not approval or a security credential. Locked plans include remote init and lock writes/deletes. Each apply requires separate review of the actual saved plan and its **new** `run:sha256`; never reuse a historical or earlier-stage review. Do not invoke Terraform in source roots.

First obtain approval to commit the intended revision, then separately build/smoke/publish a coherent current-revision image trio. The publisher uses a per-cycle claim and retains the old D3A claim; historical pre-auth images are refused:

```sh
pnpm aws:images:publish --cycle "$VIGIL_CYCLE" --cloud-approved
pnpm aws:runtime:cycle plan "$VIGIL_CYCLE" infrastructure --cloud-approved
pnpm aws:runtime:cycle apply "$VIGIL_CYCLE" --reviewed "$VIGIL_REVIEW" --cloud-approved
pnpm aws:runtime:cycle plan "$VIGIL_CYCLE" provisioning --cloud-approved
pnpm aws:runtime:cycle apply "$VIGIL_CYCLE" --reviewed "$VIGIL_REVIEW" --cloud-approved
pnpm aws:runtime:cycle provision "$VIGIL_CYCLE" --cloud-approved
```

Replace `VIGIL_REVIEW` with each new actual plan review. Provisioning launches one admin task using the current definition/networking, waits at most ten minutes and requires its successful permission/auth receipt. A crash or unknown outcome must not automatically launch another task.

STOP for manual Cloudflare publication of the actual ACM validation CNAME and current ALB application CNAME, DNS-only. Use only `vigil.edtosoy.com`; preserve parent DNS, historical `flow` and unrelated records. No Cloudflare credentials are used. Public CNAMEs and ACM `ISSUED` must be verified before HTTPS:

```sh
pnpm aws:runtime:cycle plan "$VIGIL_CYCLE" https --cloud-approved
pnpm aws:runtime:cycle apply "$VIGIL_CYCLE" --reviewed "$VIGIL_REVIEW" --cloud-approved
# Separate sandbox endpoint creation/signing-secret retention approval:
pnpm aws:runtime:cycle destination "$VIGIL_CYCLE" --cloud-approved
pnpm aws:runtime:cycle plan "$VIGIL_CYCLE" active --cloud-approved
pnpm aws:runtime:cycle apply "$VIGIL_CYCLE" --reviewed "$VIGIL_REVIEW" --cloud-approved
pnpm aws:runtime:cycle verify "$VIGIL_CYCLE" --cloud-approved
```

Only activation starts the three one-replica services. Verification checks current database/bindings, DNS, rollouts, ALB targets, technical health, unauthenticated redirect, real administrator login with secure HttpOnly cookies and Admin metrics. It does **not** establish capture/fee correctness, completeness, reconciliation or financial PASS. Hosted signed Stripe proof needs a separately approved demonstration and evidence review.

Agree on disposal/cleanup authority before creation. After the demonstration or partial work, separately review the current full deletion plan and one-shot stops:

```sh
pnpm aws:runtime:cycle plan "$VIGIL_CYCLE" teardown --cloud-approved
pnpm aws:runtime:cycle apply "$VIGIL_CYCLE" --reviewed "$VIGIL_REVIEW" --cloud-approved
pnpm aws:runtime:cycle verify-teardown "$VIGIL_CYCLE" --cloud-approved
# Separate approval to remove only this cycle's dedicated sandbox endpoint:
pnpm aws:runtime:cycle retire-destination "$VIGIL_CYCLE" --cloud-approved
```

State/history and all financial objects survive as appropriate to their documented scope; the disposable demo database's approved data disposition is explicit in the deletion plan. Manual application DNS retirement is separately approved. A retained state key with zero managed instances is the expected next-cycle foundation; never delete it to satisfy first-use guards.

## Executed local verification

| Check                                                                          | Result                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:deployment`                                                         | PASS: 78 tests, including two complete cycles, synchronized competing plan claims, full activated teardown, unknown outcomes and stale binding/review refusal.                                                        |
| `AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:validate:offline demo` | PASS: fmt, backend-disabled init, validate and 17 mocked plans, including exact auth/owner separation and activated inventory.                                                                                        |
| `pnpm test:integration tests/auth.integration.test.ts`                         | PASS: 7 tests against disposable PostgreSQL 18.6, including owner-free current binding verification and real browser login/navigation/scope/metrics/session checks. Migration/history-preservation gates also passed. |
| `pnpm --filter @vigil/ops build`                                               | PASS: current production Next.js build/typecheck.                                                                                                                                                                     |
| `node_modules/.bin/tsc -p tsconfig.check.json --noEmit`                        | PASS.                                                                                                                                                                                                                 |
| Scoped ESLint on changed TypeScript/tests/container builder                    | PASS, zero warnings.                                                                                                                                                                                                  |
| Local Linux/amd64 admin Docker build                                           | PASS, includes all entrypoint bundles, new independent verifier, financial read libraries and production Next.js build. Image `vigil-sydney-cycle-admin:verify`; not published.                                       |

Initial local checks found a verifier query outside the worker's permissions; it was replaced with reads of existing Stripe binding tables. The browser harness inherited a stale workstation `OPS_BOOK_ID`; its child environment now clears it. All final PostgreSQL/browser checks passed. The host bundler could not resolve this mounted workspace's canonical path; the real Docker build succeeded with unchanged bundler behavior. Sandbox IPC/subprocess/Docker restrictions required running repository checks with local execution permission; no cloud permission was requested or exercised.

No AWS account request, remote init, state/lock write, provisioning/apply/destroy, Stripe API call, image publication, DNS/IAM change, commit or push occurred. Cloud-driver behavior remains **NOT LIVE-VERIFIED**. Required remaining gates are fresh committed/published images, operator cost evidence, real provider/backend/service admission, account-wide discovery, DNS/ACM, approved sandbox registration, staged execution, hosted auth/signed proof and actual teardown. Stop for authorization and evidence before those operations; never widen the State role, create OIDC or upgrade the account to proceed.

Reference behavior was checked against [Terraform 1.15 S3 backend](https://developer.hashicorp.com/terraform/language/v1.15.x/backend/s3), [AWS provider 6.68.0 write-only SSM arguments](https://github.com/hashicorp/terraform-provider-aws/blob/v6.68.0/website/docs/r/ssm_parameter.html.markdown) and the installed AWS containers skill's ECS role/secrets guidance. No framework/provider/dependency was upgraded.
