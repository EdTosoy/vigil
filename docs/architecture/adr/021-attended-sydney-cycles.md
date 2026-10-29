# ADR-021 — Attended Sydney cycles over retained versioned state

Status: implemented and locally verified; cloud execution and hosted acceptance are not authorized or verified. Date: 2026-10-29.

## Context

The [Sydney audit](../../phase15/sydney-redeployment.md) established that the first-use executors cannot admit the retained empty runtime lineage, activate current HEAD or delete its complete final inventory. Removing historical claims or state versions would discard recovery evidence. Current HEAD requires the existing application-auth capabilities rather than the historical Basic-access images.

## Decision

Add a separate attended cycle executor and retain historical executors and guards. Each cycle generates fresh private credentials and a requested Stripe book identity. It exclusively claims an observed empty current state version, ETag, digest, lineage and serial, with absent actual runtime inventory. No alternate state key, bootstrap migration, import, state deletion, forced unlocking or backend permission expansion is introduced.

Every stage uses a fresh source-only assembly and saved plan. Apply binds its digest, input/source/executor hashes, physical inventory and unchanged state to a review no older than fifteen minutes. New resource work requires fresh Free Plan/budget/operator checks and stops at T+3h of the four-hour attended window. Cleanup remains available when credits expire. Exclusive claims and native Terraform locking prevent competing applies; failed/uncertain attempts remain retained. Teardown may be separately replanned and reviewed from actual current state after partial work, without retrying an old saved plan.

Keep the unchanged backend-only State role/session policy for the exact state key and native locks. Provider operations retain the exact Sydney browser identity. Persistent S3/ECR/state/history, foundation/browser/service-linked roles, the externally owned budget, Cloudflare and unrelated workloads are outside deletion scope.

Provisioning uses existing auth roles and account seeding with separate runtime/seeder credentials. ECS injects only exact workload SSM references. Serving and verification tasks never receive owner or seed credentials. Existing session, HTTPS-origin, cookie, signup, role and book-grant policies remain unchanged; public snapshot mode is not used. No schema or financial-domain behavior changes.

Bindings originate from the current provisioner task and RDS physical identity, then are checked with existing source-bound worker and auth runtime capabilities. DNS must identify the current ACM certificate and ALB. The signing secret must originate from this cycle's dedicated sandbox destination creation. A syntactically valid identifier or secret is insufficient. Image publication gains a per-cycle claim while retaining committed-source checks.

Teardown covers the complete actual allowed runtime inventory, including activated services, HTTPS, auth parameters and reviewed owned one-shot tasks. Completion requires empty managed state plus absent actual runtime inventory. Inactive task revisions may remain as non-running metadata. Sandbox destination retirement and manual DNS remain separately approved operations. Technical readiness/login proof never establish financial assurance.

## Consequences

The contract is testable locally. Actual browser/backend admission, provider metadata, AWS discovery, stage execution, signing, auth/TLS and deletion remain cloud acceptance gates. Orphan resources, physical drift, tainted/deposed state and unpersisted error state require explicit recovery review; state is never pushed or repaired automatically. No new service, dependency, long-lived credential, OIDC provider or production-readiness claim is introduced.

See the [cycle runbook and verification](../../phase15/sydney-cycles.md).
