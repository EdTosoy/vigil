/** Proposed backend-only capability. This module never creates or changes IAM. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { backendContract, DeploymentSafetyError } from './deployment-context';
import { deployment } from './deployment-guards';

export const runtimeStateRoleName = 'VigilSydneyRuntimeStateRole';
export const runtimeStateRoleArn = `arn:aws:iam::${deployment.account}:role/vigil/${runtimeStateRoleName}`;
export const runtimeStatePolicyName = 'VigilSydneyRuntimeStateOnly';
export const runtimeStatePolicyHashes = {
  trust: 'c2156553d07641211328c890e0737999bc8a9b2f7e33a16091f26faf33309e39',
  permissions:
    '401f112a7064c3a66531b2323cc76d187aa6e0f8c6d6884c012757afb9c8257a',
} as const;

export function runtimeStateDocument(
  kind: keyof typeof runtimeStatePolicyHashes,
) {
  const bytes = readFileSync(
    resolve(__dirname, '../infra/runtime-state-role', `${kind}.proposed.json`),
  );
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    runtimeStatePolicyHashes[kind]
  )
    throw new DeploymentSafetyError(
      'Proposed state-role document changed; separate review required',
    );
  return JSON.parse(bytes.toString());
}

export function runtimeStateBackend(run: string) {
  if (!/^[a-f0-9-]{36}$/.test(run))
    throw new DeploymentSafetyError('Invalid state-session run');
  return {
    ...backendContract('demo'),
    assume_role: {
      role_arn: runtimeStateRoleArn,
      session_name: `vigil-d3f-${run}`,
      duration: '1h',
      policy: JSON.stringify(runtimeStateDocument('permissions')),
    },
  };
}

export function assertRuntimeStateRole(role: Record<string, unknown>) {
  if (
    role['Arn'] !== runtimeStateRoleArn ||
    role['Path'] !== '/vigil/' ||
    role['MaxSessionDuration'] !== 3600 ||
    role['PermissionsBoundary'] ||
    !isDeepStrictEqual(
      role['AssumeRolePolicyDocument'],
      runtimeStateDocument('trust'),
    )
  )
    throw new DeploymentSafetyError(
      'State role absent or differs from the separately reviewed proposal; never repair IAM automatically',
    );
}
