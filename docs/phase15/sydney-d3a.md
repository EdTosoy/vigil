# Sydney D3A — guarded image publication

2026-10-27. **SUCCESS: exactly three committed-source production images published and verified; no partial failures**. Publication only; no Terraform, infrastructure, ECS/RDS/ALB, runtime secret, migration, Stripe, DNS, ACM or account-plan change. No Git commit/push.

## Identity, committed source and mapping

Existing strict STS guards require `edtosoy`, account `747240980964`, `ap-southeast-2`, exact assumed role `AccountFullAccessRole`, valid rotating-session ARN structure and no inherited credential/profile/region/endpoint overrides. No individual session suffix is recorded. Identity is checked before repository reads, before registry authentication and before each push. No historical account/profile fallback.

Image source is committed **`c4ff82ae980b6442bb74c6cc5027d1d8c3a5e402`**. Initial working tree was clean. Builds consume a fresh `git archive` of that revision, not the dirty working tree. Only new D3A publication tooling/tests/command registration/infrastructure rule/report are uncommitted; these are excluded from the image source snapshot. Unexpected application/unrelated dirty files, changed HEAD or changed workspace dependencies fail closed. Publication tooling changes do not claim to be part of the image commit.

| Repository         | Production Docker target / function                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `flow-demo/admin`  | `admin`: one-shot provisioning/migration, owner-free verification, backfill/proof/general-worker bundles; not a long-running service |
| `flow-demo/ops`    | `ops`: standalone Next.js operations dashboard, static/public/favicon assets                                                         |
| `flow-demo/stripe` | `stripe`: sandbox webhook ingress and separate durable PostgreSQL worker entrypoints sharing one image                               |

## Verified immutable manifest

| Repository         | Source commit  | Tag                                          | Immutable digest                                                          | Architecture | Verified |
| ------------------ | -------------- | -------------------------------------------- | ------------------------------------------------------------------------- | ------------ | -------- |
| `flow-demo/admin`  | `c4ff82ae980b` | `d3a-c4ff82ae980b-20261027T125548Z-53cd36e0` | `sha256:2c5730a3d9490c18bfe611fd38671140f9f18319f512e193f63ebb8a30dfe223` | linux/amd64  | Yes      |
| `flow-demo/ops`    | `c4ff82ae980b` | `d3a-c4ff82ae980b-20261027T125548Z-53cd36e0` | `sha256:06856e82365e186db47f2ed1c8906fca97e59194031d767eefad34e01e929ca9` | linux/amd64  | Yes      |
| `flow-demo/stripe` | `c4ff82ae980b` | `d3a-c4ff82ae980b-20261027T125548Z-53cd36e0` | `sha256:0c53fce38d2dad143ef243516b0a337ccf127d6ba59003902bbabd01108a2c8a` | linux/amd64  | Yes      |

All URIs use `747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/<repository>@<digest>`; deploy by digest, never `latest` or a mutable tag. Config/image IDs are not substituted for registry manifest digests.

## Build, guard and publication evidence

The no-argument `AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:images:publish` is the sole new bounded publication entrypoint. It permits only the three existing repository mappings, unique revision-linked tags and verified build artifacts. Missing/foreign repositories, mutable settings, lifecycle drift, tag collisions, source drift, failed smoke results and conflicting Docker/credential overrides stop execution. A private D3A claim prevents automatic reruns, including partial failures. General deployment/Terraform/secret/runtime mutation gates remain disabled.

Each build uses existing `container/Dockerfile`, frozen pnpm lockfile, current Vigil workspace and production standalone/bundled dependency assembly, `linux/amd64`, explicit commit build argument and OCI revision label. Build dependencies stay in the build stage; runtime images use the existing production stages. Only committed files enter the Docker context; `.dockerignore` excludes local credentials, deployment data, environment files, Git, generated output and infrastructure/tests/docs. No build credentials/secret arguments are passed.

All three builds/smokes must pass before obtaining a registry token or pushing anything. Checks cover non-root UID 1000/user node; exact production entrypoints/bundle syntax; pinned Sydney CA bytes and `NODE_EXTRA_CA_CERTS`; hostname checking/no insecure TLS override; absent common credential/environment files; dashboard standalone/static assets and byte-identical public/favicon files. A network-disabled dashboard smoke requires liveness 200 and missing-configuration readiness/metrics/dashboard 503. No PostgreSQL/Stripe connection or migration is run.

Existing repositories are checked for exact account/region/ARN/name, IMMUTABLE tags without exclusions, AES256 encryption, BASIC scan-on-push and the unchanged seven-day untagged-only lifecycle. Target tags are checked absent initially, again after all builds and immediately before each push. Docker uses a private temporary credential directory; ECR token is passed only through password stdin, never logged, and the directory is removed in `finally`. No repository/policy/scanning setting is changed.

After every push, ECR DescribeImages and BatchGetImage prove tag/account/repository identity, actual manifest digest and SHA-256 of returned manifest bytes. Manifest config digest must equal the locally verified image ID, binding its linux/amd64 config and content. Failures stop without automatic overwrite, retry or deletion. [AWS authentication](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html) and [manifest API](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_BatchGetImage.html) are the official references used.

Private evidence is under `.deployment/747240980964/ap-southeast-2/demo/publication/7c9e3ad9-e607-4472-904d-337daf8b7231/`: committed source/archive metadata, individual build/smoke/push logs, verified local IDs, actual manifests, individual image receipts, `publication-result.json` and independent `post-verification.json`. Evidence files are 0600 under private directories; Docker credentials were removed. The separate `demo/d3a-publication.json` claim prevents accidental retries. Do not rerun publication or delete/overwrite images to recover an interrupted command; inspect receipts/current ECR first. No partial failure occurred.

Post-verification independently re-read repository settings/policies and each digest/manifest: PASS. Bounded runtime inventory still has zero ECS clusters, RDS instances and load balancers; repository inventory remains exactly the existing three. No other provisioning API was executed.

## Verification, state custody and costs

| Check                                                           | Result                                                                                                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three production Docker builds, committed source / linux/amd64  | PASS                                                                                                                                                                                               |
| Three network-disabled packaging/TLS/non-root/entrypoint smokes | PASS                                                                                                                                                                                               |
| Network-disabled dashboard HTTP fail-closed smoke               | PASS: live 200; readiness, metrics and dashboard 503 without credentials/database                                                                                                                  |
| Existing deployment safety plus new publication tests           | PASS: 36 tests; includes wrong account/role/region/repository, dirty/changed revision, package drift, tag collisions, unverified/missing builds, manifest/config mismatch and unsafe CLI overrides |
| `pnpm exec tsc -p tsconfig.check.json --noEmit`                 | PASS                                                                                                                                                                                               |
| Scoped ESLint on new publication tool/tests                     | PASS                                                                                                                                                                                               |
| ECR digest/manifest and post-publication settings verification  | PASS                                                                                                                                                                                               |
| `pnpm format:check` / `git diff --check`                        | PASS                                                                                                                                                                                               |

Full `pnpm typecheck` was executed and still fails on the previously documented overlapping generated Next.js route/layout declarations. Source caches were not deleted or repaired. Root/deployment TypeScript and clean production Docker compilation are separate checks; no full-workspace pass is claimed.

**Bootstrap state unchanged.** Before/after SHA-256, file mode, size and modification timestamp match for both authoritative state and recovery copy under `bootstrap/plans/7672de2b-8c20-4488-b356-68075ce9b0d5/`. Both retain SHA-256 `83a22793b582723d0849a1840a7236e4dd2c6d1aefdf7a332e4cca32ce956235` and 0600 permissions. No live Terraform command was invoked, remote backend initialized, recovery file modified, state copied/migrated or infrastructure regenerated.

ECR-reported compressed image-size sum: **261,816,198 bytes**, or 0.261816198 decimal GB. At the dated USD 0.10/GB-month planning rate, summing full sizes without assuming layer deduplication gives approximately **USD 0.02618161980/month** (about USD 0.03 before tax/transfer and other usage). This is an estimate, not a measured bill or guaranteed cap. [AWS ECR pricing](https://aws.amazon.com/ecr/pricing/) supports usage-based storage/no upfront fee and same-region AWS transfer treatment. Credits/free allowances are not subtracted from gross estimates; tagged images are retained by the current untagged-only policy. No paid enhanced scanning was enabled; only the existing BASIC scan-on-push configuration was used.

## AWS actions and remaining runtime gates

Publication used **three successful Docker pushes**, one per approved repository/tag. The registry stores three verified manifests (`ecr:PutImage`) and associated layer uploads (`ecr:InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload` as needed). Layer-call/retry counts were not traced; no guessed counts are asserted. `BatchCheckLayerAvailability` is read-only. No repository creation/configuration/policy/scanning mutation or image deletion was called.

There were **45 direct AWS CLI invocations** including the initial standalone STS preflight, 30 bounded publication reads/auth calls and 14 independent post-verification calls. These are logical invocation counts, not Docker registry HTTP/wire-level counts. Operations: STS GetCallerIdentity; ECR DescribeRepositories, DescribeImages, GetLifecyclePolicy, GetRegistryScanningConfiguration, GetAuthorizationToken (via get-login-password) and BatchGetImage; plus ECS ListClusters, RDS DescribeDBInstances and ELB DescribeLoadBalancers for post-inventory. All were read-only/authentication operations and succeeded; image writes occurred only through the three fixed Docker pushes.

Private action ledgers accompany the receipts; token/credential responses are never saved. Scanning configuration was verified; this report does not claim a vulnerability-free image audit.

Only the three authorized image publications and associated layer uploads are allowed mutations. No infrastructure creation/configuration/deletion API, Terraform command, state migration, secret write, image deletion, Git commit/push or historical-account request is part of this path. Existing BASIC scan-on-push may run automatically; enhanced scanning was not enabled and no scan configuration changed.

Stop after publication verification. Runtime still needs a separately reviewed saved plan, isolated backend/state handling, private fresh runtime credentials and sandbox signing secrets, manual Cloudflare/ACM validation, a tested bounded teardown path and independent apply approval. The selected sandbox account remains `acct_1UOVU2AoTLlql5uC`; no Stripe API was called. Four-hour/USD 2 gross runtime assumptions remain estimates, not a spending guarantee. Budget recipient remains inactive by accepted operator risk; delivery is not claimed.

Files changed: `tools/publish-images.ts`, `tests/publication.test.ts`, command/test registration in `package.json`, the durable exception in `infra/AGENTS.md`, and this report. Image/application/Dockerfile/financial/schema sources remained at the committed revision.
