import { resolve } from 'node:path';
import { prepareSavedRuntimePlan } from './runtime-plan';
import { DeploymentSafetyError } from './deployment-context';
import { reportDeploymentFailure } from './deployment-preflight';

async function main() {
  if (process.argv.length !== 2)
    throw new DeploymentSafetyError(
      'Initial runtime plan accepts no arguments, commands or target overrides',
    );
  console.log(
    JSON.stringify(
      await prepareSavedRuntimePlan(resolve(__dirname, '..')),
      null,
      2,
    ),
  );
}
void main().catch(reportDeploymentFailure);
