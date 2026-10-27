/** Only backend-disabled initialization, validation and mocked provider tests. Never AWS, refresh or remote state. */
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertDeploymentEnvironment } from './deployment-guards';
import {
  assembleDeploymentSources,
  verifyDeploymentAssembly,
} from './deployment-sources';
import { reportDeploymentFailure } from './deployment-preflight';
import { DeploymentSafetyError } from './deployment-context';

async function main(): Promise<void> {
  const selected = process.argv[2];
  if (
    process.argv.length > 3 ||
    (selected !== undefined && selected !== 'bootstrap' && selected !== 'demo')
  )
    throw new DeploymentSafetyError(
      'Offline validation accepts only an optional bootstrap/demo root; no target or command overrides',
    );
  assertDeploymentEnvironment(process.env);
  const repository = resolve(__dirname, '..');
  for (const stage of ['bootstrap', 'demo'] as const) {
    if (selected && selected !== stage) continue;
    const assembly = await assembleDeploymentSources(repository, stage);
    const cliConfig = assembly.context.path(`${assembly.prefix}/terraform.rc`);
    await writeFile(cliConfig, 'provider_installation {\n  direct {}\n}\n', {
      mode: 0o600,
      flag: 'wx',
    });
    const env = {
      ...process.env,
      TF_DATA_DIR: assembly.data,
      TF_CLI_CONFIG_FILE: cliConfig,
      TF_IN_AUTOMATION: '1',
      CHECKPOINT_DISABLE: '1',
      AWS_EC2_METADATA_DISABLED: 'true',
    };
    for (const args of [
      ['fmt', '-check', '-recursive'],
      ['init', '-backend=false', '-input=false', '-lockfile=readonly'],
      ['validate', '-no-color'],
      ['test', '-no-color'],
    ]) {
      await verifyDeploymentAssembly(assembly);
      const result = spawnSync('terraform', args, {
        cwd: assembly.work,
        env,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const log = assembly.context.path(`${assembly.prefix}/${args[0]}.log`);
      await writeFile(log, (result.stdout ?? '') + (result.stderr ?? ''), {
        mode: 0o600,
        flag: 'wx',
      });
      if (result.error || result.status !== 0)
        throw new DeploymentSafetyError(
          `Offline ${stage} ${args[0]} failed; inspect private log ${log}`,
        );
      console.log(`PASS ${stage}: terraform ${args.join(' ')}`);
    }
    console.log(`Offline evidence: ${assembly.manifest}`);
  }
}
void main().catch(reportDeploymentFailure);
