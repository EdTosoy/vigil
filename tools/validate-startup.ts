/** Validate a source-only copy with a mocked provider. Never initialize remote state. */
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

async function main() {
  if (process.argv.length !== 2)
    throw new Error('Startup offline validation accepts no arguments');
  for (const name of Object.keys(process.env)) {
    if (/^(TF_|TERRAFORM_)/.test(name))
      throw new Error('Terraform overrides are unsupported');
  }
  const repository = resolve(__dirname, '..');
  const directory = await mkdtemp(join(tmpdir(), 'vigil-startup-validation-'));
  const files = [
    'infra/startup/main.tf',
    'infra/startup/outputs.tf',
    'infra/startup/variables.tf',
    'infra/startup/versions.tf',
    'infra/startup/user-data.sh.tftpl',
    'infra/startup/.terraform.lock.hcl',
    'infra/startup/tests/startup.tftest.hcl',
    'container/startup/compose.yaml',
    'container/startup/Caddyfile',
  ];
  for (const name of files) {
    let source = repository;
    for (const component of name.split('/')) {
      source = join(source, component);
      if ((await lstat(source)).isSymbolicLink())
        throw new Error('Symlinked startup sources are unsupported');
    }
    const target = join(directory, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target);
  }
  const tests = await readFile(
    join(directory, 'infra/startup/tests/startup.tftest.hcl'),
    'utf8',
  );
  if (
    !tests.includes('mock_provider "aws"') ||
    /command\s*=\s*apply/.test(tests)
  )
    throw new Error('Startup tests must use mocked plan-only runs');
  const cli = join(directory, 'terraform.rc');
  await writeFile(cli, 'provider_installation { direct {} }\n', {
    mode: 0o600,
  });
  const credentials = join(directory, 'empty-aws-config');
  await writeFile(credentials, '', { mode: 0o600 });
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('AWS_')),
    ),
    AWS_CONFIG_FILE: credentials,
    AWS_SHARED_CREDENTIALS_FILE: credentials,
    AWS_EC2_METADATA_DISABLED: 'true',
    TF_DATA_DIR: join(directory, 'terraform-data'),
    TF_CLI_CONFIG_FILE: cli,
    TF_IN_AUTOMATION: '1',
    CHECKPOINT_DISABLE: '1',
  };
  console.log(`Startup offline evidence: ${directory}`);
  for (const args of [
    ['fmt', '-check', '-recursive'],
    ['init', '-backend=false', '-input=false', '-lockfile=readonly'],
    ['validate', '-no-color'],
    ['test', '-no-color'],
  ]) {
    const result = spawnSync('terraform', args, {
      cwd: join(directory, 'infra/startup'),
      env,
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 4 * 1024 * 1024,
    });
    await writeFile(
      join(directory, `${args[0]}.log`),
      (result.stdout ?? '') + (result.stderr ?? ''),
      { mode: 0o600 },
    );
    if (result.error || result.status !== 0)
      throw new Error(
        `Startup ${args[0]} failed; inspect ${directory}/${args[0]}.log`,
      );
    console.log(`PASS startup: terraform ${args.join(' ')}`);
  }
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Startup validation failed',
  );
  process.exitCode = 1;
});
