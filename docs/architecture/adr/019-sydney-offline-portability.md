# ADR-019 — Isolated Sydney sources with external budget and manual DNS

Status: accepted for offline D1B preparation only, 2026-10-27. Provisioning is not authorized.

## Context

ADR-018 records the verified historical account `163596511125` in `us-east-1`. Sydney preparation targets only `747240980964`, `edtosoy`, `ap-southeast-2`, assumed role `AccountFullAccessRole`. Its existing $5 gross budget belongs to another owner, and the operator selected `vigil.edtosoy.com` with Cloudflare DNS. Historical state/resources and `flow.edtosoy.com` must remain untouched.

## Decision

Reuse the Phase 15 Fargate/private Single-AZ RDS/HTTPS ALB architecture and its x86 images, narrow capability logins, sandbox adapter, write-only secrets and financial boundaries. Retarget tracked Terraform sources with exact validated account/profile/region inputs and provider/backend account guards. Assemble only explicit source/lock/test allowlists into fresh account/region/root-scoped workspaces; never load source-directory caches, generated backends or state. D1A's authoritative STS checks and unconditional mutation gates remain.

Persistent Sydney bootstrap describes only encrypted/versioned/private state storage and immutable ECR repositories/lifecycle policies. Reference the existing gross budget through a data source with strict scope/amount/cost checks; never import or manage it. First-time bootstrap must eventually use fresh local seed state, then separately reviewed migration of that new lineage after bucket creation/ownership verification. No automatic migration is implemented or authorized.

Cloudflare remains authoritative for `edtosoy.com`. Terraform requests an ACM certificate for `vigil.edtosoy.com` and exposes its actual validation CNAMEs and the eventual ALB hostname. The operator publishes DNS records manually, verifies public responses and explicitly confirms the DNS gate. Certificate waiting, HTTPS listeners and ECS services are gated by that confirmation. No Route 53 resources or Cloudflare provider/credentials are introduced. Initial application DNS remains DNS-only; later proxying requires separate verification of origin TLS and webhook behavior.

Package the official Sydney RDS CA root bundle in the common image base. Preserve Node's certificate/hostname verification, PostgreSQL `sslmode=verify-full` and `rds.force_ssl`. Bundle provenance/fingerprints are tracked; rotations require reviewed replacement and local plus eventual live TLS verification.

## Consequences

Runtime remains disposable and billable while ALB/RDS exist, even with services disabled. A future certificate-only reviewed step should precede the short full-runtime window and manual DNS waiting. No always-on, Free Plan eligibility, cloud authentication, runtime deployment or HA claim follows from local validation. D2 must verify real identity/plan/credits/budget/service permissions, DNS and secrets, prepare concrete plans, and obtain separate billable-resource approvals. Existing financial invariants, schemas, Stripe behavior and historical evidence are unchanged.

See [D1B evidence and manual gates](../../phase15/sydney-d1b.md).
