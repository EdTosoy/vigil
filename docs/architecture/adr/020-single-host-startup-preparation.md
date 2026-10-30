# ADR-020 — Local preparation for a single-host startup deployment

Status: local implementation and verification only. Cloud provisioning and the hosting change require separate approval. Date: 2026-10-29.

## Context

The unfinished startup work replaces the ephemeral demo's Fargate/ALB/RDS runtime with a single ARM64 EC2 host, Caddy and self-managed PostgreSQL. The user authorized finishing and verifying this work locally. ADR-018 and ADR-019 remain the historical demo/Sydney baseline; this preparation does not authorize deploying a different runtime or changing their existing state.

## Decision

Prepare an independent `infra/startup` root for account `747240980964`, profile `edtosoy`, region `ap-southeast-2`, with a distinct `startup/terraform.tfstate` key in the existing foundation bucket. The proposal uses one `t4g.medium`, standard CPU credits, an Elastic IP, an existing public subnet and an encrypted, separately retained gp3 data volume. HTTP(S) are the only inbound ports. PostgreSQL has no published port and uses an internal Compose network. The host requires IMDSv2 with hop limit one; application containers have no intended need for AWS credentials.

Caddy terminates TLS and forwards only the exact Stripe webhook path to ingress; other paths use the authenticated operations app. Operations, ingress, Stripe worker and financial worker retain separate database capabilities and mounted environment files. One-shot provisioning owns migration and initial account creation. The private Admin receives the configured sandbox and synthetic books; the shared Viewer receives only the synthetic book. Reprovisioning verifies existing permissions and does not reset passwords or expand grants. No financial schema or reconciliation semantics change.

The host fetches six exact SSM parameter names to private files under `/run`; secrets are absent from Terraform inputs, user data and images. Application images require the corresponding existing ECR repository and an immutable digest. New ARM64 builds and proof are required before hosted use; the prior x86 publication is insufficient.

Offline Terraform verification copies allowlisted sources into a fresh private temporary directory, disables backend initialization, removes ambient AWS credentials and executes mocked plan tests. It does not read remote state, inspect the account or apply anything. Existing deployment wrappers and their approval gates remain unchanged.

## Consequences

This is a different operational trust boundary: host root, Docker and the instance role can reach all startup secrets, including the one-shot provisioning credential. Database connections use an isolated local bridge rather than RDS TLS. A single host/volume is not HA or disaster recovery. EBS retention and container-recreation tests do not prove backups, restore, host replacement, patching, public certificates, DNS, capacity or ARM64 operation. Those remain deployment prerequisites, with explicit cost and resource-plan review; no always-on or production-readiness claim follows.

See the [startup runbook and verification limits](../../phase15/startup.md). Docker's [tmpfs reference](https://docs.docker.com/reference/compose-file/services/#tmpfs), Caddy's [reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), and AWS's [metadata options](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-options.html) informed the configuration review. Hop limit one restricts IMDSv2 token replies across the bridge; it is not a substitute for host isolation.
