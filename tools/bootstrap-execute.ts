/** Single-use D2C execution of the exact reviewed first-bootstrap proposal. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import {
  prepareBootstrapPlan,
  inspectSeedPlan,
  seedBackendContract,
} from './bootstrap-plan';
import { deploymentContext, DeploymentSafetyError } from './deployment-context';
import {
  verifyDeploymentCaller,
  reportDeploymentFailure,
} from './deployment-preflight';
import { deployment, assertDeploymentEnvironment } from './deployment-guards';
import {
  verifyDeploymentAssembly,
  type DeploymentAssembly,
} from './deployment-sources';

const baselineRun = '8e671f20-5cbc-4c16-bcb4-c6c977e8f765';
const baselineHash =
  'a4090bcca4ca16450c1bbbbf08c1f17e8f5f1f1a7449bc14b0cfb5418fd8876f';
const hash = (b: Uint8Array | string) =>
  createHash('sha256').update(b).digest('hex');
function requireSafe(ok: unknown, message: string): asserts ok {
  if (!ok) throw new DeploymentSafetyError(message);
}
type Proposal = Parameters<typeof inspectSeedPlan>[0];
export function assertBootstrapEquivalent(
  current: Proposal,
  baseline: Proposal,
): void {
  inspectSeedPlan(current);
  const proposal = (p: Proposal) =>
    (p.resource_changes ?? [])
      .map((r) => ({
        address: r.address,
        mode: r.mode,
        type: r.type,
        change: r.change,
      }))
      .sort((a, b) => a.address.localeCompare(b.address));
  requireSafe(
    isDeepStrictEqual(proposal(current), proposal(baseline)),
    'Refreshed bootstrap resource identities/configuration differ from D2B',
  );
  requireSafe(
    isDeepStrictEqual(current.configuration, baseline.configuration),
    'Terraform configuration differs from D2B',
  );
}
export async function assertAbsent(file: string): Promise<void> {
  try {
    await lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  throw new DeploymentSafetyError(
    'Existing execution/state metadata refused; preserve it and review recovery',
  );
}

export async function executeBootstrap(
  repository: string,
  inherited = process.env,
) {
  assertDeploymentEnvironment(inherited);
  const context = deploymentContext(repository, 'bootstrap');
  const marker = context.path('first-bootstrap-execution.json');
  await assertAbsent(marker);
  for (const run of await readdir(context.path('plans'))) {
    requireSafe(
      /^[a-f0-9-]{36}$/.test(run),
      'Unexpected bootstrap run directory',
    );
    await assertAbsent(context.path(`plans/${run}/work/terraform.tfstate`));
    await assertAbsent(
      context.path(`plans/${run}/work/terraform.tfstate.backup`),
    );
  }
  const prepared = await prepareBootstrapPlan(repository, inherited);
  const run = /\/plans\/([a-f0-9-]{36})\/bootstrap\.tfplan$/.exec(
    prepared.planPath,
  )?.[1];
  requireSafe(run, 'Invalid newly prepared plan path');
  const prefix = `plans/${run}`;
  const path = (n: string) => context.path(`${prefix}/${n}`);
  const json = async (n: string) => JSON.parse(await readFile(path(n), 'utf8'));
  const receipt = await json('plan-receipt.json');
  const manifest = await json('source-manifest.json');
  const assembly: DeploymentAssembly = {
    context,
    prefix,
    work: context.path(`${prefix}/work`),
    data: context.path(`${prefix}/terraform-data`),
    manifest: path('source-manifest.json'),
    receipt: manifest,
    mode: 'bootstrap-plan',
  };
  const env = {
    ...inherited,
    AWS_MAX_ATTEMPTS: '1',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
    TF_DATA_DIR: assembly.data,
    TF_CLI_CONFIG_FILE: path('terraform.rc'),
    TF_WORKSPACE: 'default',
    TF_IN_AUTOMATION: '1',
    CHECKPOINT_DISABLE: '1',
  };
  const show = (file: string): Proposal => {
    const r = spawnSync('terraform', ['show', '-json', file], {
      cwd: assembly.work,
      env,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 24 * 1024 * 1024,
    });
    requireSafe(
      r.status === 0 && !r.error,
      'Local saved-plan inspection failed',
    );
    return JSON.parse(r.stdout);
  };
  const oldPath = context.path(`plans/${baselineRun}/bootstrap.tfplan`);
  requireSafe(
    hash(await readFile(oldPath)) === baselineHash,
    'Approved D2B plan unavailable or modified',
  );
  const baseline = show(oldPath);
  const oldManifest = JSON.parse(
    await readFile(
      context.path(`plans/${baselineRun}/source-manifest.json`),
      'utf8',
    ),
  );
  requireSafe(
    isDeepStrictEqual(manifest.files, oldManifest.files),
    'Bootstrap sources/lockfile differ from D2B',
  );
  async function verifyPackage(): Promise<Proposal> {
    assertDeploymentEnvironment(inherited);
    await verifyDeploymentAssembly(assembly);
    for (const name of [
      'bootstrap.tfplan',
      'plan-receipt.json',
      'source-manifest.json',
      'seed-backend.json',
      'bootstrap-inputs.tfvars.json',
      'terraform.rc',
    ]) {
      const info = await lstat(path(name));
      requireSafe(
        info.uid === process.getuid?.() && (info.mode & 0o777) === 0o600,
        'Plan package must remain private and owned',
      );
    }
    requireSafe(
      (await readFile(path('terraform.rc'), 'utf8')) ===
        'provider_installation {\n  direct {}\n}\n',
      'Terraform CLI configuration changed',
    );
    requireSafe(
      isDeepStrictEqual(
        await json('seed-backend.json'),
        seedBackendContract(assembly),
      ),
      'Foreign seed backend',
    );
    for (const n of [
      'work/terraform.tfstate',
      'work/terraform.tfstate.backup',
      'terraform-data/terraform.tfstate',
      'terraform-data/terraform.tfstate.backup',
      'terraform-data/environment',
    ])
      await assertAbsent(path(n));
    const currentReceipt = await json('plan-receipt.json');
    requireSafe(
      isDeepStrictEqual(currentReceipt, receipt),
      'Plan receipt changed',
    );
    requireSafe(
      receipt.account === deployment.account &&
        receipt.profile === deployment.profile &&
        receipt.region === deployment.region &&
        receipt.role === deployment.role &&
        receipt.work === assembly.work &&
        receipt.data === assembly.data &&
        receipt.planPath === prepared.planPath &&
        receipt.mode === 'first-bootstrap-plan-only' &&
        receipt.provisioningAuthorized === false &&
        isDeepStrictEqual(receipt.backend, seedBackendContract(assembly)),
      'Foreign plan receipt',
    );
    requireSafe(
      hash(await readFile(prepared.planPath)) === receipt.checksum &&
        receipt.checksum === prepared.checksum,
      'Saved plan changed',
    );
    requireSafe(
      hash(JSON.stringify(manifest)) === receipt.sourceHash,
      'Source binding changed',
    );
    const age = Date.now() - Date.parse(receipt.createdAt);
    requireSafe(
      Number.isFinite(age) && age >= 0 && age <= 15 * 60000,
      'Stale plan refused',
    );
    const plan = show(prepared.planPath);
    requireSafe(
      hash(JSON.stringify(plan.variables)) === receipt.inputHash &&
        hash(JSON.stringify(plan.prior_state ?? null)) ===
          receipt.priorStateHash,
      'Plan inputs/state changed',
    );
    requireSafe(
      isDeepStrictEqual(
        (await json('bootstrap-inputs.tfvars.json')).budget_evidence,
        plan.variables?.['budget_evidence']?.value,
      ),
      'Frozen budget inputs changed',
    );
    assertBootstrapEquivalent(plan, baseline);
    return plan;
  }
  await verifyPackage();
  verifyDeploymentCaller(inherited);
  // Final identity and package checks occur immediately before the single-use claim/apply.
  await verifyPackage();
  await assertAbsent(marker);
  const approval = {
    version: 1,
    account: deployment.account,
    profile: deployment.profile,
    region: deployment.region,
    role: deployment.role,
    planPath: prepared.planPath,
    checksum: receipt.checksum,
    statePath: path('work/terraform.tfstate'),
    startedAt: new Date().toISOString(),
    scope: 'exact D2B twelve creates only',
    budgetUnits:
      'operator confirmed PERCENTAGE: ACTUAL 50/80/100, FORECASTED 100',
    notificationRecipient:
      'inactive; operator explicitly accepted risk; delivery not claimed',
    remoteMigration: false,
    outcome: 'claimed; execution may be incomplete; never automatically retry',
  };
  await writeFile(marker, JSON.stringify(approval, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  process.umask(0o077);
  const result = spawnSync(
    'terraform',
    [
      'apply',
      '-input=false',
      '-no-color',
      '-lock-timeout=30s',
      '-parallelism=1',
      prepared.planPath,
    ],
    {
      cwd: assembly.work,
      env,
      encoding: 'utf8',
      timeout: 600000,
      maxBuffer: 24 * 1024 * 1024,
    },
  );
  await writeFile(
    path('apply.log'),
    (result.stdout ?? '') + (result.stderr ?? ''),
    { mode: 0o600, flag: 'wx' },
  );
  for (const n of ['work/terraform.tfstate', 'work/terraform.tfstate.backup']) {
    try {
      await chmod(path(n), 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  const outcome = {
    ...approval,
    finishedAt: new Date().toISOString(),
    exitCode: result.status,
    outcome:
      result.status === 0 && !result.error
        ? 'apply succeeded; post-verification required'
        : 'apply failed or uncertain; stop, retain local state; no retry',
  };
  await writeFile(
    path('execution-result.json'),
    JSON.stringify(outcome, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  requireSafe(
    result.status === 0 && !result.error,
    `Bootstrap apply failed/uncertain; STOP. Retain state at ${approval.statePath}; see private apply.log. No retry or runtime authorized`,
  );
  return outcome;
}

async function main() {
  if (process.argv.length !== 2)
    throw new DeploymentSafetyError(
      'D2C execute accepts no arguments, target, plan or state overrides',
    );
  console.log(
    JSON.stringify(await executeBootstrap(resolve(__dirname, '..')), null, 2),
  );
}
if (require.main === module) void main().catch(reportDeploymentFailure);
