# Sydney morning checklist

Use [the cycle runbook](sydney-cycles.md) for the full commands and stop points.
This checklist grants no cloud execution authority. The offline audit did not
refresh AWS identity, permissions, costs, DNS, images or teardown evidence.

1. Review and commit the intended local changes separately, then require clean
   HEAD. Use Node 24, pnpm 11.27.0 and Terraform 1.15.3. Run `pnpm typecheck`
   (which regenerates operations route types); do not restore development
   imports into `apps/ops/next-env.d.ts` after a production build or typegen.
2. Before another cycle, verify the previous teardown. For the failed-verification
   cycle, set `VIGIL_CYCLE=34081db1-ae37-4bf7-9664-b9611193ae1b` and, with
   approved AWS read access, run only:

   ```sh
   AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 \
     pnpm aws:runtime:cycle verify-teardown "$VIGIL_CYCLE" --cloud-approved
   ```

   Require authoritative empty state, the retained lineage and native absence
   proof. Preserve failed receipts, claims and state versions. If this fails,
   inspect the specific state/inventory error; never retry the old apply,
   delete history, unlock or modify state to manufacture success. Actual live
   resources require a fresh, separately approved recovery plan.

3. Confirm fresh browser authentication for **edtosoy / 747240980964 /
   ap-southeast-2**, exact backend State-role permissions, versioned state,
   existing ECR repositories and deployment service admission. Stop on an SCP
   denial; do not change account plans, roles or security controls to proceed.
4. Review account-wide gross spend, remaining credits/Free Plan status and the
   existing USD 5 budget/notifications. Budget alerts **do not cap spending**.
   Agree on attended cleanup authority and completion within four hours; no
   new resource work after T+3h. If email delivery remains unverified, use the
   explicit UNKNOWN acknowledgement, never the confirmed-delivery flag.
5. Prepare a **new** cycle and hidden admin/sandbox inputs. After the real spend
   review and cleanup commitment, record fresh operator checks using
   `--acknowledge-unverified-budget-alert-delivery`, `--account-spend-reviewed`
   and `--cleanup-window-confirmed`. Assertions expire after one hour.
6. With separate publication/execution approval, publish fresh committed-source
   immutable images for that cycle. Plan/review/apply **infrastructure**, then
   **provisioning**; run `provision` once for migrations, seeding and current
   permission/binding evidence. Use each stage's fresh review ID within thirty
   minutes. Stop on unexpected deletes/replacements, state conflicts, costs or
   unknown outcomes.
7. Stop for actual manual Cloudflare ACM validation and application CNAMEs,
   DNS-only, for **vigil.edtosoy.com**. Require current ALB DNS and ACM ISSUED;
   do not assume Route 53 delegation. Plan/review/apply **https**, separately
   approve `destination`, then plan/review/apply **active** and run `verify`.
8. Capture the URL, HTTPS, administrator session/dashboard and authorization
   evidence. Technical checks do not prove reconciliation or financial PASS;
   any signed sandbox/reconciliation demonstration needs separate evidence and
   approval. Never expose privileged financial writes.
9. Before T+4h, plan **teardown**, review its complete deletion-only runtime
   inventory and owned one-shot stops, apply that new review, then run
   `verify-teardown`. Persistent bootstrap resources and state survive.
   Separately approve dedicated sandbox destination retirement and application
   DNS retirement. Never automatically retry a failed or uncertain apply.
