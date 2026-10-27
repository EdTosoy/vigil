/** Sydney-only local contract. This module never copies source, initializes Terraform or reads legacy state. */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deployment } from './deployment-guards';

export type DeploymentRoot = 'bootstrap' | 'demo';

export class DeploymentSafetyError extends Error {}

export function deploymentContext(repository: string, stage: DeploymentRoot) {
  if (stage !== 'bootstrap' && stage !== 'demo')
    throw new DeploymentSafetyError('Unknown deployment root');
  const repositoryPath = realpathSync(repository);
  const base = resolve(
    repositoryPath,
    '.deployment',
    deployment.account,
    deployment.region,
    stage,
  );
  const context = {
    repository: repositoryPath,
    stage,
    base,
    path(name: string): string {
      if (
        isAbsolute(name) ||
        name.split(/[\\/]/).some((part) => part === '..') ||
        name.includes('\0')
      )
        throw new DeploymentSafetyError(
          'Absolute or traversing artifact paths refused',
        );
      const path = resolve(base, name);
      const suffix = relative(base, path);
      if (
        !suffix ||
        suffix === '..' ||
        suffix.startsWith(`..${sep}`) ||
        isAbsolute(suffix)
      )
        throw new DeploymentSafetyError(
          'Deployment artifact must remain inside its target/root namespace',
        );
      // Inspect existing components only, never follow a symlink into legacy/private data.
      let current = repositoryPath;
      for (const part of relative(repositoryPath, path).split(sep)) {
        current = resolve(current, part);
        let info;
        try {
          info = lstatSync(current);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw new DeploymentSafetyError(
            'Cannot inspect deployment artifact path',
          );
        }
        if (
          info.isSymbolicLink() ||
          (!info.isDirectory() && !info.isFile()) ||
          (info.isFile() && info.nlink !== 1)
        )
          throw new DeploymentSafetyError(
            'Symlink, shared file or special deployment artifact refused',
          );
      }
      return path;
    },
  };
  return Object.freeze({
    ...context,
    work: context.path('work'),
    data: context.path('terraform-data'),
    backendFile: context.path('backend.s3.tfbackend.json'),
    plan: context.path(`${stage}.tfplan`),
    receipt: context.path(`${stage}-plan.json`),
    environment: context.path('environment.env'),
    history: context.path('history'),
  });
}
export type DeploymentContext = ReturnType<typeof deploymentContext>;

export function backendContract(stage: DeploymentRoot) {
  if (stage !== 'bootstrap' && stage !== 'demo')
    throw new DeploymentSafetyError('Unknown backend root');
  return {
    bucket: deployment.bucket,
    key: `${stage}/terraform.tfstate`,
    profile: deployment.profile,
    region: deployment.region,
    allowed_account_ids: [deployment.account],
    encrypt: true,
    use_lockfile: true,
  } as const;
}

export function assertBackendConfiguration(
  value: unknown,
  stage: DeploymentRoot,
): void {
  // Exact contract also refuses credential literals, endpoints, alternate workspaces and skip-account flags.
  if (!isDeepStrictEqual(value, backendContract(stage)))
    throw new DeploymentSafetyError(
      'Missing, foreign or unsafe Sydney backend configuration',
    );
}

export async function readBackendConfiguration(
  context: DeploymentContext,
): Promise<ReturnType<typeof backendContract>> {
  try {
    const value: unknown = JSON.parse(
      await readFile(context.path('backend.s3.tfbackend.json'), 'utf8'),
    );
    assertBackendConfiguration(value, context.stage);
    return value as ReturnType<typeof backendContract>;
  } catch {
    throw new DeploymentSafetyError(
      'Missing, foreign or unsafe Sydney backend configuration; no legacy fallback',
    );
  }
}

/** Exclusive local preparation only; never overwrite an existing config or repair a foreign workspace. */
export async function prepareBackendContract(
  context: DeploymentContext,
): Promise<void> {
  const file = context.path('backend.s3.tfbackend.json');
  await mkdir(context.base, { recursive: true, mode: 0o700 });
  // Enforce private permissions on the new namespace without touching shared legacy .deployment.
  for (const path of [
    resolve(context.repository, '.deployment', deployment.account),
    resolve(
      context.repository,
      '.deployment',
      deployment.account,
      deployment.region,
    ),
    context.base,
  ]) {
    const info = lstatSync(path);
    if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
      throw new DeploymentSafetyError(
        'Sydney deployment directories must be private and owned by this user',
      );
  }
  context.path('backend.s3.tfbackend.json');
  await writeFile(
    file,
    JSON.stringify(backendContract(context.stage), null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
}

export interface PlanBinding {
  sourceHash: string;
  inputHash: string;
  stateIdentity: string;
  intent: 'apply' | 'destroy';
}

/** Receipt format for future D1B wiring; local receipts are integrity checks, never authorization. */
export function planReceipt(
  context: DeploymentContext,
  plan: Uint8Array,
  binding: PlanBinding,
) {
  if (context.stage === 'bootstrap' && binding.intent === 'destroy')
    throw new DeploymentSafetyError('Bootstrap destruction is forbidden');
  if (
    ![binding.sourceHash, binding.inputHash].every(
      (v) =>
        typeof v === 'string' && v.length === 64 && /^[a-f0-9]{64}$/.test(v),
    ) ||
    typeof binding.stateIdentity !== 'string' ||
    !binding.stateIdentity.trim() ||
    !['apply', 'destroy'].includes(binding.intent)
  )
    throw new DeploymentSafetyError(
      'Complete source/input/state identity required',
    );
  return {
    version: 1,
    account: deployment.account,
    region: deployment.region,
    profile: deployment.profile,
    role: deployment.role,
    root: context.stage,
    work: context.path('work'),
    data: context.path('terraform-data'),
    planPath: context.path(`${context.stage}.tfplan`),
    backend: backendContract(context.stage),
    workspace: 'default',
    sourceHash: binding.sourceHash,
    inputHash: binding.inputHash,
    stateIdentity: binding.stateIdentity,
    intent: binding.intent,
    checksum: createHash('sha256').update(plan).digest('hex'),
  };
}

export function assertPlanReceipt(
  value: unknown,
  context: DeploymentContext,
  plan: Uint8Array,
  binding: PlanBinding,
): void {
  if (!isDeepStrictEqual(value, planReceipt(context, plan, binding)))
    throw new DeploymentSafetyError(
      'Foreign, stale or modified deployment plan/receipt refused',
    );
}

export async function verifySavedPlan(
  context: DeploymentContext,
  binding: PlanBinding,
): Promise<void> {
  await readBackendConfiguration(context);
  try {
    const receipt: unknown = JSON.parse(
      await readFile(context.path(`${context.stage}-plan.json`), 'utf8'),
    );
    const plan = await readFile(context.path(`${context.stage}.tfplan`));
    assertPlanReceipt(receipt, context, plan, binding);
  } catch {
    throw new DeploymentSafetyError(
      'Missing, foreign, stale or modified deployment plan/receipt refused',
    );
  }
}

/** Deliberately unconditional until isolated source roots and browser-login compatibility pass D1B. */
export function assertDeploymentPrepared(): never {
  throw new DeploymentSafetyError(
    'Sydney deployment commands are disabled pending D1B Terraform/TLS/budget/DNS portability and later explicit resource-creation approval',
  );
}
