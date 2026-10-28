import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assembleDeploymentSources,
  verifyDeploymentAssembly,
  deploymentSourceNames,
} from '../tools/deployment-sources';
import { previewTerraformArgs, previewSummary } from '../tools/preview-runtime';
import {
  initialRuntimeAddresses,
  runtimeCallerRoleArn,
} from '../tools/runtime-plan';

test('local preview projection omits only remote backend and rejects backend/state injection', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'vigil-local-preview-'));
  try {
    await mkdir(resolve(root, 'infra/demo/tests'), { recursive: true });
    for (const name of deploymentSourceNames('demo'))
      await cp(
        resolve(__dirname, '../infra/demo', name),
        resolve(root, 'infra/demo', name),
      );
    const a = await assembleDeploymentSources(
      root,
      'demo',
      undefined,
      'local-runtime-preview',
    );
    await verifyDeploymentAssembly(a);
    assert(a.prefix.startsWith('previews/'));
    assert(!a.receipt.files.some((f) => f.name === 'backend.tf'));
    await assert.rejects(
      () => readFile(resolve(a.work, 'backend.tf')),
      /ENOENT/,
    );
    await writeFile(
      resolve(a.work, 'backend.tf'),
      'terraform { backend "s3" {} }',
    );
    await assert.rejects(() => verifyDeploymentAssembly(a), /Unexpected/);
    await rm(resolve(a.work, 'backend.tf'));
    await writeFile(resolve(a.work, 'terraform.tfstate'), 'foreign');
    await assert.rejects(() => verifyDeploymentAssembly(a), /Unexpected/);
    await assert.rejects(
      () =>
        assembleDeploymentSources(
          root,
          'bootstrap',
          undefined,
          'local-runtime-preview',
        ),
      /contexts/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('preview never produces executable saved-plan argv and accepts only complete create-only UI summaries', () => {
  const args = previewTerraformArgs('plan', '/private/vars');
  assert(!args.some((a) => a.startsWith('-out') || a === '-lock=false'));
  assert(
    previewTerraformArgs('init', '/private/vars').includes('-backend=false'),
  );
  for (const op of [
    'apply',
    'destroy',
    'import',
    'show',
    'state',
    'force-unlock',
    'workspace',
    'plan -out=bad',
  ])
    assert.throws(() => previewTerraformArgs(op, '/private/vars'));
  const changes = initialRuntimeAddresses().map((address) => ({
    type: 'planned_change',
    change: {
      resource: { addr: address, resource_type: address.split('.')[0] },
      action: 'create',
    },
  }));
  const stream = [
    ...changes,
    {
      type: 'change_summary',
      changes: { add: 75, change: 0, remove: 0, operation: 'plan' },
    },
  ];
  const json = () => stream.map((v) => JSON.stringify(v)).join('\n');
  assert.equal(previewSummary(json()).savedPlanCreated, false);
  changes[0]!.change.action = 'delete';
  assert.throws(() => previewSummary(json()), /Unexpected/);
});
test('proposed role trusts only actual caller role and contains no identity or state-mutation expansion', async () => {
  const trust = JSON.parse(
    await readFile(
      resolve(__dirname, '../infra/planning-role/trust.proposed.json'),
      'utf8',
    ),
  );
  assert.equal(trust.Statement.length, 1);
  assert.equal(trust.Statement[0].Principal.AWS, runtimeCallerRoleArn);
  assert.equal(trust.Statement[0].Action, 'sts:AssumeRole');
  const policy = JSON.parse(
    await readFile(
      resolve(__dirname, '../infra/planning-role/permissions.proposed.json'),
      'utf8',
    ),
  );
  const allows = policy.Statement.filter(
    (s: { Effect: string }) => s.Effect === 'Allow',
  );
  const writes = allows.filter((s: { Action: string | string[] }) =>
    [s.Action]
      .flat()
      .some((v) => ['s3:PutObject', 's3:DeleteObject'].includes(v)),
  );
  assert.equal(writes.length, 2);
  assert(
    writes.every(
      (s: { Resource: string }) =>
        s.Resource ===
        'arn:aws:s3:::flow-demo-tfstate-747240980964-ap-southeast-2/demo/terraform.tfstate.tflock',
    ),
  );
  assert.equal(
    writes.find((s: { Action: string }) => s.Action === 's3:PutObject')
      .Condition.StringEquals['s3:if-none-match'],
    '*',
  );
});
