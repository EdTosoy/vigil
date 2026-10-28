/** Source-only assembly. No historical cache, generated backend, state, plan or secret is an input. */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deployment } from './deployment-guards';
import {
  deploymentContext,
  DeploymentSafetyError,
  type DeploymentRoot,
} from './deployment-context';

const sources = {
  bootstrap: [
    'main.tf',
    'outputs.tf',
    'target.tf',
    'variables.tf',
    'versions.tf',
    '.terraform.lock.hcl',
    'tests/bootstrap.tftest.hcl',
  ],
  demo: [
    'backend.tf',
    'compute.tf',
    'database.tf',
    'https.tf',
    'network.tf',
    'outputs.tf',
    'target.tf',
    'variables.tf',
    'versions.tf',
    '.terraform.lock.hcl',
    'tests/demo.tftest.hcl',
  ],
} as const;
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export function deploymentSourceNames(
  stage: DeploymentRoot,
): readonly string[] {
  return sources[stage];
}

async function sourceBytes(
  repository: string,
  stage: DeploymentRoot,
  name: string,
): Promise<Buffer> {
  let path = repository;
  for (const part of ['infra', stage, ...name.split('/')]) {
    path = resolve(path, part);
    const info = await lstat(path);
    if (
      info.isSymbolicLink() ||
      (!info.isDirectory() && !info.isFile()) ||
      (info.isFile() && info.nlink !== 1)
    )
      throw new DeploymentSafetyError(
        'Deployment source must be a regular unshared file in the approved root',
      );
  }
  return readFile(path);
}

export async function assembleDeploymentSources(
  repository: string,
  stage: DeploymentRoot,
  run: string = randomUUID(),
  mode:
    | 'offline-validation'
    | 'bootstrap-plan'
    | 'runtime-plan-preparation'
    | 'local-runtime-preview' = 'offline-validation',
) {
  if (!/^[a-f0-9-]{36}$/.test(run) || run.length !== 36)
    throw new DeploymentSafetyError('Invalid offline validation identity');
  const context = deploymentContext(repository, stage);
  if (
    ![
      'offline-validation',
      'bootstrap-plan',
      'runtime-plan-preparation',
      'local-runtime-preview',
    ].includes(mode) ||
    (mode === 'bootstrap-plan' && stage !== 'bootstrap') ||
    (mode === 'runtime-plan-preparation' && stage !== 'demo') ||
    (mode === 'local-runtime-preview' && stage !== 'demo')
  )
    throw new DeploymentSafetyError(
      'Plan contexts must match their exact bootstrap/runtime roots',
    );
  const namespace =
    mode === 'bootstrap-plan'
      ? 'plans'
      : mode === 'runtime-plan-preparation'
        ? 'plan-preparation'
        : mode === 'local-runtime-preview'
          ? 'previews'
          : 'offline';
  const prefix = `${namespace}/${run}`;
  const work = context.path(`${prefix}/work`);
  const data = context.path(`${prefix}/terraform-data`);
  const manifest = context.path(`${prefix}/source-manifest.json`);
  const files = await Promise.all(
    sources[stage]
      .filter(
        (name) => mode !== 'local-runtime-preview' || name !== 'backend.tf',
      )
      .map(async (name) => ({
        name,
        bytes: await sourceBytes(context.repository, stage, name),
      })),
  );
  await mkdir(context.base, { recursive: true, mode: 0o700 });
  for (const path of [
    resolve(context.base, '../..'),
    resolve(context.base, '..'),
    context.base,
  ]) {
    const info = await lstat(path);
    if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
      throw new DeploymentSafetyError(
        'Target directories must be private and owned by this user',
      );
  }
  await mkdir(context.path(namespace), { recursive: true, mode: 0o700 });
  // Exclusive run directory: never reconnect, overwrite, clean or migrate a prior workspace.
  await mkdir(context.path(prefix), { mode: 0o700 });
  await mkdir(work, { mode: 0o700 });
  await mkdir(data, { mode: 0o700 });
  for (const file of files) {
    const path = context.path(`${prefix}/work/${file.name}`);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, file.bytes, { mode: 0o600, flag: 'wx' });
  }
  const receipt = {
    version: 1,
    mode,
    account: deployment.account,
    region: deployment.region,
    profile: deployment.profile,
    role: deployment.role,
    root: stage,
    work,
    data,
    files: files.map((file) => ({ name: file.name, sha256: hash(file.bytes) })),
  };
  await writeFile(manifest, JSON.stringify(receipt, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  return { context, prefix, work, data, manifest, receipt, mode };
}
export type DeploymentAssembly = Awaited<
  ReturnType<typeof assembleDeploymentSources>
>;

export async function verifyDeploymentAssembly(
  assembly: DeploymentAssembly,
): Promise<void> {
  const { context, prefix, receipt } = assembly;
  const saved: unknown = JSON.parse(
    await readFile(context.path(`${prefix}/source-manifest.json`), 'utf8'),
  );
  if (
    !isDeepStrictEqual(saved, receipt) ||
    receipt.mode !== assembly.mode ||
    ![
      'offline-validation',
      'bootstrap-plan',
      'runtime-plan-preparation',
      'local-runtime-preview',
    ].includes(assembly.mode) ||
    (assembly.mode === 'bootstrap-plan' && context.stage !== 'bootstrap') ||
    (assembly.mode === 'runtime-plan-preparation' &&
      context.stage !== 'demo') ||
    (assembly.mode === 'local-runtime-preview' && context.stage !== 'demo') ||
    prefix.split('/')[0] !==
      (assembly.mode === 'bootstrap-plan'
        ? 'plans'
        : assembly.mode === 'runtime-plan-preparation'
          ? 'plan-preparation'
          : assembly.mode === 'local-runtime-preview'
            ? 'previews'
            : 'offline') ||
    receipt.account !== deployment.account ||
    receipt.region !== deployment.region ||
    receipt.profile !== deployment.profile ||
    receipt.role !== deployment.role ||
    receipt.root !== context.stage ||
    receipt.work !== context.path(`${prefix}/work`) ||
    receipt.data !== context.path(`${prefix}/terraform-data`)
  )
    throw new DeploymentSafetyError(
      'Foreign or modified offline source manifest refused',
    );
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = context.path(
        `${prefix}/work/${relative(assembly.work, resolve(directory, entry.name))}`,
      );
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(relative(assembly.work, path));
      else throw new DeploymentSafetyError('Unsafe offline workspace entry');
    }
  }
  await walk(assembly.work);
  if (
    !isDeepStrictEqual(
      found.sort(),
      [...sources[context.stage]]
        .filter(
          (name) =>
            assembly.mode !== 'local-runtime-preview' || name !== 'backend.tf',
        )
        .sort(),
    )
  )
    throw new DeploymentSafetyError(
      'Unexpected or missing offline source/backend/state file',
    );
  for (const file of receipt.files) {
    if (
      hash(await sourceBytes(context.repository, context.stage, file.name)) !==
        file.sha256 ||
      hash(await readFile(context.path(`${prefix}/work/${file.name}`))) !==
        file.sha256
    )
      throw new DeploymentSafetyError(
        'Stale or tampered offline sources refused',
      );
  }
}
