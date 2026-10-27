import { spawnSync } from 'node:child_process';
import {
  deployment,
  assertDeploymentEnvironment,
  assertDeploymentIdentity,
} from './deployment-guards';
import {
  deploymentContext,
  DeploymentSafetyError,
  assertDeploymentPrepared,
  prepareBackendContract,
  type DeploymentRoot,
} from './deployment-context';

export type IdentityCommand = (
  args: string[],
  env: NodeJS.ProcessEnv,
) => string;
const identityCommand: IdentityCommand = (args, env) => {
  const result = spawnSync('aws', args, {
    env,
    encoding: 'utf8',
    timeout: 25000,
    maxBuffer: 1024 * 1024,
  });
  // Never persist/echo CLI stdout, stderr, credentials or session ARN on failure.
  if (result.error || result.status !== 0)
    throw new DeploymentSafetyError(
      'STS identity verification failed; complete manual browser login for edtosoy and retry',
    );
  return result.stdout;
};

export function verifyDeploymentCaller(
  env: NodeJS.ProcessEnv,
  caller: IdentityCommand = identityCommand,
): void {
  try {
    assertDeploymentEnvironment(env);
    const response: unknown = JSON.parse(
      caller(
        [
          'sts',
          'get-caller-identity',
          '--profile',
          deployment.profile,
          '--region',
          deployment.region,
          '--output',
          'json',
          '--no-cli-pager',
          '--cli-connect-timeout',
          '5',
          '--cli-read-timeout',
          '15',
        ],
        {
          ...env,
          AWS_DEFAULT_REGION: deployment.region,
          AWS_PAGER: '',
          AWS_CLI_AUTO_PROMPT: 'off',
          AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
        },
      ),
    );
    if (!response || typeof response !== 'object' || Array.isArray(response))
      throw new Error('Malformed STS response');
    const identity = response as Record<string, unknown>;
    if (
      typeof identity['Account'] !== 'string' ||
      typeof identity['Arn'] !== 'string' ||
      typeof identity['UserId'] !== 'string' ||
      !identity['UserId']
    )
      throw new Error('Incomplete STS identity');
    assertDeploymentIdentity(identity['Account'], identity['Arn']);
  } catch (error) {
    if (error instanceof DeploymentSafetyError) throw error;
    // Only locally constructed diagnostics may reach the terminal; mock/CLI errors may contain secrets.
    throw new DeploymentSafetyError(
      'Sydney preflight rejected identity or inherited configuration; require explicit edtosoy/ap-southeast-2 and account 747240980964 role AccountFullAccessRole',
    );
  }
}

/** Returns true only for the two bounded D1A commands. All old command bodies remain unreachable. */
export async function deploymentCommandPreflight(
  repository: string,
  stage: DeploymentRoot,
  command: string | undefined,
  env = process.env,
  caller?: IdentityCommand,
  extraArgs: readonly string[] = [],
): Promise<boolean> {
  const context = deploymentContext(repository, stage);
  if (
    extraArgs.length &&
    ['preflight', 'prepare-backend-contract'].includes(command ?? '')
  )
    throw new DeploymentSafetyError(
      'D1A preflight/local preparation accept no arguments or target overrides',
    );
  verifyDeploymentCaller(env, caller);
  if (command === 'preflight') {
    console.log(
      JSON.stringify({
        account: deployment.account,
        profile: deployment.profile,
        region: deployment.region,
        role: deployment.role,
        root: stage,
        artifacts: context.base,
        deployment: 'disabled pending D1B',
      }),
    );
    return true;
  }
  if (command === 'prepare-backend-contract') {
    await prepareBackendContract(context);
    console.log(
      'Private Sydney backend contract prepared locally; no Terraform execution or bucket creation. Deployment remains disabled pending D1B.',
    );
    return true;
  }
  assertDeploymentPrepared();
}

export function reportDeploymentFailure(error: unknown): void {
  console.error(
    error instanceof DeploymentSafetyError
      ? error.message
      : 'Deployment failed safely; no completion is claimed. Check the Sydney configuration locally.',
  );
  process.exitCode = 1;
}
