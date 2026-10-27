# Sydney D3 — runtime preparation, not provisioning

2026-10-27. Bootstrap succeeded; **no runtime apply is authorized or executed**. This is a readiness/cost/operations package, **not a generated Terraform runtime plan**. Real image references and runtime input/backend preparation are still required before a concrete saved plan can be produced safely.

## Fixed inputs and remaining plan blockers

Reuse unchanged `infra/demo`: new account `747240980964`, `edtosoy`, `ap-southeast-2`, role `AccountFullAccessRole`, hostname `vigil.edtosoy.com`. The user supplied sandbox account **`acct_1UOVU2AoTLlql5uC`**. No Stripe account API was called or financial identity modified.

Planned architecture remains three 0.25-vCPU Fargate services (ops 1 GiB, sandbox ingress/worker 0.5 GiB each), five task definitions including one-shot admin/verifier, private encrypted Single-AZ PostgreSQL 18.6 `db.t4g.micro` with 20 GiB gp3, public ALB HTTPS, SSM Standard write-only secrets, short-retention logs and a dedicated NAT-free VPC. Tasks have outbound HTTPS/public IPs with narrow security groups; RDS remains private. Sydney CA verification and existing financial/application behavior are unchanged.

A fresh executable plan is blocked by:

1. **Images:** all three new-account ECR repositories are verified empty. Existing local D1B image inspection reports no RepoDigests/registry Descriptor, so it supplies no valid ECR manifest references. Do not use config IDs as manifest digests or invent digests. A separately approved guarded publication of the reviewed ops/stripe/admin images must produce real `747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/<image>@sha256:…` receipts. No image was published here.
2. **Secrets:** supply new target-specific sandbox keys/signing secrets and locally generated DB/operator credentials through private ephemeral inputs, never chat/source/manifests. The account ID alone does not establish sandbox key/access readiness. No historical secret file is a fallback.
3. **State/workflow:** bootstrap state remains local; no migration or remote init occurred. The current runtime root declares guarded S3 key `demo/terraform.tfstate`. Before live planning, review the backend connection/state custody and implement a plan-only isolated assembly that preserves all account/state/plan guards. Do not initialize Terraform in the source root or enable general legacy wrappers. Any bootstrap-state migration is separately approved work.
4. **DNS/certificate gate:** `certificate_dns_confirmed=false` and `start_services=false` remain defaults. Full HTTPS/services require actual ACM validation evidence. The initial root can still propose billable ALB/RDS even with services disabled; do not begin the four-hour window while waiting indefinitely for DNS.

No synthetic image URI, fake Stripe identity or unsupported parameter was used to force a plan. The exact managed-resource inventory and saved-plan hash must come from the future real input-bound Terraform plan; they are not claimed here. Publication, backend preparation and remaining secret/DNS gates precede its review. Free Plan admission for the runtime remains unproven; stop on denial, never upgrade/substitute automatically.

## Four-hour gross estimate

Dated D0 Sydney rates and D2A's conservative two-one-shot-task-hour assumptions were recomputed locally with Python `Decimal`; no new pricing API or paid analytics was enabled. The four hours include provisioning, verification and completed teardown. Start cleanup by hour three.

| Component / allowance                                   |                 Gross USD |
| ------------------------------------------------------- | ------------------------: |
| Fargate services, four hours                            |                   0.18824 |
| RDS instance, four hours                                |                   0.10000 |
| ALB base, four hours                                    |                   0.10080 |
| One average ALB LCU, four hours                         |                   0.03200 |
| Five public IPv4 addresses, four hours                  |                   0.10000 |
| 20-GiB RDS storage prorated four hours                  |     0.0151232876712328767 |
| Two one-shot task-hours, including their IPv4 allowance |                   0.04492 |
| Log / transfer allowances                               |                   0.50000 |
| Monthly ECR/state/request baseline                      |                   0.25000 |
| **Conservative first-session/month total**              | **1.3310832876712328767** |
| **Headroom under the USD 2 envelope**                   | **0.6689167123287671233** |

Persistent post-teardown model: USD 0.25/month; monthly USD 5 headroom after this one-session model: USD 3.6689167123287671233. No hosted-zone allowance is needed. Tax, rounding, traffic/LCU/IP growth, retained images/versions, retries, RDS CPU surplus, teardown delay and unrelated account usage can exceed these estimates. The USD 2 envelope is a review/abort threshold, not a guaranteed charge or enforced cap. Recipient is inactive by accepted operator risk; do not rely on email alerts. Check elapsed time and actual inventory directly during the attended window.

## Manual DNS, sandbox and HTTPS sequence

1. Confirm Cloudflare access to `edtosoy.com`. Never modify `flow.edtosoy.com` or create a Route 53 zone.
2. Review a separate ACM/certificate preparation stage before the short billable runtime window. Requesting a certificate is not authorized by this planning package. Actual ACM CNAME names/values are unknown until approved creation; use the `acm_validation_records` output, never guessed records.
3. Publish those exact ACM CNAMEs DNS-only in Cloudflare; verify public DNS and regional ACM ISSUED status. Retain validation records for renewal. Do not bypass `certificate_dns_confirmed` to start services.
4. Once a separately approved runtime creates the ALB, use its actual `alb_dns_name` output for a DNS-only CNAME at `vigil.edtosoy.com`. Verify HTTPS hostname/chain, redirects and protected dashboard access before any sandbox ingress. Proxying can be considered only after separate origin/webhook verification.
5. Confirm the supplied sandbox account locally. Configure fresh test-only keys/signing secrets securely. Future webhook URL: `https://vigil.edtosoy.com/webhooks/stripe`. Registration, hosted migrations/provisioning and financial-path verification require their separate approved execution steps; none was done here.

## Teardown and next command

The existing teardown command intents below **remain disabled** and require their own Sydney input/state/receipt review and future teardown authorization before use. They were not executed and are not ready as a recovery bypass:

```sh
# Later: retire only this run's dedicated sandbox webhook, if one was created.
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo retire-destination
# Later: produce a fresh runtime-only deletion plan, review it, then apply that saved plan.
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo destroy-plan
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo apply --reviewed
# Later: verify actual removal and empty runtime state.
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:observe destroy-verify
```

Do not plan/apply runtime until a bounded teardown path is ready. Final inventory must show no runtime tasks/services, RDS, ALB/target groups, NAT/public IP allocations, runtime network/IAM/log/SSM resources or unexpected retained snapshots. Remove only explicitly created application DNS/webhook configuration; protect unrelated resources and bootstrap S3/ECR/state. Preserve operator-approved evidence and report any partial/uncertain removal rather than broadly deleting resources.

Safe current command: `AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:demo preflight`. Do not rerun `aws:bootstrap:execute`: its durable marker blocks a second first-bootstrap attempt.

**Next increment:** obtain explicit image-publication approval, produce/verify real image receipts, settle private runtime inputs and the isolated backend/plan-only workflow, then generate the concrete runtime plan and review exact resources/costs/teardown. Runtime apply remains separately unapproved. No runtime, DNS/Stripe changes, image publication, state migration, commit or push occurred during this preparation.
