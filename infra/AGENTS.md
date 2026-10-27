# Vigil deployment boundaries

Read root instructions, Phase 15 documentation and ADR-018 before changes.

- Historical Phase 15 evidence used `iamadmin-general`, account `163596511125`, region `us-east-1`; its state/resources are foreign to the Sydney preparation. Never use them as fallback or migrate/copy their state.
- Sydney D1A permits only local preparation and read-only STS preflight with explicit `edtosoy`, account `747240980964`, `ap-southeast-2`, exact STS assumed role `AccountFullAccessRole` (rotating session suffixes allowed). Reject inherited credential/profile/region/endpoint/Terraform overrides. Recheck actual STS identity immediately before every future mutation; a cached receipt is never authorization.
- Sydney artifacts belong only under `.deployment/747240980964/ap-southeast-2/{bootstrap,demo}/`, including isolated work roots, `TF_DATA_DIR`, seed state, backends, plans, environment/secrets, logs and history. Reject traversal/symlinks and foreign/missing backend or plan metadata; never read legacy private files to populate the new namespace.
- All existing deployment/observer workflows are disabled pending D1B portability. Do not bypass the entry/executor gates to use historical Terraform roots. D1B is offline only; remote init, migration, unlocking, image publication, resource creation/destruction and DNS changes still require later explicit authorization. See the Sydney runbook.
- `bootstrap` owns persistent prerequisites; `demo` owns disposable runtime.
- Inspect saved plans and verify identity before every apply. Deployment tooling rejects bootstrap deletes and unexpected resource types.
- State is sensitive, encrypted and versioned; use native S3 locking. Never commit state, saved plans, generated backend configuration or local variable files.
- Creating the public `flow.edtosoy.com` child zone is a mandatory STOP checkpoint. Report its actual nameservers and wait for the user to add Cloudflare NS records. Verify public delegation after confirmation before certificate validation or HTTPS deployment.
- Never migrate the Cloudflare parent zone or require Cloudflare tokens/providers.
- No NAT, public database, workload AdministratorAccess, live Stripe, alternate queue or financial semantic changes.
- Runtime credentials remain narrow. Owner credentials belong only to one-shot migration/provisioning. Never expose secrets through outputs, plans/logs shared with users, task environment literals or images.
- A successful apply is not financial assurance or Phase 15 completion. Record deployed proof and actual runtime destruction separately.
