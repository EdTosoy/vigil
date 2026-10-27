# Sydney D2A — live preflight and deployment readiness

Date: 2026-10-27. Source baseline: `bc14db0` (D1B); initial working tree clean. **CONDITIONAL GO for D2B bootstrap preparation only. NO-GO for provisioning under this authorization.** No provisioning wrapper was enabled, no infrastructure plan was created, and no commit or push was made.

Only this report is added to the repository. Read-only collectors, redacted observations, public DNS answers, deterministic calculations and a controlled source/build/test checkout were kept under `/tmp/vigil-d2a-*`; no additional repository artifact is required. Original deployment/state/cache files and generated Next.js files were left untouched. Historical account `163596511125`, profile `iamadmin-general`, its state/resources and `flow.edtosoy.com` were never targeted. No credentials, raw recipient addresses or individual STS session identifiers are recorded here.

## 1. Identity and execution boundary

The existing D1A command ran successfully **before any other account-specific API query**:

```sh
AWS_PROFILE=edtosoy AWS_REGION=ap-southeast-2 pnpm aws:deploy preflight
```

It verified account exactly `747240980964`, explicit profile `edtosoy`, workload region exactly `ap-southeast-2`, and complete commercial STS ARN structure `arn:aws:sts::747240980964:assumed-role/AccountFullAccessRole/<rotating-session>`, with role name exactly `AccountFullAccessRole`. Inherited credential/profile/region/endpoint/Terraform checks passed. Browser login was already usable; no login or credential issuance was performed. Each subsequent read batch re-used `verifyDeploymentCaller` before queries and would stop on identity/authentication failure. All such checks passed.

`iam:GetRole` independently returned the stable role ARN `arn:aws:iam::747240980964:role/managed/AccountFullAccessRole`, no permissions boundary, an attached AWS `AdministratorAccess` policy and no inline policies. The `managed/` IAM path is not part of the STS role-name field. The role has a 43,200-second maximum session duration; this is a configured ceiling, not proof of remaining session/refresh lifetime.

Workload/catalog/inventory calls used Sydney. Only global Free Tier, Budgets and IAM control-plane reads used `us-east-1`, always with the **new** profile/account. This does not authorize US East workloads. AWS CLI was 2.34.24. UTC was checked before budget calls. Live collection ran approximately 05:19–05:26 UTC, after the initial guard.

## 2. Live Free Plan status

`freetier:GetAccountPlanState` returned:

| Field            | Live value                 | Compared with D0                                  |
| ---------------- | -------------------------- | ------------------------------------------------- |
| Account          | `747240980964`             | Exact approved target                             |
| Plan             | `FREE`                     | Unchanged                                         |
| Status           | `ACTIVE`                   | Unchanged                                         |
| Remaining credit | USD 120                    | USD 0 change from the previously reported balance |
| Expiration       | `2027-04-26T13:49:39.175Z` | Same April 26, 2027 expiry                        |

`GetFreeTierUsage` returned an empty usage list. That does not establish universal service eligibility or absence of all charges. No upgrade, organization enrollment, Cost Explorer activation, paid analytics or commitment was requested. The [plan API](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_freetier_GetAccountPlanState.html) reports account state; it is not a per-feature creation authorization. [AWS Free Plan terms](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) describe selected-service restrictions and account closure at expiry/credit exhaustion. Preserve a Free Plan compatibility gate; do not upgrade to bypass a rejection.

## 3. Budget protection and operator evidence

`budgets:DescribeBudget`, `DescribeNotificationsForBudget` and four `DescribeSubscribersForNotification` calls inspected only `mdp-monthly-gross-usd-5`, with explicit account ID `747240980964`.

| Check            | Observation                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Limit and period | `5.0 USD`, `COST`, `MONTHLY`                                                                                         |
| Gross accounting | `IncludeCredit=false`, `IncludeRefund=false`, `IncludeTax=true`, `IncludeDiscount=false`; unblended/unamortized      |
| Scope            | Empty cost filters; no alternative billing-view ARN returned                                                         |
| Health           | `HEALTHY`                                                                                                            |
| Reported actual  | USD 0.0; last updated `2026-10-26T22:12:49.510Z`                                                                     |
| Notifications    | ACTUAL thresholds 50, 80, 100 and FORECASTED 100; `GREATER_THAN`; all reported `OK`                                  |
| Subscribers      | One present EMAIL subscriber per notification; raw addresses deliberately omitted                                    |
| Delivery         | **Operator explicitly confirmed receipt during D2A.** This is manual attestation, separate from subscription records |

The notification responses omitted `ThresholdType`. Record the returned values without silently asserting their units. The [Notification API](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_Notification.html) permits both percentage and absolute types; confirm the console displays the intended percentages before billable work. If percentage-based, the corresponding USD triggers are 2.50, 4.00 and 5.00, computed from the observed budget. Delivery confirmation does not resolve this omitted field.

The reported actual is delayed billing evidence, not a real-time guarantee of no spend. Alerts do not enforce a hard cap or destroy resources. Budget ownership remains external to Vigil: no duplicate, import, subscription change or update was made.

## 4. Compatibility matrix

**V** means a specific fact is supported by a live read; **P** means operational success remains plausible but unproven until separately approved provisioning; **B** means a confirmed restriction or missing prerequisite. A V read never proves a Create/Put/PassRole action will succeed.

| Service/boundary   | V — verified read-only facts                                                                                                                          | P — still unproven                                                                                                          | B — known restriction/prerequisite                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| ECS/Fargate        | Sydney quota 30 on-demand vCPU; ECS read endpoint accessible; no clusters; VCPU limit enabled                                                         | First cluster/service/task launch, Fargate capacity, platform/image execution, Free Plan admission and service-linked roles | No observed creation denial; creation is unauthorized in D2A                             |
| RDS                | PostgreSQL 18.6 `available`, family `postgres18`; `db.t4g.micro`, VPC/encryption and gp3 supported; gp3 minimum 20 GiB; all three Sydney zones listed | Exact private Single-AZ create, master/SSM provisioning, engine/parameter behavior and actual TLS connection                | No database exists to validate a live handshake                                          |
| ALB/network        | Both required AZ names available; ordinary ALB/VPC quotas accommodate the proposed counts; no existing ALB/NAT                                        | ALB creation/capacity, public task egress and actual SG enforcement                                                         | Reserved ALB LCU quota is zero; reservations are not requested by this design            |
| ECR                | Registry ID is the new account; BASIC scanning; no repositories; default repository quota visible                                                     | Repository creation, basic scan-on-push, immutable publication/pull and actual image digests                                | No images published; no usable new-account deployment receipt yet                        |
| S3/state           | Account bucket list empty; expected-owner HeadBucket for the planned new name returned 404                                                            | Exclusive name allocation, bucket creation, ownership, encryption/versioning/policy and backend authentication/locking      | No bucket/backend exists; remote init/migration remains prohibited                       |
| IAM                | Expected role/policy metadata; final read-only simulation reports allowed for 18 representative actions                                               | Actual resource-specific conditions, session restrictions, service-side/Free Plan admission and new narrow workload roles   | Simulation is not execution or approval                                                  |
| SSM                | Standard default tier; high-throughput disabled; 10,000 standard-parameter quota; no `/flow/demo/` parameters                                         | Standard SecureString write-only provisioning and actual ECS secret injection                                               | No secret values read or created                                                         |
| ACM/DNS            | Regional certificate list returned no entries; Cloudflare parent NS observed; intended host is NXDOMAIN                                               | Certificate request/issuance and private operator DNS access                                                                | No certificate or hostname exists; manual validation and separate authorization required |
| Application/Stripe | D1B local images exist; clean production compile/typecheck succeeds; guard tests pass                                                                 | Hosted read/security/financial proof and sandbox ingress/backfill                                                           | Operator says Cloudflare DNS and Stripe sandbox access are **not yet verified**          |

No required service was proved prohibited by the Free Plan. Equally, no successful read or simulation proves the complete stack can be provisioned on it. Do not change instance sizes, enable enhanced scanning/paid endpoints, request LCU reservations or upgrade the plan as an implicit workaround. [ALB LCU reservations](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/capacity-unit-reservation.html) are an explicit minimum-capacity feature; zero reserved-LCU quota is not a zero ordinary-ALB quota.

### Resource demand and quotas

The source still specifies three long-running tasks, each 256 CPU units: ops 1 GiB, ingress/worker 0.5 GiB each. Steady demand is **0.75 vCPU / 2 GiB**. Adding one 0.25-vCPU one-shot task gives 1.00 vCPU; even both admin and verifier concurrently would be 1.25 vCPU. All comparisons/calculations in this report were executed with Python/Decimal, not inferred from names or marketing offers.

| Quota                             | Live observation                                               | Proposed demand / limit of evidence                                                                                                    |
| --------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Fargate on-demand vCPU            | 30 (`L-3032A538`)                                              | 0.75 steady; 1.25 conservative simultaneous-task peak fits                                                                             |
| Fargate on-demand launch rates    | Burst 100, sustained 20                                        | No quota increase requested; actual task placement not tested                                                                          |
| RDS DB instances                  | Used 0, maximum 40                                             | One disposable instance fits                                                                                                           |
| RDS allocated storage             | Used 0, maximum 100,000 GiB                                    | 20 GiB fits; gp3 orderable range 20–6,144 GiB                                                                                          |
| Application load balancers        | 50                                                             | One proposed; zero present                                                                                                             |
| Target groups / listeners / rules | 3,000 regional target groups; 50 listeners/ALB; 100 rules/ALB  | Two target groups, two listeners and a Stripe path rule                                                                                |
| VPCs / subnets                    | 5 VPCs/region; 200 subnets/VPC                                 | One existing default VPC; one new VPC/four subnets fit                                                                                 |
| IGWs / ENIs / SGs                 | 5 IGWs/region; 5,000 ENIs/region; 2,500 SGs/region; 5 SGs/ENI  | Source uses a separate IGW and narrow task groups; every existing ENI/SG was not enumerated                                            |
| Elastic IPs                       | Applied quota 5 (`L-0263D0A3`); allocations 0                  | No EIP allocation planned; ALB/task public IPv4 still incurs applicable usage                                                          |
| ECR repositories                  | Default 100,000 (`L-CFEB8E8D`, “Registered repositories”)      | Three planned; an account-applied override was not returned by ListServiceQuotas                                                       |
| ACM certificates                  | Default 2,500; annual creation default 5,000                   | One planned; GetServiceQuota for the applied certificate limit returned `NoSuchResourceException`, not a zero quota or creation denial |
| Standard SSM parameters           | Applied 10,000                                                 | Nine planned runtime parameters; tier explicitly Standard                                                                              |
| S3 buckets                        | No applicable quota value returned by the Sydney quota queries | Name absence is observed; bucket allocation/Free Plan creation permission remains unproven                                             |

The SSM/EC2 general quota lists were bounded first pages, not exhaustive catalogs. Targeted EIP and standard-parameter evidence is reported above. ECR/ACM values are explicitly defaults rather than falsely labeled account-applied limits. No quota increases were requested.

The available AZs are `ap-southeast-2a` (`apse2-az1`), `ap-southeast-2b` (`apse2-az3`) and `ap-southeast-2c` (`apse2-az2`), all available/opt-in-not-required. The source's a/b selection is supported by this account's catalog.

Effective ECS settings were read to completion with a bounded two-page request after correcting an oversized-page error. Container Insights and GuardDuty activation are disabled; task/service/container long ARN formats and Fargate vCPU limit are enabled; tag-resource authorization is on; default logging is non-blocking. `awsvpcTrunking` is disabled, which concerns EC2 capacity rather than this Fargate design. IPv6 is enabled at the account setting, but the source does not allocate an IPv6 VPC/subnet. No setting was changed.

The final IAM simulation used the **exact GetRole ARN including `managed/`**, `aws:RequestedRegion=ap-southeast-2` and wildcard resource context. It returned `allowed`, no missing context, and `AllowedByOrganizations=true` for S3 bucket creation/versioning, ECR repository/lifecycle, RDS instance creation, ECS cluster/service/task-definition, ALB, ACM, SSM, logs, VPC/subnet, and IAM create/pass/service-linked-role/inline-policy actions. The earlier pathless-role simulation is retained in the action count but superseded for assurance. The simulator's modeled Organizations result does not establish all real session, account-plan, resource or service-side restrictions.

## 5. Existing resources and conflicts

Sydney inventory returned **zero** ECS clusters (therefore no cluster-associated services/tasks), RDS instances/clusters, load balancers, NAT gateways, allocated EIPs, EC2 instances, EBS volumes, VPC endpoints, ECR repositories and CloudWatch log groups. Zero `/flow/demo/` SSM parameters were returned. The ACM list returned zero certificates under the query's default filters. The account-wide S3 bucket list returned zero buckets. All inventory result pages were untruncated.

A pre-existing default VPC, `vpc-079c01f0002c7f59d` (`172.31.0.0/16`), and its three default subnets exist. They are not Vigil resources and must not be deleted or imported. No existing VPC CIDR overlaps the proposed separate `10.42.0.0/16` in this regional inventory. Peered/remote network address spaces were not audited.

The exact planned state bucket `flow-demo-tfstate-747240980964-ap-southeast-2` was queried with expected owner `747240980964`; HeadBucket returned 404. Together with the empty owned-bucket list this is consistent with no existing target bucket, but **does not reserve the globally unique name, prove ownership, or guarantee CreateBucket**. Recheck immediately before a later approved bootstrap. No objects/state were listed or downloaded.

No existing billable resource in the queried Sydney categories was found. This is not an exhaustive all-service/all-region cost audit. Other workload regions were deliberately not queried; budget/credit observations remain account-wide and delayed. No unfamiliar resource was attributed to Vigil or changed.

## 6. Terraform and isolation review

Read/reviewed `infra/AGENTS.md`, D0/D1A/D1B runbooks, source roots, provider locks, Docker/source configuration and safety tests. D2A ran **no Terraform command**, no live plan and no remote backend connection.

- D1A validates full structured STS account/role fields, explicit `edtosoy`/Sydney selectors and inherited-configuration conflicts. Rotating session names remain supported; no default-profile fallback is accepted.
- Both Terraform providers use exact-validated target variables and `allowed_account_ids`. The demo S3 backend and bootstrap backend contract restrict the new account/profile/region, encryption and native `use_lockfile=true` locking. Bootstrap/runtime keys are distinct.
- Artifact paths remain beneath `.deployment/747240980964/ap-southeast-2/{bootstrap,demo}/`; path checks reject traversal, symlinks and shared/hard-linked files. Source assembly is allowlisted, exclusive and hash-bound; no legacy generated backend/cache/state/plan/image manifest is a fallback.
- First bootstrap requires a fresh local lineage, reviewed seed plan, then separately approved new-lineage migration only after bucket ownership/security verification. The backend cannot create its own bucket. Backend login, ownership and actual native-lock behavior are untested until the new bucket exists under later approval.
- No `-lock=false` or automatic `force-unlock` path was found. **A dormant migration helper still contains `-migrate-state -force-copy`.** It is unreachable behind unconditional entry and executor gates, and was not executed. D2B must not call it, remove the gates wholesale or treat this legacy helper as approved migration machinery.
- Bootstrap apply, runtime apply/destroy, backend connect/migration, ECR publication, secret workflows, remote provisioning/tasks, Stripe actions and legacy deployed observers remain disabled. No wrapper was enabled. The only newly relevant planner for D2B must be explicitly scoped and preserve all mutating gates.
- Source retains S3 versioning/encryption/public-access blocks/HTTPS-only policy, immutable ECR, protected bootstrap, private encrypted disposable RDS, non-root digest-pinned images, sandbox mode, ephemeral/write-only secret inputs and narrow owner-free runtime/verifier roles. No financial/schema changes were made.

Existing safety test files were executed from the controlled temporary source context with fake AWS/Terraform executables: **25 passed**. This exercises historical-target refusal, credentials/endpoint/CLI overrides, symlink/hard-link/traversal, missing/foreign backend, stale plans/manifests, offline-command allowlisting and modifying-wrapper refusal. Mock calls are separate from the live API ledger below.

## 7. DNS and certificate observations

Fourteen public DNS-over-HTTPS queries used independent Cloudflare and Google recursive resolvers. Both observed:

- `edtosoy.com` NS: `albert.ns.cloudflare.com` and `nora.ns.cloudflare.com`.
- Apex CAA query: NOERROR with no CAA answer. This is an observation, not future issuance assurance.
- `vigil.edtosoy.com` A, AAAA, CNAME, NS and CAA queries: **NXDOMAIN**, with the parent SOA in authority. No existing public record/delegation conflict was observed at that name. Recursive/cached observations do not establish private Cloudflare configuration or operator access.

No query or mutation targeted historical `flow.edtosoy.com`. The operator explicitly reported that Cloudflare DNS and Stripe sandbox access are **not yet verified**.

After separate certificate-request approval, request ACM in **Sydney**, the same region as the intended ALB; publish its actual validation CNAME(s) manually in Cloudflare, DNS-only, preserving underscores. STOP for public CNAME verification and actual ISSUED status. After separately approved ALB creation, publish `vigil` as a DNS-only CNAME to the **actual** ALB hostname. No current ALB hostname or ACM tokens exist to publish. No hosted zone or parent NS change is needed. Keep proxying disabled for initial certificate/HTTPS/webhook verification; later proxy changes require separate review. See [ACM DNS validation](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html).

Later hosted checks must verify chain/hostname/HTTPS redirect, fail-closed demo operator authentication, separate technical/financial health, and the explicitly authorized sandbox webhook `https://vigil.edtosoy.com/webhooks/stripe`. No DNS, ACM or Stripe action was performed now.

## 8. Build and generated-type investigation

D1B's retained operations build log shows successful Next 16.4.3 production compilation and TypeScript checking, followed by standalone/static/public copies. Existing local `vigil-d1b-{ops,stripe,admin}:local` images were inspected: all are Linux amd64 and use the `node` user; their local IDs match D1B logs. They were not rebuilt/published in D2A. This does not create a new-account ECR digest or prove hosted execution.

Investigation used committed HEAD source from `git archive` in a fresh `/tmp/vigil-d2a-clean-*` checkout, with existing installed dependency directories linked there. No `.next`, environment, state or deployment artifacts were copied, and no original cache was deleted or generated file edited.

| Executed check                                                                            | Result                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Original checkout: `tsc -p apps/ops/tsconfig.json --noEmit --incremental false`           | FAIL, duplicate `LayoutProps`/incompatible `RouteContext` from both `.next/dev/types` and `.next/types`, reproducing D1A/D1B |
| Clean temporary source: same standalone typecheck                                         | PASS                                                                                                                         |
| Clean temporary `next build --webpack`                                                    | PASS, compilation/static generation and TypeScript checking                                                                  |
| Post-production-build temporary standalone typecheck                                      | PASS                                                                                                                         |
| Direct Node/tsx invocation of existing deployment/access test files in temporary checkout | PASS, 25 tests after completing temporary workspace dependency links                                                         |
| Packaged RDS CA checksum/self-signatures                                                  | PASS; live RDS lists `rds-ca-rsa2048-g1`, matching the packaged Sydney root's 2061 expiry                                    |

The current ignored `next-env.d.ts` imports dev declarations while tracked tsconfig also includes production `.next/types`; installed Next's `writeAppTypeDeclarations` selects imports from its active output directory. A Git comparison from pre-D1A `bcfc050` to HEAD shows no D1A/D1B change to ops tsconfig, Next config or package manifest. The evidence supports **stale overlapping generated artifacts**, not a source regression introduced by D1A/D1B. The original checkout still fails; no unrelated fix is included.

Temporary-context limitations: dependencies were reused, not freshly installed. Next warned that linked external dependency paths were outside the temporary standalone tracing root; therefore this experiment proves clean compilation/typechecking, not a new deployable standalone artifact. D1B's separate clean Docker build/packaging evidence remains the image evidence. A temporary `pnpm test:deployment` attempt refused automatic reinstallation across its dependency symlink before tests ran; direct Node/tsx ran the same existing files. Initial missing library dependency links were completed only in `/tmp`. No root Nx build was claimed, no tests were weakened, and no dependency install or production cache cleanup was performed.

## 9. Cost and execution limits

Rates remain the dated D0 public-price baseline from `2026-10-26T23:15:12.651Z`; no price API or paid billing analytics was invoked. Source sizing and the live RDS catalog agree: 0.75 Fargate vCPU/2 GiB, one 20-GiB gp3 micro database, one ALB, at least five active public IPv4 addresses, and on-demand one-shot work. RDS/ALB/IP charges persist even if ECS services are disabled. Public task IPs are not EIP allocations.

Decimal recomputation from the JSON's rates, with the unused Route 53 hosted-zone allowance removed:

| Estimate                                                   | Gross USD planning value |
| ---------------------------------------------------------- | -----------------------: |
| Steady three-task Fargate compute/hour                     |                  0.04706 |
| Full active stack/hour excluding storage                   |                  0.13026 |
| Full active stack/hour including prorated RDS storage      |               0.13404082 |
| Four-hour runtime/storage component                        |                  0.53616 |
| Retained monthly ECR (2 billing GB) + S3/request allowance |                     0.25 |
| Monthly log/transfer allowance                             |                     0.50 |
| Two monthly one-shot task-hours                            |                  0.04492 |
| One four-hour window/month with these allowances           |              **1.33108** |
| Four four-hour windows/month with these allowances         |              **2.93957** |
| Model headroom against $5 after one/four windows           |    **3.66892 / 2.06043** |

The D0 JSON's stored one-window result uses the equivalent of **0.5 one-shot hour**, whereas its stated monthly input is two hours. With its original hosted-zone allowance, fixed-two-hour recomputation is $1.83108, $0.03369 above the stored $1.79739. Prorating one-shot time reproduces that stored figure. The current conservative recommendation keeps the full two-hour allowance and removes only the unused $0.50 hosted zone. The JSON is unchanged; these are explicit scenario assumptions, not a newly fetched price quote or guaranteed bill.

Recommend requesting, before any runtime provisioning, a **maximum four-hour attended first window**, including creation, proof and completed teardown; begin cleanup by hour three. Request a **$2 gross first-window/monthly-baseline envelope**, leaving $3 of the $5 monthly budget unallocated at that approval ceiling. The modeled $1.33108 leaves about $0.66892 inside that envelope before tax, rounding, retries, traffic/LCU/IP growth and unrelated spend. This is a stop/review threshold, not an automated spending control. Later windows require fresh account-wide spend/credit checks and new headroom calculations. Credits are not subtracted from gross estimates.

Retained ECR/S3 usage, versions, request rates and untagged/tagged image growth must be inventoried after teardown. The $0.25 retained estimate assumes 2 billing GB of ECR and $0.05 S3/requests; unused log/secret/certificate/DNS leftovers can change it. Any retained runtime RDS/ALB/public IP/NAT/instance blocks a clean teardown claim. Stopping ECS or observing a successful command alone is insufficient.

Abort/defer the future provisioning window on identity drift, exhausted/expired plan, denied required Free Plan feature, insufficient capacity/quota, unowned state/bucket, stale/foreign plan/image receipt, unexpected permanent/paid resource, missing TLS/access/secrets/DNS proof, projected envelope breach, unexplained gross usage, inadequate session/cleanup time or failed recovery/teardown proof. Use only the separately approved incident/teardown procedure; do not upgrade the plan or mutate financial history to recover.

## 10. Manual gates and recommendation

| Gate                                                          | D2A disposition                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Correct browser-authenticated AWS session/account/role/region | PASS now; fresh guard still required for every later phase/execution                                                               |
| Free Plan active/credits/expiry                               | Live PASS; per-service creation compatibility remains conditional                                                                  |
| Relevant regional quotas/AZ/catalog                           | Main runtime counts fit live evidence; ECR/ACM defaults and S3 quota limits remain qualified as above                              |
| Budget delivery                                               | Operator-confirmed PASS; confirm omitted threshold units in console before billable work                                           |
| Approved maximum duration/gross cost                          | Proposed four hours / $2; **not approved by this report**                                                                          |
| Cloudflare DNS access                                         | Operator: not yet verified; manual prerequisite                                                                                    |
| ACM validation                                                | No certificate requested; publish actual future CNAMEs only after separate approval and public verification                        |
| Stripe sandbox account/access/secrets                         | Operator: not yet verified; privately verify and later authorize dedicated destination/test capture; never send secrets in chat    |
| Concrete bootstrap plan                                       | Not created; belongs to explicitly authorized D2B                                                                                  |
| Bootstrap provisioning/migration                              | Separate approval required after concrete plan/security review                                                                     |
| Runtime deployment/publication/provisioning                   | Separate later plan and approval required; no image digest invented                                                                |
| Teardown/recovery readiness                                   | Must approve an attended window, preserve source/state/evidence, ensure reauthentication/recovery access and verify actual cleanup |

Post-destroy inventory must check ECS services/running/pending tasks, RDS instances/clusters and chargeable snapshots, ALB/target/listener resources, runtime public IPs/EIPs/ENIs, VPC/NAT/endpoints, EC2/EBS, runtime SSM/IAM/logs/ACM, manual `vigil` application DNS and empty **new-target** runtime state. Retain only explicitly approved S3/ECR and account-budget ownership; protect existing default/unrelated resources. Preserve append-only financial/ingestion evidence and unknown outcomes; no rollback by state rewinding or posted-history mutation.

**CONDITIONAL GO for bootstrap preparation:** verified identity, unchanged plan/credit balance, gross budget, service catalog/AZs, relevant quotas and an empty new-target inventory justify preparing a reviewable seed plan. They do not justify execution. Cloudflare/Stripe access can be confirmed before their relevant later phases; Free Plan admission, native provider/backend login and actual bucket/security/lock behavior remain gates.

**Recommended D2B scope, only after a new explicit user instruction:** prepare a dedicated guarded **bootstrap plan-only** workflow against fresh Sydney local seed state, verify real pinned-provider browser-login reads and current gross budget, bind the saved plan to exact target/source/inputs/new state identity, and present only new S3/ECR changes for review. Keep all apply/destroy/migration/publication/Stripe/DNS paths disabled. Do not initialize a remote backend, use old state, invoke the dormant force-copy helper, request ACM, publish images or prepare/run runtime provisioning. Obtain separate user approval of the concrete bootstrap plan before any billable creation. D2A stops here.

## 11. AWS action ledger

There were **65 read-only CLI operation invocations**, including the initial D1A preflight, subsequent batch identity checks and rejected read requests. This is a logical command ledger, not a wire-level retry audit. Catalog/inventory calls used bounded pages; no unbounded account scan was performed. The ledger excludes local CLI version/help/output-skeleton introspection, public DNS/HTTPS documentation and mocked test calls. Every operation below is read-only; simulated Create/Put/PassRole names are IAM simulation inputs, not executed APIs.

S = `ap-southeast-2`; G = `us-east-1` global control plane. Every row uses `edtosoy` in the new account.

| API action                                   | Endpoint | Invocations | Result                    | Read-only |
| -------------------------------------------- | -------- | ----------: | ------------------------- | --------- |
| `acm:ListCertificates`                       | S        |           1 | PASS                      | Yes       |
| `budgets:DescribeBudget`                     | G        |           1 | PASS                      | Yes       |
| `budgets:DescribeNotificationsForBudget`     | G        |           1 | PASS                      | Yes       |
| `budgets:DescribeSubscribersForNotification` | G        |           4 | PASS                      | Yes       |
| `ec2:DescribeAddresses`                      | S        |           1 | PASS                      | Yes       |
| `ec2:DescribeAvailabilityZones`              | S        |           1 | PASS                      | Yes       |
| `ec2:DescribeInstances`                      | S        |           1 | PASS                      | Yes       |
| `ec2:DescribeNatGateways`                    | S        |           1 | PASS                      | Yes       |
| `ec2:DescribeSubnets`                        | S        |           1 | PASS                      | Yes       |
| `ec2:DescribeVolumes`                        | S        |           1 | PASS                      | Yes       |
| `ec2:DescribeVpcEndpoints`                   | S        |           1 | PASS                      | Yes       |
| `ec2:DescribeVpcs`                           | S        |           1 | PASS                      | Yes       |
| `ecr:DescribeRepositories`                   | S        |           1 | PASS                      | Yes       |
| `ecr:GetRegistryScanningConfiguration`       | S        |           1 | PASS                      | Yes       |
| `ecs:ListAccountSettings`                    | S        |           1 | InvalidParameterException | Yes       |
| `ecs:ListAccountSettings`                    | S        |           3 | PASS                      | Yes       |
| `ecs:ListClusters`                           | S        |           1 | PASS                      | Yes       |
| `elasticloadbalancing:DescribeAccountLimits` | S        |           1 | PASS                      | Yes       |
| `elasticloadbalancing:DescribeLoadBalancers` | S        |           1 | PASS                      | Yes       |
| `freetier:GetAccountPlanState`               | G        |           1 | PASS                      | Yes       |
| `freetier:GetFreeTierUsage`                  | G        |           1 | PASS                      | Yes       |
| `iam:GetRole`                                | G        |           1 | PASS                      | Yes       |
| `iam:ListAttachedRolePolicies`               | G        |           1 | PASS                      | Yes       |
| `iam:ListRolePolicies`                       | G        |           1 | PASS                      | Yes       |
| `iam:SimulatePrincipalPolicy`                | G        |           2 | PASS                      | Yes       |
| `logs:DescribeLogGroups`                     | S        |           1 | PASS                      | Yes       |
| `rds:DescribeAccountAttributes`              | S        |           1 | PASS                      | Yes       |
| `rds:DescribeCertificates`                   | S        |           1 | PASS                      | Yes       |
| `rds:DescribeDBClusters`                     | S        |           1 | PASS                      | Yes       |
| `rds:DescribeDBEngineVersions`               | S        |           1 | PASS                      | Yes       |
| `rds:DescribeDBInstances`                    | S        |           1 | PASS                      | Yes       |
| `rds:DescribeOrderableDBInstanceOptions`     | S        |           1 | PASS                      | Yes       |
| `s3:HeadBucket`                              | S        |           1 | 404                       | Yes       |
| `s3:ListBuckets`                             | S        |           1 | PASS                      | Yes       |
| `servicequotas:GetServiceQuota`              | S        |           1 | NoSuchResourceException   | Yes       |
| `servicequotas:GetServiceQuota`              | S        |           1 | PASS                      | Yes       |
| `servicequotas:ListAwsDefaultServiceQuotas`  | S        |           3 | PASS                      | Yes       |
| `servicequotas:ListServiceQuotas`            | S        |           9 | PASS                      | Yes       |
| `ssm:DescribeParameters`                     | S        |           1 | PASS                      | Yes       |
| `ssm:GetServiceSetting`                      | S        |           2 | PASS                      | Yes       |
| `sts:GetCallerIdentity`                      | S        |           8 | PASS                      | Yes       |

The HeadBucket 404 is recorded as an absence observation, not a successful ownership test. The applied ACM quota read returned `NoSuchResourceException`; no limit was guessed from that error. One ECS account-settings request used an invalid oversized page and was replaced with two valid bounded pages. Two IAM simulations were read-only; the final exact managed-role-ARN result supersedes the preliminary pathless source for assurance. No IAM/Free Plan creation permission is inferred from these reads.

## 12. Deliverable verification

Only `docs/phase15/sydney-d2a.md` was added. Report formatting and `git diff --check` are checked before completion; no implementation/configuration/financial file, original generated cache or provisioning gate is changed. Zero AWS resource mutations, zero historical-account calls, zero remote Terraform/state operations, zero ECR publication, zero cloud migrations, zero DNS/Stripe changes, zero account upgrades, zero commits/pushes. Phase 16 remains deferred.
