import { resolve } from 'node:path';
import { prepareBootstrapPlan } from './bootstrap-plan';
import { DeploymentSafetyError } from './deployment-context';
import { reportDeploymentFailure } from './deployment-preflight';

async function main(): Promise<void> {
  if (process.argv.length !== 2)
    throw new DeploymentSafetyError(
      'Bootstrap plan preparation accepts no command, target, backend or state overrides',
    );
  console.log(
    JSON.stringify(
      await prepareBootstrapPlan(resolve(__dirname, '..')),
      null,
      2,
    ),
  );
}
void main().catch(reportDeploymentFailure);
