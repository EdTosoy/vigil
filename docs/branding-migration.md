# Vigil repository rename and compatibility

Vigil was originally developed as Flow. Current workspace packages use `@vigil/*`, the private root package is `vigil`, and current source imports, build commands and dependency boundaries use that scope. External dependency versions are unchanged by this rename.

## Compatibility boundaries

- Applied SQL migrations remain byte-for-byte unchanged. Existing database roles, database names, migration bookkeeping and advisory-lock identities remain `flow_*`/`flow-*`. Changing those literals would break existing installations or separate concurrent commands into different lock domains.
- Financial command identities, source UUIDs, book IDs and Stripe idempotency keys are unchanged. Existing Stripe request descriptions also remain unchanged: changing parameters while reusing an idempotency key can reject a legitimate retry.
- `VIGIL_DEPLOYMENT_MODE`, `VIGIL_DEMO_USERNAME`, `VIGIL_DEMO_PASSWORD`, `VIGIL_IMAGE_REVISION`, `VIGIL_BUDGET_EMAIL` and `VIGIL_PROVISIONING_CONFIG` take precedence over corresponding legacy `FLOW_*` variables. An explicitly invalid new value is not replaced with a valid legacy value. Old deployment configurations remain accepted.
- The Docker build accepts `VIGIL_IMAGE_REVISION`; the old `FLOW_IMAGE_REVISION` build argument remains its fallback. Runtime access remains fail-closed in demo mode.
- Requests expose `x-vigil-request-id` and the compatibility alias `x-flow-request-id` with the same server-generated value. Both replace untrusted inbound correlation IDs. Existing `flow_*` metric names and PostgreSQL `application_name=flow-operations` remain stable for monitoring consumers.
- Internal test-harness variables and temporary artifact prefixes now use `VIGIL_*`/`vigil-*`. Invoke tests through the existing pnpm scripts, which construct their scoped environment.
- Historical Phase 1–15 verification reports, recorded profiles, ADRs and the Phase 12 screenshot retain their original names and evidence. Current package commands in reproduction guides use `@vigil/*`.
- Ordinary words and syntax such as flow, stock/flow, inflow, outflow, workflow, overflow and Mermaid `flowchart` are unchanged.

## GitHub and domain

The GitHub repository is [EdTosoy/vigil](https://github.com/EdTosoy/vigil), and this checkout's origin points to it. Repository renaming does not change application runtime configuration or financial identities. Source edits from this rename remain uncommitted until explicitly published.

The requested future demo domain is `vigil.edtosoy.com`. **Live DNS migration is deferred.** The current deployment configuration deliberately retains `flow.edtosoy.com`, existing Terraform addresses, remote-state bucket, ECR repositories, resource names, tags and SSM paths. Replacing those strings would change deployed identities rather than just rename repository text.

A later reviewed domain migration must retain the existing Flow child zone while adding the Vigil child zone, inspect the Terraform plan, and stop for the operator to add the four actual NS records named `vigil` in the Cloudflare parent zone. Verify public delegation before requesting certificates or activating the new endpoint. Coordinate HTTPS, webhook configuration and signed sandbox verification before retiring an old URL. Do not rename buckets, ECR repositories, database roles or semantic keys as part of that cutover.

This source rename does not deploy AWS resources, change Terraform state, initiate payments, change financial semantics or begin Phase 16.
