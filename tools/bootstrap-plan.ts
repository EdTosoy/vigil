/** A first-time, local-state bootstrap planner. No apply, remote backend, migration or generic command entry point. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  deployment,
  assertDeploymentEnvironment,
  assertBootstrapPlan,
  assertGrossBudget,
  type BootstrapPlan,
} from './deployment-guards';
import { verifyDeploymentCaller } from './deployment-preflight';
import { DeploymentSafetyError } from './deployment-context';
import {
  assembleDeploymentSources,
  verifyDeploymentAssembly,
  type DeploymentAssembly,
} from './deployment-sources';

const checksum = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

export function assertBudgetEvidence(value: Record<string, unknown>): void {
  assertGrossBudget(value);
  const age = Date.now() - Date.parse(String(value['observed_at']));
  requireProof(
    Number.isFinite(age) && age >= -60000 && age <= 15 * 60000,
    'A fresh budget observation is required for this plan',
  );
}

function observeBudget(response: Record<string, unknown>) {
  const b = response['Budget'] as Record<string, unknown> | undefined;
  const costs = b?.['CostTypes'] as Record<string, unknown> | undefined;
  const filters = b?.['CostFilters'];
  requireProof(
    filters && typeof filters === 'object' && !Array.isArray(filters),
    'Budget cost scope must be explicit',
  );
  const value = {
    account_id: deployment.account,
    name: b?.['BudgetName'],
    budget_type: b?.['BudgetType'],
    time_unit: b?.['TimeUnit'],
    budget_limit: [
      b?.['BudgetLimit'] && {
        amount: (b['BudgetLimit'] as Record<string, unknown>)['Amount'],
        unit: (b['BudgetLimit'] as Record<string, unknown>)['Unit'],
      },
    ],
    cost_types: [
      {
        include_credit: costs?.['IncludeCredit'],
        include_refund: costs?.['IncludeRefund'],
        include_tax: costs?.['IncludeTax'],
      },
    ],
    cost_filter: Object.keys(filters),
    billing_view_arn: b?.['BillingViewArn'] ?? '',
    observed_at: new Date().toISOString(),
  };
  assertBudgetEvidence(value);
  return value;
}

export function seedBackendContract(assembly: DeploymentAssembly) {
  return {
    version: 1,
    mode: 'first-bootstrap-plan-only',
    account: deployment.account,
    profile: deployment.profile,
    region: deployment.region,
    role: deployment.role,
    root: 'bootstrap',
    backend: 'implicit-local',
    workspace: 'default',
    work: assembly.work,
    data: assembly.data,
    statePath: assembly.context.path(
      `${assembly.prefix}/work/terraform.tfstate`,
    ),
    expectedState: 'absent',
    migration: 'forbidden',
  };
}

export async function assertFreshSeedWorkspace(
  assembly: DeploymentAssembly,
): Promise<void> {
  if (
    assembly.mode !== 'bootstrap-plan' ||
    assembly.context.stage !== 'bootstrap'
  )
    throw new DeploymentSafetyError(
      'A fresh isolated bootstrap-plan context is required',
    );
  await verifyDeploymentAssembly(assembly);
  const contract: unknown = JSON.parse(
    await readFile(
      assembly.context.path(`${assembly.prefix}/seed-backend.json`),
      'utf8',
    ),
  );
  if (!isDeepStrictEqual(contract, seedBackendContract(assembly)))
    throw new DeploymentSafetyError(
      'Missing or foreign local seed backend configuration',
    );
  for (const name of ['bootstrap.tfplan', 'plan-receipt.json']) {
    try {
      await lstat(assembly.context.path(`${assembly.prefix}/${name}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new DeploymentSafetyError('Existing bootstrap plan/receipt refused');
  }
  await assertNoCachedBackend(assembly);
}

// verifyDeploymentAssembly rejects state/backends in work. Check TF_DATA_DIR
// independently, including after planning, without accepting a saved-state seed.
async function assertNoCachedBackend(
  assembly: DeploymentAssembly,
): Promise<void> {
  for (const name of [
    'terraform.tfstate',
    'terraform.tfstate.backup',
    'environment',
  ]) {
    try {
      await lstat(
        assembly.context.path(`${assembly.prefix}/terraform-data/${name}`),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    throw new DeploymentSafetyError(
      'Unexpected cached backend/state/workspace metadata refused',
    );
  }
}

const bucketPolicy = () => ({
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'DenyInsecureTransport',
      Effect: 'Deny',
      Principal: '*',
      Action: 's3:*',
      Resource: [
        `arn:aws:s3:::${deployment.bucket}`,
        `arn:aws:s3:::${deployment.bucket}/*`,
      ],
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    },
  ],
});
const imagePolicy = () => ({
  rules: [
    {
      rulePriority: 1,
      description: 'Expire untagged build remnants after seven days',
      selection: {
        tagStatus: 'untagged',
        countType: 'sinceImagePushed',
        countUnit: 'days',
        countNumber: 7,
      },
      action: { type: 'expire' },
    },
  ],
});

const singleton = (value: unknown): Record<string, unknown> | undefined =>
  Array.isArray(value) && value.length === 1
    ? (value[0] as Record<string, unknown>)
    : undefined;
function requireProof(value: unknown, message: string): asserts value {
  if (!value) throw new DeploymentSafetyError(message);
}
interface StateModule {
  resources?: {
    mode: string;
    address?: string;
    type?: string;
    values?: Record<string, unknown>;
  }[];
  child_modules?: StateModule[];
}
interface SeedPlan extends BootstrapPlan {
  planned_values?: {
    root_module?: {
      resources?: {
        address: string;
        mode: string;
        type: string;
        values: Record<string, unknown>;
      }[];
    };
  };
  variables?: Record<string, { value: unknown }>;
  prior_state?: { values?: { root_module?: StateModule } };
  resource_drift?: unknown[];
  deferred_changes?: unknown[];
  output_changes?: Record<string, { after_sensitive?: boolean }>;
  configuration?: {
    provider_config?: Record<
      string,
      { full_name?: string; expressions?: Record<string, unknown> }
    >;
  };
}

/** Exact twelve-resource create-only proposal. Sanitized output never includes raw budget data or arbitrary outputs. */
export function inspectSeedPlan(plan: SeedPlan) {
  assertBootstrapPlan(plan);
  // Terraform 1.15 can retain a fully read, unchanged data source only in
  // prior_state. That is observed data, never an existing managed seed.
  const budget = [
    ...(plan.planned_values?.root_module?.resources ?? []),
    ...(plan.prior_state?.values?.root_module?.resources ?? []),
  ].filter((r) => r.mode === 'data');
  requireProof(
    budget.length === 1 &&
      budget[0]?.address === 'data.aws_budgets_budget.existing' &&
      budget[0].type === 'aws_budgets_budget',
    'The exact existing-budget read must be frozen in the plan',
  );
  const observation = plan.variables?.['budget_evidence']?.value as
    Record<string, unknown> | undefined;
  requireProof(observation, 'Frozen gross budget evidence is required');
  assertBudgetEvidence(observation);
  const liveBudget = budget[0]!.values;
  requireProof(liveBudget, 'Existing budget read values are required');
  requireProof(
    liveBudget['account_id'] === deployment.account &&
      liveBudget['name'] === deployment.budget &&
      liveBudget['budget_type'] === 'COST' &&
      isDeepStrictEqual(
        liveBudget['budget_limit'],
        observation['budget_limit'],
      ),
    'Live provider budget reference must agree with the frozen observation',
  );
  requireProof(
    !plan.resource_drift?.length && !plan.deferred_changes?.length,
    'Drift/deferred bootstrap changes refused',
  );
  function inspectPrior(module?: StateModule): void {
    requireProof(
      !module?.resources?.some((r) => r.mode === 'managed'),
      'Historical or existing managed state refused',
    );
    for (const child of module?.child_modules ?? []) inspectPrior(child);
  }
  inspectPrior(plan.prior_state?.values?.root_module);
  const expectedVariables = {
    aws_account_id: deployment.account,
    aws_profile: deployment.profile,
    aws_region: deployment.region,
    existing_budget_name: deployment.budget,
    budget_evidence: observation,
  };
  requireProof(
    isDeepStrictEqual(
      Object.fromEntries(
        Object.entries(plan.variables ?? {}).map(([k, v]) => [k, v.value]),
      ),
      expectedVariables,
    ),
    'Unexpected bootstrap target or input variables',
  );
  const provider = plan.configuration?.provider_config?.['aws'];
  requireProof(
    Object.keys(plan.configuration?.provider_config ?? {}).length === 1 &&
      provider?.full_name === 'registry.terraform.io/hashicorp/aws',
    'Only the pinned AWS provider is allowed',
  );
  for (const [key, variable] of [
    ['profile', 'aws_profile'],
    ['region', 'aws_region'],
    ['allowed_account_ids', 'aws_account_id'],
  ] as const)
    requireProof(
      isDeepStrictEqual(provider.expressions?.[key], {
        references: [`var.${variable}`],
      }),
      'Exact provider account/profile/region guard required',
    );
  const expected = new Map<string, string>([
    ['aws_s3_bucket.state', 'aws_s3_bucket'],
    [
      'aws_s3_bucket_ownership_controls.state',
      'aws_s3_bucket_ownership_controls',
    ],
    [
      'aws_s3_bucket_public_access_block.state',
      'aws_s3_bucket_public_access_block',
    ],
    ['aws_s3_bucket_versioning.state', 'aws_s3_bucket_versioning'],
    [
      'aws_s3_bucket_server_side_encryption_configuration.state',
      'aws_s3_bucket_server_side_encryption_configuration',
    ],
    ['aws_s3_bucket_policy.state', 'aws_s3_bucket_policy'],
    ...['admin', 'ops', 'stripe'].flatMap((name): [string, string][] => [
      [`aws_ecr_repository.image["${name}"]`, 'aws_ecr_repository'],
      [`aws_ecr_lifecycle_policy.image["${name}"]`, 'aws_ecr_lifecycle_policy'],
    ]),
  ]);
  const resources =
    plan.resource_changes?.filter((r) => r.mode === 'managed') ?? [];
  requireProof(
    resources.length === expected.size,
    'Unexpected bootstrap resource inventory',
  );
  const seen = new Set<string>();
  const summary = [];
  for (const resource of resources) {
    requireProof(
      expected.get(resource.address) === resource.type &&
        !seen.has(resource.address) &&
        isDeepStrictEqual(resource.change.actions, ['create']) &&
        resource.change.before == null &&
        !('importing' in resource.change && resource.change.importing),
      'Only the exact first-time bootstrap creations are approved for planning',
    );
    seen.add(resource.address);
    const after = resource.change.after!;
    requireProof(
      !/163596511125|iamadmin-general|us-east-1/.test(JSON.stringify(after)),
      'Historical target reference in proposed resource refused',
    );
    if (after['bucket'] != null)
      requireProof(
        after['bucket'] === deployment.bucket,
        'Foreign bucket attachment refused',
      );
    const image = /image\["(admin|ops|stripe)"\]/.exec(resource.address)?.[1];
    if (image)
      requireProof(
        (after['name'] ?? after['repository']) === `flow-demo/${image}`,
        'Wrong repository or lifecycle attachment refused',
      );
    if (after['region'] != null)
      requireProof(
        after['region'] === deployment.region,
        'Foreign resource region refused',
      );
    if (['aws_s3_bucket', 'aws_ecr_repository'].includes(resource.type)) {
      const tags = after['tags_all'] as Record<string, unknown> | undefined;
      requireProof(
        tags?.['DeploymentAccount'] === deployment.account &&
          tags['DeploymentRegion'] === deployment.region &&
          tags['Project'] === 'vigil' &&
          tags['Lifecycle'] === 'persistent',
        'Exact deployment ownership tags required',
      );
    }
    let safe = false;
    switch (resource.type) {
      case 'aws_s3_bucket':
        safe =
          after['bucket'] === deployment.bucket &&
          after['force_destroy'] === false;
        break;
      case 'aws_s3_bucket_ownership_controls':
        safe =
          singleton(after['rule'])?.['object_ownership'] ===
          'BucketOwnerEnforced';
        break;
      case 'aws_s3_bucket_public_access_block':
        safe = [
          'block_public_acls',
          'block_public_policy',
          'ignore_public_acls',
          'restrict_public_buckets',
        ].every((k) => after[k] === true);
        break;
      case 'aws_s3_bucket_versioning':
        safe =
          singleton(after['versioning_configuration'])?.['status'] ===
          'Enabled';
        break;
      case 'aws_s3_bucket_server_side_encryption_configuration':
        safe =
          singleton(
            singleton(after['rule'])?.[
              'apply_server_side_encryption_by_default'
            ],
          )?.['sse_algorithm'] === 'AES256';
        break;
      case 'aws_s3_bucket_policy':
        safe = isDeepStrictEqual(
          JSON.parse(String(after['policy'])),
          bucketPolicy(),
        );
        break;
      case 'aws_ecr_repository':
        safe =
          singleton(after['encryption_configuration'])?.['encryption_type'] ===
            'AES256' &&
          singleton(after['image_scanning_configuration'])?.['scan_on_push'] ===
            true;
        break;
      case 'aws_ecr_lifecycle_policy':
        safe = isDeepStrictEqual(
          JSON.parse(String(after['policy'])),
          imagePolicy(),
        );
        break;
    }
    requireProof(safe, 'Unsafe or unknown bootstrap security configuration');
    summary.push({
      address: resource.address,
      type: resource.type,
      action: 'create',
      name: resource.type.startsWith('aws_ecr')
        ? String(after['name'] ?? after['repository'])
        : deployment.bucket,
      region: deployment.region,
      survivesRuntimeTeardown: true,
    });
  }
  requireProof(
    isDeepStrictEqual(Object.keys(plan.output_changes ?? {}).sort(), [
      'budget_name',
      'image_repositories',
      'state_bucket',
    ]) &&
      Object.values(plan.output_changes ?? {}).every(
        (o) => o.after_sensitive === false,
      ),
    'Unexpected or sensitive bootstrap output refused',
  );
  return {
    account: deployment.account,
    profile: deployment.profile,
    region: deployment.region,
    role: deployment.role,
    mode: 'plan-only',
    provisioningAuthorized: false,
    resources: summary,
    managedCreates: summary.length,
    managedUpdates: 0,
    managedDeletes: 0,
    budget: { name: deployment.budget, mode: 'read-only' },
  };
}

export async function prepareBootstrapPlan(
  repository: string,
  inherited = process.env,
) {
  assertDeploymentEnvironment(inherited);
  const calls: {
    service: string;
    operation: string;
    region: string;
    readOnly: true;
    outcome: string;
  }[] = [];
  const env = {
    ...inherited,
    AWS_PAGER: '',
    AWS_CLI_AUTO_PROMPT: 'off',
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
    AWS_MAX_ATTEMPTS: '1',
  };
  function identity(): void {
    verifyDeploymentCaller(env, (args, selected) => {
      const r = spawnSync('aws', args, {
        env: selected,
        encoding: 'utf8',
        timeout: 25000,
      });
      calls.push({
        service: 'sts',
        operation: 'GetCallerIdentity',
        region: deployment.region,
        readOnly: true,
        outcome: r.status === 0 ? 'verified' : 'failed',
      });
      if (r.status !== 0)
        throw new DeploymentSafetyError(
          'STS verification failed; manual browser login required',
        );
      return r.stdout;
    });
  }
  identity();
  const assembly = await assembleDeploymentSources(
    repository,
    'bootstrap',
    undefined,
    'bootstrap-plan',
  );
  const path = (name: string) =>
    assembly.context.path(`${assembly.prefix}/${name}`);
  const save = async (name: string, value: unknown) =>
    writeFile(path(name), JSON.stringify(value, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  await save('seed-backend.json', seedBackendContract(assembly));
  await writeFile(
    path('terraform.rc'),
    'provider_installation {\n  direct {}\n}\n',
    { mode: 0o600, flag: 'wx' },
  );
  const childEnv = {
    ...env,
    TF_DATA_DIR: assembly.data,
    TF_CLI_CONFIG_FILE: path('terraform.rc'),
    TF_WORKSPACE: 'default',
    TF_IN_AUTOMATION: '1',
    CHECKPOINT_DISABLE: '1',
    AWS_EC2_METADATA_DISABLED: 'true',
  };
  function aws(
    service: string,
    operation: string,
    args: string[],
    region: string,
  ) {
    const r = spawnSync(
      'aws',
      [
        service,
        operation,
        ...args,
        '--profile',
        deployment.profile,
        '--region',
        region,
        '--output',
        'json',
        '--no-cli-pager',
        '--no-paginate',
        '--cli-connect-timeout',
        '5',
        '--cli-read-timeout',
        '15',
      ],
      { env, encoding: 'utf8', timeout: 25000 },
    );
    const absent =
      service === 's3api' &&
      operation === 'head-bucket' &&
      r.status !== 0 &&
      /\(404\)/.test(r.stderr);
    calls.push({
      service,
      operation,
      region,
      readOnly: true,
      outcome: r.status === 0 ? 'read' : absent ? '404' : 'failed',
    });
    if (absent) return null;
    requireProof(
      r.status === 0,
      'Bootstrap read precondition failed; no planning or provisioning performed',
    );
    return JSON.parse(r.stdout || '{}') as Record<string, unknown>;
  }
  try {
    const planState = aws(
      'freetier',
      'get-account-plan-state',
      [],
      'us-east-1',
    );
    requireProof(
      planState?.['accountId'] === deployment.account &&
        planState['accountPlanType'] === 'FREE' &&
        planState['accountPlanStatus'] === 'ACTIVE' &&
        Date.parse(String(planState['accountPlanExpirationDate'])) > Date.now(),
      'Active approved-account Free Plan required',
    );
    requireProof(
      aws(
        's3api',
        'head-bucket',
        [
          '--bucket',
          deployment.bucket,
          '--expected-bucket-owner',
          deployment.account,
        ],
        deployment.region,
      ) === null,
      'Existing state bucket refused; never create a replacement seed lineage',
    );
    const repos = aws(
      'ecr',
      'describe-repositories',
      ['--max-results', '100'],
      deployment.region,
    );
    requireProof(
      !repos?.['nextToken'] &&
        Array.isArray(repos?.['repositories']) &&
        !(repos['repositories'] as { repositoryName: string }[]).some((r) =>
          ['flow-demo/ops', 'flow-demo/stripe', 'flow-demo/admin'].includes(
            r.repositoryName,
          ),
        ),
      'Existing or unbounded ECR repository inventory refused',
    );
    const scanning = aws(
      'ecr',
      'get-registry-scanning-configuration',
      [],
      deployment.region,
    );
    requireProof(
      scanning?.['registryId'] === deployment.account &&
        (scanning['scanningConfiguration'] as { scanType?: string })
          ?.scanType === 'BASIC',
      'Only new-account BASIC ECR scanning is within scope',
    );
    const budgetEvidence = observeBudget(
      aws(
        'budgets',
        'describe-budget',
        [
          '--account-id',
          deployment.account,
          '--budget-name',
          deployment.budget,
        ],
        'us-east-1',
      )!,
    );
    await save('bootstrap-inputs.tfvars.json', {
      budget_evidence: budgetEvidence,
    });
    async function terraform(args: string[], name: string): Promise<string> {
      assertDeploymentEnvironment(inherited);
      await assertFreshSeedWorkspace(assembly);
      const r = spawnSync('terraform', args, {
        cwd: assembly.work,
        env: childEnv,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 24 * 1024 * 1024,
      });
      if (args[0] === 'plan') {
        try {
          await chmod(path('bootstrap.tfplan'), 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      await writeFile(path(name), (r.stdout ?? '') + (r.stderr ?? ''), {
        mode: 0o600,
        flag: 'wx',
      });
      requireProof(
        !r.error && r.status === 0,
        `Bootstrap ${args[0]} failed; inspect private target-scoped logs. No apply occurred`,
      );
      return r.stdout;
    }
    await terraform(['fmt', '-check', '-recursive'], 'fmt.log');
    await terraform(
      ['init', '-backend=false', '-input=false', '-lockfile=readonly'],
      'init.log',
    );
    await terraform(['validate', '-no-color'], 'validate.log');
    identity(); // Planning credentials/target must be fresh independently of the initial preconditions.
    assertBudgetEvidence(budgetEvidence);
    await terraform(
      [
        'plan',
        '-input=false',
        '-no-color',
        '-lock-timeout=30s',
        `-var-file=${path('bootstrap-inputs.tfvars.json')}`,
        `-out=${path('bootstrap.tfplan')}`,
      ],
      'plan.log',
    );
    await chmod(path('bootstrap.tfplan'), 0o600);
    await verifyDeploymentAssembly(assembly);
    await assertNoCachedBackend(assembly);
    const shown = spawnSync(
      'terraform',
      ['show', '-json', path('bootstrap.tfplan')],
      {
        cwd: assembly.work,
        env: childEnv,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 24 * 1024 * 1024,
      },
    );
    requireProof(shown.status === 0, 'Saved-plan JSON inspection failed');
    const parsed = JSON.parse(shown.stdout) as SeedPlan;
    const summary = inspectSeedPlan(parsed);
    await save('plan.json', parsed); // Private: budget data may contain notification contacts.
    await save('review.json', summary);
    const bytes = await readFile(path('bootstrap.tfplan'));
    const receipt = {
      version: 1,
      mode: 'first-bootstrap-plan-only',
      account: deployment.account,
      profile: deployment.profile,
      region: deployment.region,
      role: deployment.role,
      work: assembly.work,
      data: assembly.data,
      planPath: path('bootstrap.tfplan'),
      backend: seedBackendContract(assembly),
      sourceHash: checksum(JSON.stringify(assembly.receipt)),
      inputHash: checksum(JSON.stringify(parsed.variables)),
      priorStateHash: checksum(JSON.stringify(parsed.prior_state ?? null)),
      checksum: checksum(bytes),
      createdAt: new Date().toISOString(),
      provisioningAuthorized: false,
    };
    await save('plan-receipt.json', receipt);
    await save('read-calls.json', {
      directCliCalls: calls,
      terraformProviderReads:
        'STS account verification and existing Budgets data source; see pinned provider source. No wire-level request trace recorded.',
    });
    await save('free-plan.json', {
      type: planState!['accountPlanType'],
      status: planState!['accountPlanStatus'],
      remainingCredits: planState!['accountPlanRemainingCredits'],
      expires: planState!['accountPlanExpirationDate'],
    });
    return {
      summary,
      receiptPath: path('plan-receipt.json'),
      reviewPath: path('review.json'),
      planPath: path('bootstrap.tfplan'),
      checksum: receipt.checksum,
    };
  } catch (error) {
    await save('read-calls.json', {
      directCliCalls: calls,
      completed: false,
    }).catch((saveError: NodeJS.ErrnoException) => {
      if (saveError.code !== 'EEXIST') throw saveError;
    });
    throw error;
  }
}
