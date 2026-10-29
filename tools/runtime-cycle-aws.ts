/** Fixed Sydney AWS/Stripe driver. Imported only after explicit --cloud-approved. */
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, chmod, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  assertDeploymentEnvironment,
  assertGrossBudget,
  deployment,
} from './deployment-guards';
import { verifyDeploymentCaller } from './deployment-preflight';
import {
  assertFreePlan,
  releaseProof as proof,
  claimRuntimeOperation,
} from './runtime-apply-review';
import {
  runtimeStateRoleName,
  runtimeStatePolicyName,
  runtimeStateDocument,
  assertRuntimeStateRole,
} from './runtime-state-role';
import {
  runtimeCycleStore,
  privateCycleJson,
  cycleHash,
  type CycleDriver,
} from './runtime-cycle';
import {
  cycleInstances,
  retainedCycleEcsMetadata,
  assertCycleOperatorChecks,
  unverifiedBudgetAlertWarning,
  assertCycleImages,
  type CycleState,
  type CycleBindings,
} from './runtime-cycle-review';
import {
  sandboxKey,
  stripeReader,
  object,
  STRIPE_API_VERSION,
  EVENT_TYPES,
} from '@vigil/stripe-integration';

export async function runtimeCycleDriver(
  repository: string,
  id: string,
  inherited: NodeJS.ProcessEnv,
): Promise<CycleDriver> {
  assertDeploymentEnvironment(inherited);
  const store = runtimeCycleStore(repository, id),
    { context, path } = store;
  const config = await store.load();
  const env = {
    ...inherited,
    AWS_DEFAULT_REGION: deployment.region,
    AWS_PAGER: '',
    AWS_CLI_AUTO_PROMPT: 'off',
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_MAX_ATTEMPTS: '1',
    TF_IN_AUTOMATION: '1',
    CHECKPOINT_DISABLE: '1',
  };
  // These commands never print/persist stdout/stderr. A provider error can contain
  // connection data or secrets; only locally constructed diagnostics may escape.
  function command(
    program: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number } = {},
  ) {
    const r = spawnSync(program, args, {
      env: options.env ?? env,
      cwd: options.cwd ?? repository,
      encoding: 'utf8',
      timeout: options.timeout ?? 30000,
      maxBuffer: 32 * 1024 * 1024,
    });
    proof(
      !r.error && r.status === 0,
      `${program} command failed; retain private artifacts and review recovery; no automatic retry`,
    );
    return r.stdout;
  }
  const identity = () => verifyDeploymentCaller(inherited);
  const readOperations = new Set([
    's3api:head-object',
    's3api:get-object',
    's3api:get-bucket-versioning',
    's3api:get-bucket-location',
    'freetier:get-account-plan-state',
    'budgets:describe-budget',
    'iam:get-role',
    'iam:get-role-policy',
    'iam:list-role-policies',
    'iam:list-attached-role-policies',
    'iam:list-roles',
    'ecs:describe-clusters',
    'ecs:list-tasks',
    'ecs:describe-tasks',
    'ecs:describe-task-definition',
    'ecs:describe-services',
    'rds:describe-db-instances',
    'rds:describe-db-snapshots',
    'elbv2:describe-load-balancers',
    'elbv2:describe-target-groups',
    'elbv2:describe-target-health',
    'ssm:describe-parameters',
    'logs:describe-log-groups',
    'logs:get-log-events',
    'acm:list-certificates',
    'acm:describe-certificate',
    'resourcegroupstaggingapi:get-resources',
    'ecr:describe-images',
    'ecr:batch-get-image',
  ]);
  function aws(
    service: string,
    op: string,
    args: string[] = [],
    mutation = false,
    optional = false,
  ) {
    proof(
      readOperations.has(`${service}:${op}`) ||
        (mutation &&
          service === 'ecs' &&
          ['run-task', 'stop-task'].includes(op)),
      'Unsupported cycle AWS capability',
    );
    if (mutation) identity();
    const r = spawnSync(
      'aws',
      [
        service,
        op,
        ...args,
        '--profile',
        deployment.profile,
        '--region',
        ['freetier', 'budgets'].includes(service)
          ? 'us-east-1'
          : deployment.region,
        '--output',
        'json',
        '--no-cli-pager',
        '--cli-connect-timeout',
        '5',
        '--cli-read-timeout',
        '15',
      ],
      { env, encoding: 'utf8', timeout: 25000, maxBuffer: 16 * 1024 * 1024 },
    );
    if (
      optional &&
      !r.error &&
      r.status !== 0 &&
      /\(404\)|\(NoSuchKey\)|\(NotFound\)/.test(r.stderr)
    )
      return null;
    proof(
      !r.error && r.status === 0,
      `Sydney ${service}:${op} denied/failed; no IAM repair, fallback or automatic retry`,
    );
    const v = JSON.parse(r.stdout || '{}');
    proof(
      !v.NextToken &&
        !v.nextToken &&
        !v.PaginationToken &&
        !v.Marker &&
        !v.IsTruncated,
      'Truncated inventory refused',
    );
    return v;
  }
  const s3 = (op: string, key: string, rest: string[] = [], optional = false) =>
    aws(
      's3api',
      op,
      [
        '--bucket',
        deployment.bucket,
        '--key',
        key,
        '--expected-bucket-owner',
        deployment.account,
        ...rest,
      ],
      false,
      optional,
    );
  async function snapshot(): Promise<CycleState> {
    identity();
    proof(
      !s3('head-object', 'demo/terraform.tfstate.tflock', [], true),
      'Existing lock: stop; never force-unlock',
    );
    const before = s3('head-object', 'demo/terraform.tfstate');
    proof(
      typeof before.VersionId === 'string' &&
        before.VersionId !== 'null' &&
        before.ETag,
      'Existing versioned Sydney state required; no genesis or historical-state fallback',
    );
    const file = path(`state-${randomUUID()}.json`);
    s3('get-object', 'demo/terraform.tfstate', [
      '--version-id',
      before.VersionId,
      file,
    ]);
    await chmod(file, 0o600);
    const bytes = await readFile(file);
    const state = JSON.parse(bytes.toString());
    proof(
      isDeepStrictEqual(s3('head-object', 'demo/terraform.tfstate'), before),
      'State changed while reading its exact current version',
    );
    proof(state.version === 4, 'Unsupported Terraform state format');
    const result = {
      versionId: before.VersionId,
      etag: before.ETag,
      sha256: cycleHash(bytes),
      state,
    };
    cycleInstances(result);
    return result;
  }
  async function inventory() {
    identity();
    // Tag discovery covers all tagged runtime types, including networks, ENIs,
    // certificates and parameters. Fixed-name probes also catch untagged orphans.
    const tagged = aws('resourcegroupstaggingapi', 'get-resources', [
      '--tag-filters',
      'Key=Project,Values=vigil',
      'Key=Environment,Values=demo',
      'Key=Lifecycle,Values=ephemeral',
    ]);
    const found: string[] = (tagged.ResourceTagMappingList ?? []).map(
      (r: { ResourceARN: string }) => r.ResourceARN,
    );
    const cluster = aws('ecs', 'describe-clusters', [
      '--clusters',
      'flow-demo',
    ]);
    proof(
      (cluster.failures ?? []).every(
        (f: { reason: string }) => f.reason === 'MISSING',
      ),
      'Cluster discovery failed',
    );
    for (const c of cluster.clusters ?? [])
      if (c.status !== 'INACTIVE') found.push(c.clusterArn);
    for (const db of aws('rds', 'describe-db-instances').DBInstances ?? [])
      if (db.DBInstanceIdentifier === 'flow-demo') found.push(db.DBInstanceArn);
    for (const db of aws('rds', 'describe-db-snapshots', [
      '--db-instance-identifier',
      'flow-demo',
    ]).DBSnapshots ?? [])
      found.push(db.DBSnapshotArn);
    for (const lb of aws('elbv2', 'describe-load-balancers').LoadBalancers ??
      [])
      if (lb.LoadBalancerName === 'flow-demo') found.push(lb.LoadBalancerArn);
    for (const tg of aws('elbv2', 'describe-target-groups').TargetGroups ?? [])
      if (['flow-demo-ops', 'flow-demo-ingress'].includes(tg.TargetGroupName))
        found.push(tg.TargetGroupArn);
    for (const p of aws('ssm', 'describe-parameters', [
      '--parameter-filters',
      'Key=Name,Option=BeginsWith,Values=/flow/demo/',
    ]).Parameters ?? [])
      found.push(p.Name);
    for (const g of aws('logs', 'describe-log-groups', [
      '--log-group-name-prefix',
      '/flow/demo/',
    ]).logGroups ?? [])
      found.push(g.arn);
    for (const r of aws('iam', 'list-roles').Roles ?? [])
      if (r.RoleName.startsWith('flow-demo-')) found.push(r.Arn);
    for (const c of aws('acm', 'list-certificates', [
      '--certificate-statuses',
      'PENDING_VALIDATION',
      'ISSUED',
      'INACTIVE',
      'EXPIRED',
      'VALIDATION_TIMED_OUT',
      'REVOKED',
      'FAILED',
    ]).CertificateSummaryList ?? [])
      if (c.DomainName === deployment.domain) found.push(c.CertificateArn);
    const retained = await Promise.all(
      [...new Set(found)].map(async (arn) => {
        const prefix = `arn:aws:ecs:${deployment.region}:${deployment.account}:`;
        if (arn.startsWith(prefix + 'task-definition/flow-demo-')) {
          const task = aws('ecs', 'describe-task-definition', [
            '--task-definition',
            arn,
          ]).taskDefinition;
          return retainedCycleEcsMetadata(arn, task ?? {}) ? null : arn;
        }
        if (arn === prefix + 'cluster/flow-demo') {
          const observed = (cluster.clusters ?? []).find(
            (c: { clusterArn: string }) => c.clusterArn === arn,
          );
          return retainedCycleEcsMetadata(arn, observed ?? {}) ? null : arn;
        }
        return arn;
      }),
    );
    return retained.filter((arn): arn is string => arn !== null).sort();
  }
  async function images() {
    const claim = await privateCycleJson(path('image-publication.json'));
    proof(
      typeof claim.run === 'string' &&
        /^publication\/[a-f0-9-]{36}$/.test(claim.run),
      'Cycle publication claim required',
    );
    const p = await privateCycleJson(
      context.path(`${claim.run}/publication-result.json`),
    );
    const revision = command('git', ['rev-parse', 'HEAD']).trim();
    // Deployment-only commits may follow publication without changing the image build.
    // Preserve the pinned digests only when the published commit is an ancestor
    // and all image source paths are unchanged between that commit and HEAD.
    const sourcePaths = [
      'apps',
      'libs',
      'container',
      'tools/cloud-provision.ts',
      'tools/cloud-cycle-bindings.ts',
      'tools/build-containers.mjs',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      '.dockerignore',
    ];
    const publishedRevisionMatches = (() => {
      if (
        typeof p.revision !== 'string' ||
        !/^[a-f0-9]{40}$/.test(p.revision) ||
        !/^[a-f0-9]{40}$/.test(revision)
      )
        return false;
      if (p.revision === revision) return true;
      try {
        return (
          command('git', ['merge-base', p.revision, revision]).trim() ===
            p.revision &&
          !command('git', [
            'diff',
            '--name-only',
            p.revision,
            revision,
            '--',
            ...sourcePaths,
          ]).trim()
        );
      } catch {
        return false;
      }
    })();
    proof(
      publishedRevisionMatches &&
        p.account === deployment.account &&
        p.region === deployment.region &&
        p.profile === deployment.profile &&
        p.stateUnchanged === true &&
        p.published?.length === 3,
      'Coherent published image source revision required',
    );
    proof(
      !command('git', [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        ...sourcePaths,
      ]).trim(),
      'Application/image sources changed since publication; commit and publish a coherent set first',
    );
    const result: Record<string, string> = {};
    for (const i of p.published) {
      proof(
        i.verified === true &&
          i.smokePassed === true &&
          i.revision === p.revision &&
          i.architecture === 'amd64' &&
          i.os === 'linux' &&
          i.user === 'node' &&
          /^sha256:[a-f0-9]{64}$/.test(i.digest),
        'Image verification evidence incomplete',
      );
      const live = aws('ecr', 'describe-images', [
        '--registry-id',
        deployment.account,
        '--repository-name',
        `flow-demo/${i.image}`,
        '--image-ids',
        `imageDigest=${i.digest}`,
      ]);
      proof(
        live.imageDetails?.length === 1 &&
          live.imageDetails[0].imageDigest === i.digest,
        'Published digest no longer available',
      );
      const manifest = aws('ecr', 'batch-get-image', [
        '--registry-id',
        deployment.account,
        '--repository-name',
        `flow-demo/${i.image}`,
        '--image-ids',
        `imageDigest=${i.digest}`,
      ]);
      proof(
        !manifest.failures?.length &&
          manifest.images?.length === 1 &&
          JSON.parse(manifest.images[0].imageManifest).config?.digest ===
            i.imageId,
        'Live manifest differs from verified image',
      );
      result[i.image] = i.uri;
    }
    assertCycleImages(result);
    return result;
  }
  async function dns(s: CycleState) {
    const certificate = cycleInstances(s).find(
      (r) => r.address === 'aws_acm_certificate.demo',
    )?.attributes;
    const lb = cycleInstances(s).find(
      (r) => r.address === 'aws_lb.demo',
    )?.attributes;
    proof(certificate && lb, 'Actual certificate/load balancer required');
    const observed = aws('acm', 'describe-certificate', [
      '--certificate-arn',
      String(certificate['arn']),
    ]).Certificate;
    proof(
      observed?.DomainName === deployment.domain &&
        observed.Status === 'ISSUED' &&
        observed.DomainValidationOptions?.length === 1,
      'Current certificate must be ISSUED before HTTPS activation',
    );
    const resolver = new Resolver({ timeout: 5000, tries: 1 });
    resolver.setServers(['1.1.1.1', '8.8.8.8']);
    const normalize = (v: string) => v.toLowerCase().replace(/\.$/, '');
    for (const option of observed.DomainValidationOptions) {
      proof(
        option.ValidationStatus === 'SUCCESS' &&
          option.ResourceRecord?.Type === 'CNAME',
        'Actual ACM DNS validation required',
      );
      const answers = await resolver.resolveCname(option.ResourceRecord.Name);
      proof(
        answers.some(
          (a) => normalize(a) === normalize(option.ResourceRecord.Value),
        ),
        'Public ACM CNAME is not verified',
      );
    }
    const answers = await resolver.resolveCname(deployment.domain);
    proof(
      answers.some((a) => normalize(a) === normalize(String(lb['dns_name']))),
      'DNS-only application CNAME must target this cycle load balancer',
    );
  }
  async function task(
    s: CycleState,
    workload: 'admin' | 'verify',
    check?: CycleBindings,
  ) {
    const rows = cycleInstances(s),
      get = (a: string) => rows.find((r) => r.address === a)?.attributes;
    const cluster = get('aws_ecs_cluster.demo'),
      definition = get(`aws_ecs_task_definition.app["${workload}"]`);
    proof(cluster && definition, 'Actual cycle task definition required');
    const current = aws('ecs', 'describe-task-definition', [
      '--task-definition',
      String(definition['arn']),
    ]).taskDefinition;
    proof(
      current?.taskDefinitionArn === definition['arn'] &&
        current.status === 'ACTIVE' &&
        current.containerDefinitions?.length === 1,
      'Current active task definition not proven',
    );
    const input = {
      cluster: cluster['arn'],
      taskDefinition: definition['arn'],
      launchType: 'FARGATE',
      platformVersion: '1.4.0',
      clientToken: `vigil-cycle-${randomUUID()}`,
      startedBy: `vigil-${id.slice(0, 30)}`,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: [0, 1].map((i) => get(`aws_subnet.public[${i}]`)?.['id']),
          securityGroups: [
            get(`aws_security_group.task["${workload}"]`)?.['id'],
          ],
          assignPublicIp: 'ENABLED',
        },
      },
      ...(check
        ? {
            overrides: {
              containerOverrides: [
                {
                  name: workload,
                  command: ['node', 'tools/cycleBindings.cjs'],
                  environment: [
                    {
                      name: 'VIGIL_BINDING_CHECK',
                      value: JSON.stringify({
                        stripeBookId: check.stripeBookId,
                        syntheticBookId: check.syntheticBookId,
                        sourceAccountId: check.sourceAccountId,
                        accountId: check.accountId,
                      }),
                    },
                  ],
                },
              ],
            },
          }
        : {}),
    };
    proof(
      input.networkConfiguration.awsvpcConfiguration.subnets.every(Boolean) &&
        input.networkConfiguration.awsvpcConfiguration.securityGroups.every(
          Boolean,
        ),
      'Missing current task networking',
    );
    const request = path(`task-${randomUUID()}.json`);
    await writeFile(request, JSON.stringify(input) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
    const launched = await claimRuntimeOperation(
      request + '.attempt',
      { snapshot: s, workload },
      async () =>
        aws('ecs', 'run-task', ['--cli-input-json', `file://${request}`], true),
    );
    proof(
      !launched.failures?.length && launched.tasks?.length === 1,
      'One-shot task admission failed/unknown; never rerun automatically',
    );
    const arn = launched.tasks[0].taskArn;
    proof(
      new RegExp(
        `^arn:aws:ecs:${deployment.region}:${deployment.account}:task/flow-demo/[a-f0-9]{32}$`,
      ).test(arn),
      'Foreign one-shot task',
    );
    await writeFile(
      request + '.launched',
      JSON.stringify({ taskArn: arn, taskDefinition: definition['arn'] }) +
        '\n',
      { mode: 0o600, flag: 'wx' },
    );
    const end = Date.now() + 10 * 60000;
    for (;;) {
      const state = aws('ecs', 'describe-tasks', [
        '--cluster',
        String(cluster['arn']),
        '--tasks',
        arn,
      ]);
      const t = state.tasks?.[0];
      proof(
        !state.failures?.length &&
          state.tasks?.length === 1 &&
          t.taskDefinitionArn === definition['arn'],
        'One-shot observation failed/unknown; retain task ARN',
      );
      if (t.lastStatus === 'STOPPED') {
        proof(
          t.containers?.length === 1 && t.containers[0].exitCode === 0,
          'One-shot task failed; retain evidence, no automatic retry',
        );
        break;
      }
      if (Date.now() >= end) {
        aws(
          'ecs',
          'stop-task',
          [
            '--cluster',
            String(cluster['arn']),
            '--task',
            arn,
            '--reason',
            'Vigil approved one-shot ten-minute bound',
          ],
          true,
        );
        proof(
          false,
          'One-shot exceeded its execution bound; retain task evidence',
        );
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    const logs = aws('logs', 'get-log-events', [
      '--log-group-name',
      `/flow/demo/${workload}`,
      '--log-stream-name',
      `flow/${workload}/${arn.split('/').at(-1)}`,
      '--start-from-head',
      '--limit',
      '100',
    ]);
    const receipts = (logs.events ?? [])
      .flatMap((e: { message: string }) => {
        try {
          return [JSON.parse(e.message)];
        } catch {
          return [];
        }
      })
      .filter(
        (r: { operation: string; outcome: string }) =>
          r.operation === (check ? 'cycle-bindings' : 'cloud-provision') &&
          r.outcome === 'PASS',
      );
    proof(
      receipts.length === 1,
      'Bounded one-shot success receipt missing; do not assume success',
    );
    return { taskArn: arn, receipt: receipts[0] };
  }
  const account = async (key: string) =>
    String(object(await stripeReader(key).read('account', 'current'))['id']);
  function sandboxSdk(key: string) {
    const Stripe = createRequire(
      resolve(repository, 'libs/stripe-integration/package.json'),
    )('stripe');
    return new Stripe(sandboxKey(key), {
      apiVersion: STRIPE_API_VERSION,
      maxNetworkRetries: 0,
      timeout: 5000,
    });
  }
  async function oneShots(s: CycleState) {
    const cluster = cycleInstances(s).find(
      (r) => r.address === 'aws_ecs_cluster.demo',
    )?.attributes;
    if (!cluster) return [];
    const arns =
      aws('ecs', 'list-tasks', [
        '--cluster',
        String(cluster['arn']),
        '--desired-status',
        'RUNNING',
      ]).taskArns ?? [];
    if (!arns.length) return [];
    proof(
      arns.length <= 100,
      'Unbounded task inventory: stop for explicit cleanup review',
    );
    const observed = aws('ecs', 'describe-tasks', [
      '--cluster',
      String(cluster['arn']),
      '--tasks',
      ...arns,
    ]);
    proof(
      !observed.failures?.length && observed.tasks?.length === arns.length,
      'Incomplete current task inventory',
    );
    const requests = await Promise.all(
      (await readdir(context.path(`cycles/${id}`)))
        .filter((n) => /^task-[a-f0-9-]{36}\.json$/.test(n))
        .map((n) => privateCycleJson(path(n))),
    );
    const result: string[] = [];
    for (const t of observed.tasks) {
      proof(t.clusterArn === cluster['arn'], 'Foreign task cluster');
      if (/^service:flow-demo-(ops|ingress|worker)$/.test(t.group ?? ''))
        continue;
      proof(
        t.startedBy === `vigil-${id.slice(0, 30)}` &&
          requests.some((r) => r.taskDefinition === t.taskDefinitionArn),
        'Unowned one-shot task: explicit recovery review required',
      );
      result.push(t.taskArn);
    }
    return result.sort();
  }
  return {
    async readiness(cleanup) {
      identity();
      proof(
        JSON.parse(command('terraform', ['version', '-json']))
          .terraform_version === '1.15.3',
        'Pinned Terraform 1.15.3 required',
      );
      assertFreePlan(aws('freetier', 'get-account-plan-state'), cleanup);
      proof(
        aws('s3api', 'get-bucket-versioning', [
          '--bucket',
          deployment.bucket,
          '--expected-bucket-owner',
          deployment.account,
        ]).Status === 'Enabled',
        'Persistent versioned backend required',
      );
      proof(
        aws('s3api', 'get-bucket-location', [
          '--bucket',
          deployment.bucket,
          '--expected-bucket-owner',
          deployment.account,
        ]).LocationConstraint === deployment.region,
        'Backend must remain in Sydney',
      );
      const role = aws('iam', 'get-role', [
        '--role-name',
        runtimeStateRoleName,
      ]).Role;
      assertRuntimeStateRole(role);
      proof(
        isDeepStrictEqual(
          aws('iam', 'get-role-policy', [
            '--role-name',
            runtimeStateRoleName,
            '--policy-name',
            runtimeStatePolicyName,
          ]).PolicyDocument,
          runtimeStateDocument('permissions'),
        ) &&
          isDeepStrictEqual(
            aws('iam', 'list-role-policies', [
              '--role-name',
              runtimeStateRoleName,
            ]).PolicyNames,
            [runtimeStatePolicyName],
          ) &&
          aws('iam', 'list-attached-role-policies', [
            '--role-name',
            runtimeStateRoleName,
          ]).AttachedPolicies?.length === 0,
        'State role changed; no permission widening',
      );
      if (!cleanup) {
        const b = aws('budgets', 'describe-budget', [
          '--account-id',
          deployment.account,
          '--budget-name',
          deployment.budget,
        ]).Budget;
        assertGrossBudget({
          account_id: deployment.account,
          name: b.BudgetName,
          budget_type: b.BudgetType,
          time_unit: b.TimeUnit,
          budget_limit: [
            { amount: b.BudgetLimit?.Amount, unit: b.BudgetLimit?.Unit },
          ],
          cost_types: [
            {
              include_credit: b.CostTypes?.IncludeCredit,
              include_refund: b.CostTypes?.IncludeRefund,
              include_tax: b.CostTypes?.IncludeTax,
            },
          ],
          cost_filter: Object.entries(b.CostFilters ?? {}),
          billing_view_arn: b.BillingViewArn,
        });
        const approval = await privateCycleJson(path('operator-checks.json'));
        if (assertCycleOperatorChecks(approval, id) === 'UNKNOWN')
          console.warn(unverifiedBudgetAlertWarning);
      }
    },
    snapshot,
    inventory,
    images,
    account,
    async terraform(a, args, secrets) {
      const allowed = ['init', 'validate', 'plan', 'show', 'apply'];
      proof(allowed.includes(args[0] ?? ''), 'Unsupported Terraform operation');
      if (['init', 'plan', 'apply'].includes(args[0]!)) identity();
      const result = command('terraform', args, {
        cwd: a.work,
        env: {
          ...env,
          TF_DATA_DIR: a.data,
          TF_CLI_CONFIG_FILE: context.path(`${a.prefix}/terraform.rc`),
          TF_WORKSPACE: 'default',
          ...(Object.keys(secrets).length
            ? { TF_VAR_secrets: JSON.stringify(secrets) }
            : {}),
        },
        timeout: args[0] === 'apply' ? 3600000 : 600000,
      });
      const metadata = await privateCycleJson(a.data + '/terraform.tfstate');
      const { runtimeStateBackend } = await import('./runtime-state-role.js');
      // Terraform expands omitted backend defaults; compare the security contract
      // field-by-field and reject alternate endpoints/credentials/workspaces.
      const expected = runtimeStateBackend(a.prefix.split('/')[1]!);
      const backend = metadata.backend?.config;
      proof(
        metadata.backend?.type === 's3' &&
          backend &&
          Object.entries(expected)
            .filter(([k]) => k !== 'assume_role')
            .every(([k, v]) => isDeepStrictEqual(backend[k], v)),
        'Terraform initialized a foreign backend',
      );
      const role = Array.isArray(backend.assume_role)
        ? backend.assume_role[0]
        : backend.assume_role;
      proof(
        (!Array.isArray(backend.assume_role) ||
          backend.assume_role.length === 1) &&
          Object.entries(expected.assume_role).every(
            ([k, v]) => role?.[k] === v,
          ),
        'Restricted backend session changed',
      );
      const empty = (v: unknown): boolean =>
        v == null ||
        v === '' ||
        (typeof v === 'object' && Object.values(v).every(empty));
      for (const k of [
        'access_key',
        'secret_key',
        'token',
        'endpoint',
        'endpoints',
        'assume_role_with_web_identity',
      ])
        proof(
          empty(backend[k]),
          'Unexpected backend credential/endpoint override',
        );
      proof(
        backend.workspace_key_prefix == null ||
          backend.workspace_key_prefix === 'env:',
        'Unexpected backend workspace override',
      );
      return result;
    },
    dns,
    async destination(key, endpointId) {
      const currentAccount = await account(key),
        anchor = await privateCycleJson(path('anchor.json'));
      proof(
        currentAccount === anchor.account,
        'Sandbox credential account changed',
      );
      const sdk = sandboxSdk(key);
      const endpoint = await sdk.webhookEndpoints.retrieve(endpointId);
      proof(
        endpoint.id === endpointId &&
          endpoint.livemode === false &&
          endpoint.status === 'enabled' &&
          endpoint.url === `https://${deployment.domain}/webhooks/stripe` &&
          endpoint.api_version === STRIPE_API_VERSION &&
          isDeepStrictEqual(
            [...endpoint.enabled_events].sort(),
            [...EVENT_TYPES].sort(),
          ),
        'Dedicated current sandbox destination is not verified',
      );
    },
    async registerDestination(key) {
      const anchor = await privateCycleJson(path('anchor.json'));
      proof(
        (await account(key)) === anchor.account,
        'Current sandbox account mismatch',
      );
      const sdk = sandboxSdk(key),
        url = `https://${deployment.domain}/webhooks/stripe`;
      const old = await sdk.webhookEndpoints.list({ limit: 100 });
      proof(
        !old.has_more &&
          !old.data.some(
            (e: { url: string; status: string }) =>
              e.url === url && e.status === 'enabled',
          ),
        'Existing active dedicated URL destination must be reviewed/retired before registering this cycle',
      );
      const endpoint = await sdk.webhookEndpoints.create(
        {
          url,
          enabled_events: [...EVENT_TYPES],
          api_version: STRIPE_API_VERSION,
          description: `Vigil Sydney cycle ${id}`,
        },
        { idempotencyKey: `vigil-sydney-cycle-${id}` },
      );
      proof(
        endpoint.livemode === false &&
          endpoint.url === url &&
          endpoint.status === 'enabled' &&
          endpoint.secret?.startsWith('whsec_') &&
          /^we_[A-Za-z0-9]+$/.test(endpoint.id),
        'Dedicated sandbox registration failed or unknown; retain attempt, never automatically repeat',
      );
      return { id: endpoint.id, secret: endpoint.secret };
    },
    async retireDestination(key, endpoint) {
      const anchor = await privateCycleJson(path('anchor.json'));
      proof(
        (await account(key)) === anchor.account,
        'Sandbox account mismatch during destination retirement',
      );
      const result = await sandboxSdk(key).webhookEndpoints.del(endpoint);
      proof(
        result.id === endpoint && result.deleted === true,
        'Destination retirement failed or unknown; retain endpoint evidence',
      );
    },
    provision: (s) => task(s, 'admin'),
    oneShots,
    async stopOneShots(s, reviewed) {
      const active = await oneShots(s);
      proof(
        active.every((arn) => reviewed.includes(arn)),
        'New one-shot task appeared after teardown review',
      );
      const cluster = cycleInstances(s).find(
        (r) => r.address === 'aws_ecs_cluster.demo',
      )?.attributes;
      for (const arn of active)
        aws(
          'ecs',
          'stop-task',
          [
            '--cluster',
            String(cluster?.['arn']),
            '--task',
            arn,
            '--reason',
            `Reviewed Vigil cycle ${id} teardown`,
          ],
          true,
        );
      const deadline = Date.now() + 120000;
      while ((await oneShots(s)).length) {
        proof(
          Date.now() < deadline,
          'One-shot termination not verified; retain cleanup attempt',
        );
        await new Promise((r) => setTimeout(r, 5000));
      }
    },
    async bindings(s, b) {
      const db = aws('rds', 'describe-db-instances', [
        '--db-instance-identifier',
        'flow-demo',
      ]).DBInstances?.[0];
      const stateDb = cycleInstances(s).find(
        (r) => r.address === 'aws_db_instance.demo',
      )!.attributes;
      proof(
        db?.DbiResourceId === stateDb['resource_id'] &&
          db.Endpoint?.Address === b.databaseAddress &&
          db.DBInstanceStatus === 'available' &&
          db.PubliclyAccessible === false &&
          db.StorageEncrypted === true,
        'Current live database identity/security differs',
      );
      const result = await task(s, 'verify', b);
      proof(
        [
          'stripeBookId',
          'syntheticBookId',
          'sourceAccountId',
          'accountId',
        ].every((k) => result.receipt[k] === b[k as keyof CycleBindings]),
        'Independent binding proof mismatch',
      );
    },
    async proof(s) {
      for (const name of ['ops', 'ingress', 'worker']) {
        const r = cycleInstances(s).find(
          (r) => r.address === `aws_ecs_service.app["${name}"]`,
        )!.attributes;
        const services = aws('ecs', 'describe-services', [
          '--cluster',
          'flow-demo',
          '--services',
          String(r['name']),
        ]);
        const service = services.services?.[0];
        proof(
          !services.failures?.length &&
            services.services?.length === 1 &&
            service?.desiredCount === 1 &&
            service.runningCount === 1 &&
            service.pendingCount === 0 &&
            service.taskDefinition === r['task_definition'] &&
            service.deployments?.length === 1 &&
            service.deployments[0].rolloutState === 'COMPLETED',
          'Current service rollout not complete',
        );
      }
      for (const name of ['ops', 'ingress']) {
        const tg = cycleInstances(s).find(
          (r) => r.address === `aws_lb_target_group.app["${name}"]`,
        )!.attributes;
        const targets = aws('elbv2', 'describe-target-health', [
          '--target-group-arn',
          String(tg['arn']),
        ]).TargetHealthDescriptions;
        proof(
          targets?.length === 1 && targets[0].TargetHealth?.State === 'healthy',
          'Current ALB target unhealthy/unknown',
        );
      }
      const base = `https://${deployment.domain}`;
      for (const route of ['/health/live', '/health/ready'])
        proof(
          (
            await fetch(base + route, {
              signal: AbortSignal.timeout(10000),
              redirect: 'manual',
            })
          ).status === 200,
          'Hosted technical health failed',
        );
      proof(
        (
          await fetch(base + '/overview', {
            signal: AbortSignal.timeout(10000),
            redirect: 'manual',
          })
        ).status === 307,
        'Unauthenticated application must require sign-in',
      );
      // Credentials remain in memory/request bodies; never argv, logs or output.
      const response = await fetch(base + '/api/auth/sign-in/email', {
        method: 'POST',
        headers: { origin: base, 'content-type': 'application/json' },
        body: JSON.stringify({
          email: config.values['admin_email'],
          password: config.values['seed_password'],
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      const cookies = response.headers.getSetCookie();
      proof(
        response.status === 200 &&
          cookies.some(
            (c) =>
              c.startsWith('__Secure-better-auth.session_token=') &&
              /;\s*Secure/i.test(c) &&
              /;\s*HttpOnly/i.test(c),
          ),
        'Administrator login/secure session not proven',
      );
      const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
      proof(
        (
          await fetch(base + '/metrics', {
            headers: { cookie },
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
          })
        ).status === 200,
        'Administrator metrics authorization failed',
      );
    },
  };
}
