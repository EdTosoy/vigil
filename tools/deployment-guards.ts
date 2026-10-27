/** Pure safety checks; deployment commands never accept an arbitrary account/profile. */
export const deployment = Object.freeze({
  profile: 'edtosoy',
  account: '747240980964',
  region: 'ap-southeast-2',
  role: 'AccountFullAccessRole',
  bucket: 'flow-demo-tfstate-747240980964-ap-southeast-2',
  domain: 'vigil.edtosoy.com',
  budget: 'mdp-monthly-gross-usd-5',
} as const);

export function assertDeploymentIdentity(account: string, arn: string): void {
  const match =
    /^arn:aws:sts::(\d{12}):assumed-role\/([\w+=,.@-]+)\/([\w+=,.@-]{2,64})$/.exec(
      arn,
    );
  if (
    account !== deployment.account ||
    match?.[0] !== arn ||
    match?.[1] !== account ||
    match?.[2] !== deployment.role
  )
    throw new Error(
      'Sydney requires account 747240980964 and exact assumed role AccountFullAccessRole',
    );
}

export function assertDeploymentEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (
    env['AWS_PROFILE'] !== deployment.profile ||
    (env['AWS_DEFAULT_PROFILE'] !== undefined &&
      env['AWS_DEFAULT_PROFILE'] !== deployment.profile)
  )
    throw new Error(
      'Explicit AWS_PROFILE=edtosoy required; no default or historical profile fallback',
    );
  if (
    env['AWS_REGION'] !== deployment.region ||
    (env['AWS_DEFAULT_REGION'] !== undefined &&
      env['AWS_DEFAULT_REGION'] !== deployment.region)
  )
    throw new Error(
      'Explicit AWS_REGION=ap-southeast-2 required; conflicting region refused',
    );
  for (const name of Object.keys(env)) {
    if (
      env[name] !== undefined &&
      (/^AWS_(ACCESS_KEY.*|SECRET.*|SESSION.*|SECURITY_TOKEN|ROLE_.*|WEB_IDENTITY_TOKEN_FILE|CONTAINER_.*|ENDPOINT_.*|CONFIG_FILE|SHARED_CREDENTIALS_FILE|CREDENTIAL_.*|LOGIN_.*|CA_BUNDLE|DATA_PATH)$/.test(
        name,
      ) ||
        /^TF_/.test(name) ||
        /^TERRAFORM_/.test(name))
    )
      throw new Error(
        'Credential, endpoint or Terraform argument overrides are unsupported',
      );
  }
}

export interface BootstrapPlan {
  resource_changes?: {
    address: string;
    mode: string;
    type: string;
    change: {
      actions: string[];
      before?: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    };
  }[];
}

/** Read-only budget policy; Vigil never owns or imports the existing account budget. */
export function assertGrossBudget(value: Record<string, unknown>): void {
  const limit = (
    value['budget_limit'] as { amount?: string; unit?: string }[] | undefined
  )?.[0];
  const costs = (
    value['cost_types'] as
      | {
          include_credit?: boolean;
          include_refund?: boolean;
          include_tax?: boolean;
        }[]
      | undefined
  )?.[0];
  if (
    value['account_id'] !== deployment.account ||
    value['name'] !== deployment.budget ||
    value['budget_type'] !== 'COST' ||
    value['time_unit'] !== 'MONTHLY' ||
    !/^5(?:\.0+)?$/.test(String(limit?.amount)) ||
    String(limit?.amount).trim() !== String(limit?.amount) ||
    limit?.unit !== 'USD' ||
    costs?.include_credit !== false ||
    costs?.include_refund !== false ||
    costs?.include_tax !== true ||
    !Array.isArray(value['cost_filter']) ||
    value['cost_filter'].length !== 0 ||
    (value['billing_view_arn'] != null && value['billing_view_arn'] !== '')
  )
    throw new Error(
      'Existing account-wide gross USD 5 budget required; never create or take ownership',
    );
}

export function assertDeploymentImage(value: string): void {
  if (
    !/^747240980964\.dkr\.ecr\.ap-southeast-2\.amazonaws\.com\/flow-demo\/(ops|stripe|admin)@sha256:[a-f0-9]{64}$/.test(
      value,
    ) ||
    value.includes('\n')
  )
    throw new Error(
      'Approved Sydney account/region/repository immutable image required',
    );
}

export function assertBootstrapPlan(plan: BootstrapPlan, dns = false): void {
  if (dns)
    throw new Error(
      'Sydney DNS is manual Cloudflare configuration; Route 53 creation is forbidden',
    );
  const allowed = new Set([
    'aws_s3_bucket',
    'aws_s3_bucket_ownership_controls',
    'aws_s3_bucket_public_access_block',
    'aws_s3_bucket_versioning',
    'aws_s3_bucket_server_side_encryption_configuration',
    'aws_s3_bucket_policy',
    'aws_ecr_repository',
    'aws_ecr_lifecycle_policy',
  ]);
  if (!Array.isArray(plan.resource_changes))
    throw new Error('A complete Terraform resource-change plan is required');
  for (const resource of plan.resource_changes) {
    if (
      resource.mode === 'data' &&
      resource.type === 'aws_budgets_budget' &&
      resource.change.actions.every((a) => ['read', 'no-op'].includes(a)) &&
      resource.change.after
    ) {
      assertGrossBudget(resource.change.after);
      continue;
    }
    if (
      resource.mode !== 'managed' ||
      !allowed.has(resource.type) ||
      resource.change.actions.some(
        (a) => !['create', 'update', 'no-op'].includes(a),
      )
    )
      throw new Error('Unexpected or destructive bootstrap operation refused');
    const after = resource.change.after;
    if (!after)
      throw new Error('Bootstrap resource has no planned configuration');
    if (
      resource.type === 'aws_s3_bucket' &&
      after['bucket'] !== deployment.bucket
    )
      throw new Error('Unexpected state bucket');
    if (
      resource.type === 'aws_ecr_repository' &&
      (!['flow-demo/ops', 'flow-demo/stripe', 'flow-demo/admin'].includes(
        String(after['name']),
      ) ||
        after['image_tag_mutability'] !== 'IMMUTABLE' ||
        after['force_delete'] !== false)
    )
      throw new Error('Unexpected or mutable image repository');
  }
}

/** Defense in depth around the reviewed ephemeral root; never accepts bootstrap resources. */
export function assertDemoPlan(plan: BootstrapPlan, destroy = false): void {
  const allowed = new Set([
    'aws_vpc',
    'aws_subnet',
    'aws_internet_gateway',
    'aws_route_table',
    'aws_route',
    'aws_route_table_association',
    'aws_security_group',
    'aws_vpc_security_group_ingress_rule',
    'aws_vpc_security_group_egress_rule',
    'aws_db_subnet_group',
    'aws_db_parameter_group',
    'aws_db_instance',
    'aws_ssm_parameter',
    'aws_acm_certificate',
    'aws_acm_certificate_validation',
    'aws_lb',
    'aws_lb_target_group',
    'aws_lb_listener',
    'aws_lb_listener_rule',
    'aws_ecs_cluster',
    'aws_ecs_task_definition',
    'aws_ecs_service',
    'aws_cloudwatch_log_group',
    'aws_iam_role',
    'aws_iam_role_policy',
  ]);
  if (!Array.isArray(plan.resource_changes))
    throw new Error('Complete demo plan required');
  for (const resource of plan.resource_changes) {
    const taskRevision =
      !destroy &&
      resource.type === 'aws_ecs_task_definition' &&
      resource.change.actions.length === 2 &&
      resource.change.actions.includes('create') &&
      resource.change.actions.includes('delete') &&
      resource.change.before?.['family'] ===
        resource.change.after?.['family'] &&
      [
        'flow-demo-ops',
        'flow-demo-ingress',
        'flow-demo-worker',
        'flow-demo-admin',
        'flow-demo-verify',
      ].includes(String(resource.change.after?.['family']));
    if (
      resource.mode !== 'managed' ||
      !allowed.has(resource.type) ||
      (!taskRevision &&
        resource.change.actions.some(
          (a) =>
            !(
              destroy ? ['delete', 'no-op'] : ['create', 'update', 'no-op']
            ).includes(a),
        ))
    )
      throw new Error('Unexpected demo resource or destructive operation');
    const a = resource.change.after;
    if (!a) {
      if (destroy) continue;
      throw new Error('Missing planned configuration');
    }
    if (
      resource.type === 'aws_db_instance' &&
      (a['identifier'] !== 'flow-demo' ||
        a['publicly_accessible'] !== false ||
        a['multi_az'] !== false ||
        a['storage_encrypted'] !== true ||
        a['instance_class'] !== 'db.t4g.micro' ||
        a['backup_retention_period'] !== 0 ||
        a['deletion_protection'] !== false ||
        a['skip_final_snapshot'] !== true ||
        a['password'] != null)
    )
      throw new Error('Unsafe database plan');
    if (
      resource.type === 'aws_ssm_parameter' &&
      (a['type'] !== 'SecureString' ||
        !String(a['name']).startsWith('/flow/demo/') ||
        (a['value'] != null && a['value'] !== ''))
    )
      throw new Error('Unsafe secret plan');
    if (
      resource.type === 'aws_vpc_security_group_ingress_rule' &&
      a['cidr_ipv4'] === '0.0.0.0/0' &&
      ![
        'aws_vpc_security_group_ingress_rule.http',
        'aws_vpc_security_group_ingress_rule.https',
      ].includes(resource.address)
    )
      throw new Error('Unexpected public ingress');
    if (
      resource.type === 'aws_ecs_task_definition' &&
      a['container_definitions']
    ) {
      if (a['cpu'] !== '256' || !['512', '1024'].includes(String(a['memory'])))
        throw new Error('Unexpected task size');
      const containers = JSON.parse(String(a['container_definitions'])) as {
        image?: string;
        environment?: { name: string; value: string }[];
      }[];
      for (const c of containers) {
        assertDeploymentImage(c.image ?? '');
        if (
          c.environment?.some((v) =>
            /PASSWORD|SECRET|DATABASE.*URL/.test(v.name),
          )
        )
          throw new Error('Plaintext task secret');
        if (
          c.environment?.find((v) => v.name === 'STRIPE_MODE')?.value !==
          'sandbox'
        )
          throw new Error('Sandbox-only task required');
      }
    }
  }
}
