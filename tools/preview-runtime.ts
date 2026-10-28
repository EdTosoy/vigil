/** Explicit local-backend preview, never a remote-planner fallback or deployable saved plan. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { deployment, assertDeploymentEnvironment } from './deployment-guards';
import {
  verifyDeploymentCaller,
  reportDeploymentFailure,
} from './deployment-preflight';
import { DeploymentSafetyError } from './deployment-context';
import {
  assembleDeploymentSources,
  verifyDeploymentAssembly,
} from './deployment-sources';
import { runtimeInputStore } from './runtime-inputs';
import { initialRuntimeAddresses } from './runtime-plan';

const hash = (v: Uint8Array | string) =>
  createHash('sha256').update(v).digest('hex');
function check(v: unknown, message: string): asserts v {
  if (!v) throw new DeploymentSafetyError(message);
}
export function previewTerraformArgs(operation: string, variables: string) {
  const args: Record<string, string[]> = {
    version: ['version', '-json'],
    fmt: ['fmt', '-check', '-recursive'],
    init: ['init', '-backend=false', '-input=false', '-lockfile=readonly'],
    validate: ['validate', '-no-color'],
    plan: ['plan', '-json', '-input=false', `-var-file=${variables}`],
  };
  check(
    Object.hasOwn(args, operation),
    'Preview permits no saved plan, remote backend or provisioning command',
  );
  return args[operation]!;
}
export function previewSummary(text: string) {
  const events = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  check(
    !events.some(
      (e) => e.type === 'diagnostic' && e.diagnostic?.severity === 'error',
    ),
    'Local preview failed; raw diagnostics omitted',
  );
  const changes = events
    .filter((e) => e.type === 'planned_change')
    .map((e) => ({
      address: String(e.change.resource.addr),
      type: String(e.change.resource.resource_type),
      action: String(e.change.action),
    }));
  check(
    JSON.stringify(changes.map((r) => r.address).sort()) ===
      JSON.stringify(initialRuntimeAddresses()) &&
      changes.every(
        (r) => r.action === 'create' && r.address.startsWith(r.type + '.'),
      ),
    'Unexpected local preview resources or actions',
  );
  const summary = events.findLast((e) => e.type === 'change_summary')?.changes;
  check(
    summary?.add === 75 &&
      summary.change === 0 &&
      summary.remove === 0 &&
      summary.operation === 'plan',
    'Incomplete preview change summary',
  );
  const types: Record<string, number> = {};
  for (const r of changes) types[r.type] = (types[r.type] ?? 0) + 1;
  return {
    artifactType: 'NON_DEPLOYABLE_LOCAL_BACKEND_PREVIEW',
    savedPlanCreated: false,
    remoteStateContacted: false,
    creates: summary.add as number,
    updates: 0,
    deletes: 0,
    replacements: 0,
    resourceTypes: types,
    resources: changes,
  };
}
export async function previewRuntime(repository: string, env = process.env) {
  assertDeploymentEnvironment(env);
  verifyDeploymentCaller(env);
  process.umask(0o077);
  const inputs = await runtimeInputStore(repository).loadInitialPlanInputs();
  const assembly = await assembleDeploymentSources(
    repository,
    'demo',
    undefined,
    'local-runtime-preview',
  );
  const { context, prefix } = assembly;
  const git = (args: string[]) => {
    const r = spawnSync('git', args, {
      cwd: repository,
      encoding: 'utf8',
      timeout: 15000,
    });
    check(
      !r.error && r.status === 0,
      'Preview source/Git exclusion check failed',
    );
    return r.stdout;
  };
  const revision = git(['rev-parse', 'HEAD']).trim();
  for (const f of assembly.receipt.files)
    check(
      hash(git(['show', `HEAD:infra/demo/${f.name}`])) === f.sha256,
      'Preview source differs from committed infrastructure',
    );
  const variables = context.path(`${prefix}/initial.tfvars.json`);
  for (const path of [
    variables,
    runtimeInputStore(repository).path('secrets.json'),
    context.path(`${prefix}/preview-review.json`),
  ])
    git(['check-ignore', '--quiet', '--', path]);
  await writeFile(variables, JSON.stringify(inputs.variables, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  const cliConfig = context.path(`${prefix}/terraform.rc`);
  await writeFile(cliConfig, 'provider_installation {\n direct {}\n}\n', {
    mode: 0o600,
    flag: 'wx',
  });
  const tfEnv = {
    ...env,
    AWS_DEFAULT_REGION: deployment.region,
    AWS_PAGER: '',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
    TF_DATA_DIR: assembly.data,
    TF_CLI_CONFIG_FILE: cliConfig,
    TF_WORKSPACE: 'default',
    TF_IN_AUTOMATION: '1',
    CHECKPOINT_DISABLE: '1',
  };
  let result: ReturnType<typeof previewSummary> | undefined;
  for (const operation of ['version', 'fmt', 'init', 'validate', 'plan']) {
    await verifyDeploymentAssembly(assembly);
    check(
      git(['rev-parse', 'HEAD']).trim() === revision,
      'Source revision changed',
    );
    check(
      hash(
        JSON.stringify(
          await runtimeInputStore(repository).loadInitialPlanInputs(),
        ),
      ) === hash(JSON.stringify(inputs)),
      'Private preview inputs changed',
    );
    if (operation === 'plan') verifyDeploymentCaller(env);
    const r = spawnSync(
      'terraform',
      previewTerraformArgs(operation, variables),
      {
        cwd: assembly.work,
        env:
          operation === 'plan'
            ? {
                ...tfEnv,
                TF_VAR_secrets: JSON.stringify(inputs.ephemeralSecrets),
              }
            : tfEnv,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    await writeFile(
      context.path(`${prefix}/${operation}-result.json`),
      JSON.stringify({ operation, status: r.status, error: !!r.error }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    check(
      !r.error && r.status === 0,
      `Local preview ${operation} failed; no remote fallback or raw diagnostic output`,
    );
    if (operation === 'version')
      check(
        JSON.parse(r.stdout).terraform_version === '1.15.3',
        'Reviewed Terraform 1.15.3 required',
      );
    if (operation === 'plan') {
      check(
        !r.stdout.includes(inputs.ephemeralSecrets.admin_password),
        'Private value appeared in preview output; stop',
      );
      result = previewSummary(r.stdout);
    }
  }
  await verifyDeploymentAssembly(assembly);
  const allFiles = await readdir(assembly.data);
  check(
    !allFiles.includes('terraform.tfstate') &&
      !allFiles.includes('environment'),
    'Unexpected backend/workspace metadata in local preview',
  );
  for (const file of await readdir(assembly.work))
    check(
      !file.endsWith('.tfplan') && !file.endsWith('.tfstate'),
      'Unexpected executable plan or state in preview',
    );
  check(result, 'No local preview result');
  const artifact = context.path(`${prefix}/preview-review.json`);
  await writeFile(
    artifact,
    JSON.stringify(
      {
        ...result,
        sourceRevision: revision,
        sourceManifest: assembly.manifest,
        omittedSource: 'backend.tf',
        flags: inputs.variables,
        authorization: 'PREVIEW_ONLY_NO_APPLY',
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  const info = await lstat(artifact);
  check((info.mode & 0o777) === 0o600, 'Private preview permissions required');
  return { ...result, artifact, sha256: hash(await readFile(artifact)) };
}
async function main() {
  if (process.argv.length !== 2)
    throw new DeploymentSafetyError(
      'Local runtime preview accepts no arguments or overrides',
    );
  const result = await previewRuntime(resolve(__dirname, '..'));
  console.log(JSON.stringify({ ...result, resources: undefined }, null, 2));
}
if (require.main === module) void main().catch(reportDeploymentFailure);
