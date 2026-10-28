# Single-host startup preparation

This work is local preparation only, separately scoped from the historical ephemeral AWS demo. The user authorized finishing and verifying it locally on 2026-10-29. No cloud deployment, publication, DNS update or remote-state operation is authorized by these files. [ADR-020](../architecture/adr/020-single-host-startup-preparation.md) records the changed hosting and trust boundaries.

## Files and behavior

- `infra/startup/`: pinned Terraform/provider, exact Sydney identity, existing subnet/AMI validation, one ARM64 host, HTTP(S)-only security group, narrowly scoped host role, Elastic IP and encrypted gp3 data volume protected by `prevent_destroy`. It uses its own proposed state key and does not own foundation S3/ECR, budgets or DNS.
- `container/startup/`: PostgreSQL 18, authenticated operations, sandbox ingress, Stripe and financial workers, manual provisioning profile and Caddy. Only Caddy publishes ports. PostgreSQL and Caddy storage require existing host directories; application secrets are mounted per process and logs rotate.
- `infra/startup/user-data.sh.tftpl`: locate the additional EBS volume by its exact serial; format only an apparently blank device, mount by UUID, require storage before Docker can restart, and install secret-fetch and Compose systemd units. Application startup remains disabled until provisioning and source bindings are verified. This bootstrap has not run on EC2.
- `tools/cloud-provision.ts`: opt-in `VIGIL_APPLICATION_AUTH=true` adds separate auth runtime/seeder logins and initial Admin/Viewer accounts using migration 014 and existing password hashing/authorization. Reprovisioning checks exact roles and book grants without resetting passwords or silently repairing permissions. Legacy demo mode does not require the new account inputs.
- `tools/container-health.ts`: bounded worker database connectivity check. It establishes technical connectivity only, not progress, financial assurance or worker lease correctness.

## Local verification

Use the installed Node 24 and pnpm versions. No cloud credentials are needed for these checks:

```sh
pnpm test:startup
pnpm aws:startup:validate:offline
```

The Terraform command copies only source/lock/test files to a new private temporary directory and runs `fmt -check`, `init -backend=false -lockfile=readonly`, `validate` and mocked, plan-only `test`. Provider installation can require registry access. Its printed temporary path retains logs. Never run Terraform directly in the startup source root or initialize its remote backend during local verification.

The browser/Compose test requires Docker, Chromium and three local images built from the current working tree:

```sh
docker build -f container/Dockerfile --target admin -t vigil-startup-admin:verify .
docker build -f container/Dockerfile --target ops -t vigil-startup-ops:verify .
docker build -f container/Dockerfile --target stripe -t vigil-startup-stripe:verify .
pnpm test:startup:integration
```

The test uses a unique Compose project, disposable named volumes, loopback ports, randomly generated credentials in a private temporary directory and localhost TLS. It provisions the real PostgreSQL schema, tests the shared Viewer and private Admin, checks secure cookies and restricted metrics, rejects an unsigned webhook, recreates PostgreSQL while retaining its volume, verifies the session survives and reprovisions without changing book identity. It also changes the seed input to prove the existing Admin password survives, then removes a test authorization grant to verify reprovisioning refuses drift without restoring the grant. Its generated environment files are readable by the image UID inside a private test directory; hosted files remain mode 0400 with the appropriate owner. Only the test's containers/volumes are removed afterward.

The Stripe API worker is omitted from this smoke because it requires a real sandbox API key. The image still packages both worker entry points. No Stripe API calls, external financial lifecycles, public ACME issuance, ARM64 execution, EC2 bootstrap, host reboot or EBS recovery are proven by this test.

## Before a separately approved hosted deployment

Review the concrete AWS plan, identity, account eligibility, budget/cost, IAM and state-write permissions independently. Resolve the startup hosting decision and backup/restore/patching ownership first. Do not enable or reuse the demo deployment wrappers for this root. Retain historical demo state and the existing bootstrap resources unchanged.

Pin a verified Canonical Ubuntu 24.04 ARM64 AMI and an existing Sydney public subnet/VPC; inspect its routing and ownership. Build and verify ARM64 application images in the existing ECR repositories; the Terraform digest syntax check alone does not prove platform, provenance or safety. Review `startup.tfvars.example` as public configuration only. Keep private `.tfvars`, state and plans out of version control.

Prepare the six exact SecureString parameters named in the Terraform host policy from the secret examples. Each database capability needs a distinct strong password. Use a private Admin email/password and stable, distinct sandbox/synthetic identities. Never substitute placeholder UUIDs for actual provisioning output. Avoid secrets in shell arguments, logs, Terraform or images. The secrets directory ignores private files by default.

After any future approved host creation, fetch secrets with the installed `vigil-secrets.service`, start PostgreSQL alone and run the `setup` profile's one-shot provision command. Verify its migration/permission receipt and actual source UUID before binding ingress and Stripe worker configuration. Review exact account grants; mismatches require investigation and explicit authorization rather than repair by rerunning the seed.

Publish and publicly verify manual DNS only after its separate checkpoint. The startup proposal uses Caddy-managed certificates, not the demo's ACM/ALB flow. Do not modify `flow.edtosoy.com` or provide Cloudflare credentials. Enable `vigil-compose.service` only after the database, account/source bindings, private secrets and DNS prerequisites are established. Record real hosted evidence independently from local checks.

Do not destroy or reformat the retained data volume. Container persistence is weaker evidence than a tested independent backup and restore; financial evidence and auth sessions share this single durability boundary. Startup teardown and retained-volume handling require their own reviewed plan and authorization.

## Executed evidence

Executed locally on 2026-10-29:

| Check                               | Result                                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                 | PASS; subsequent changed tests/docs also passed scoped Prettier checks.                                                                                                                                                 |
| `pnpm lint`                         | PASS, including the oracle dependency boundary for 24 packages. Subsequent test changes also passed scoped ESLint.                                                                                                      |
| `pnpm typecheck`                    | PASS, including Next route generation and application types. Subsequent test changes also passed `tsc -p tsconfig.check.json --noEmit`.                                                                                 |
| `pnpm test:deployment`              | PASS: 69 existing deployment/security regression tests.                                                                                                                                                                 |
| `pnpm aws:startup:validate:offline` | PASS: Terraform format, backend-disabled init, validation and all four mocked plan tests. Logs retained at `/tmp/vigil-startup-validation-arQY8K/`.                                                                     |
| Three Docker build commands above   | PASS: all local admin/ops/stripe targets rebuilt; includes application production compilation and bundled administrative/worker entry points. Logs retained at `/tmp/vigil-startup-{admin,ops,stripe}-final-build.log`. |
| `pnpm test:startup`                 | PASS: three configuration/security tests.                                                                                                                                                                               |
| `pnpm test:startup:integration`     | PASS: final PostgreSQL/Compose/HTTPS browser scenario, including password preservation and permission-drift refusal, in about 64 seconds.                                                                               |
| `git diff --check`                  | PASS.                                                                                                                                                                                                                   |

No dependency or financial schema was added; provisioning reuses migration 014 and the existing account seeder. Financial predicates and write boundaries were preserved. The generated `apps/ops/next-env.d.ts` development imports already present at task start were preserved after route generation.

The full financial unit/property/integration suite was not rerun: financial algorithms, schemas and worker lease semantics were not changed. Real Stripe API worker execution, ARM64 builds/execution, public DNS/ACME, EC2 bootstrap, EBS/host recovery, backups and capacity remain NOT RUN. No cloud resources, IAM, remote state or DNS were changed; no image publication or Git commit was performed. These local checks do not establish hosted or production readiness.
