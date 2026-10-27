import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertPublicationTarget,
  assertNoTagCollision,
  assertRepository,
  assertVerifiedImages,
  assertPublishedManifest,
  assertPublicationSource,
  assertPublicationPackage,
} from '../tools/publish-images';
import {
  assertDeploymentIdentity,
  assertDeploymentEnvironment,
} from '../tools/deployment-guards';
const revision = 'c4ff82ae980b6442bb74c6cc5027d1d8c3a5e402';
const tag = 'd3a-c4ff82ae980b-20261027T120000Z-1234abcd';
const caHash =
  'd73890748b5a95551800df8a6f07c9c800e32ed34da7e6c9505918bf8ac2398b';
const images = () =>
  ['admin', 'ops', 'stripe'].map((image) => ({
    image: image as 'admin' | 'ops' | 'stripe',
    repository: `flow-demo/${image}`,
    tag,
    revision,
    imageId: 'sha256:' + 'a'.repeat(64),
    architecture: 'amd64',
    os: 'linux',
    user: 'node',
    smokePassed: true,
    caHash,
  }));

test('publication accepts only exact target/repository mapping, committed source tags, no credential conflicts or tag overwrite', () => {
  assertPublicationTarget('flow-demo/ops', revision, tag);
  assertPublicationSource(revision, revision, [
    'tools/publish-images.ts',
    'package.json',
  ]);
  assertNoTagCollision([{ imageTags: ['different'] }], tag);
  const original = {
    scripts: { 'test:deployment': 'tsx tests/guards.ts' },
    dependencies: { approved: '1' },
  };
  const tooling = structuredClone(original) as {
    scripts: Record<string, string>;
    dependencies: { approved: string };
  };
  tooling.scripts['aws:images:publish'] = 'tsx tools/publish-images.ts';
  tooling.scripts['test:deployment'] += ' tests/publication.test.ts';
  assertPublicationPackage(original, tooling);
  const changed = structuredClone(tooling);
  changed.dependencies.approved = '2';
  assert.throws(() => assertPublicationPackage(original, changed));
  for (const repo of [
    'flow-demo/other',
    'other/ops',
    '163596511125.dkr.ecr.us-east-1.amazonaws.com/flow-demo/ops',
  ])
    assert.throws(() => assertPublicationTarget(repo, revision, tag));
  for (const t of [
    '',
    'latest',
    'd3a-wrong-revision-20261027T120000Z-1234abcd',
    tag + '\n',
  ])
    assert.throws(() => assertPublicationTarget('flow-demo/ops', revision, t));
  assert.throws(() =>
    assertPublicationTarget('flow-demo/ops', 'uncommitted', tag),
  );
  assert.throws(() => assertPublicationSource(revision, 'a'.repeat(40), []));
  for (const file of [
    'apps/ops/page.tsx',
    'libs/money/src/index.ts',
    'pnpm-lock.yaml',
    'container/Dockerfile',
    'unrelated.txt',
  ])
    assert.throws(() => assertPublicationSource(revision, revision, [file]));
  assert.throws(() => assertNoTagCollision([{ imageTags: [tag] }], tag));
  for (const [account, arn] of [
    [
      '163596511125',
      'arn:aws:sts::163596511125:assumed-role/AccountFullAccessRole/session',
    ],
    [
      '747240980964',
      'arn:aws:sts::747240980964:assumed-role/WrongRole/session',
    ],
  ])
    assert.throws(() => assertDeploymentIdentity(account!, arn!));
  for (const override of [
    { AWS_REGION: 'us-east-1' },
    { AWS_PROFILE: 'iamadmin-general' },
    { AWS_SESSION_TOKEN: 'fixture' },
  ])
    assert.throws(() =>
      assertDeploymentEnvironment({
        AWS_REGION: 'ap-southeast-2',
        AWS_PROFILE: 'edtosoy',
        ...override,
      }),
    );
});

test('foreign region/account/repository and weakened repository protections fail closed', () => {
  const repo = {
    repositoryName: 'flow-demo/ops',
    registryId: '747240980964',
    repositoryArn:
      'arn:aws:ecr:ap-southeast-2:747240980964:repository/flow-demo/ops',
    repositoryUri:
      '747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/ops',
    imageTagMutability: 'IMMUTABLE',
    encryptionConfiguration: { encryptionType: 'AES256' },
    imageScanningConfiguration: { scanOnPush: true },
  };
  assertRepository(repo, 'flow-demo/ops');
  for (const change of [
    { registryId: '163596511125' },
    { repositoryName: 'flow-demo/admin' },
    {
      repositoryArn: repo.repositoryArn.replace('ap-southeast-2', 'us-east-1'),
    },
    {
      repositoryUri: repo.repositoryUri.replace('747240980964', '163596511125'),
    },
    { imageTagMutability: 'MUTABLE' },
    { imageTagMutabilityExclusionFilters: [{}] },
    { encryptionConfiguration: { encryptionType: 'KMS' } },
    { imageScanningConfiguration: { scanOnPush: false } },
  ])
    assert.throws(() =>
      assertRepository({ ...repo, ...change }, 'flow-demo/ops'),
    );
});

test('no publication set is accepted before every intended build is verified against revision, platform, identity and TLS', () => {
  assertVerifiedImages(images(), revision, tag);
  assert.throws(() =>
    assertVerifiedImages(images().slice(0, 2), revision, tag),
  );
  const duplicate = images();
  duplicate[2] = duplicate[0]!;
  assert.throws(() => assertVerifiedImages(duplicate, revision, tag));
  for (const change of [
    { smokePassed: false },
    { revision: 'a'.repeat(40) },
    { tag: 'latest' },
    { imageId: 'guessed' },
    { architecture: 'arm64' },
    { user: 'root' },
    { caHash: 'wrong' },
    { repository: 'flow-demo/admin' },
  ]) {
    const v = images();
    v[1] = { ...v[1]!, ...change };
    assert.throws(() => assertVerifiedImages(v, revision, tag));
  }
});

test('published manifest digest and config must cryptographically match the locally verified amd64 image', () => {
  const config = 'sha256:' + 'a'.repeat(64);
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: { digest: config },
    layers: [{ digest: 'sha256:' + 'b'.repeat(64) }],
  });
  const digest =
    'sha256:' + createHash('sha256').update(manifest).digest('hex');
  assertPublishedManifest(manifest, digest, config);
  assert.throws(() =>
    assertPublishedManifest(manifest, 'sha256:' + 'f'.repeat(64), config),
  );
  assert.throws(() =>
    assertPublishedManifest(manifest, digest, 'sha256:' + 'c'.repeat(64)),
  );
  assert.throws(() => assertPublishedManifest(manifest + ' ', digest, config));
});

test('publication CLI rejects overrides, wrong identity and inherited conflicts before ECR auth or Docker', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-publication-cli-'));
  const trace = resolve(dir, 'trace');
  try {
    await writeFile(
      resolve(dir, 'aws'),
      `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.MOCK_TRACE,'aws\\n');
console.log(JSON.stringify({Account:'747240980964',Arn:'arn:aws:sts::747240980964:assumed-role/OtherRole/session',UserId:'fixture'}));
`,
      { mode: 0o700 },
    );
    await writeFile(
      resolve(dir, 'docker'),
      `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.MOCK_TRACE,'docker\\n');
process.exit(99);
`,
      { mode: 0o700 },
    );
    const run = (args: string[], overrides = {}) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(__dirname, '../tools/publish-images.ts'),
          ...args,
        ],
        {
          env: {
            PATH: `${dir}:${process.env['PATH']}`,
            HOME: process.env['HOME'],
            AWS_PROFILE: 'edtosoy',
            AWS_REGION: 'ap-southeast-2',
            MOCK_TRACE: trace,
            ...overrides,
          },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
    for (const args of [
      ['--tag=latest'],
      ['--revision=old'],
      ['--repository=other'],
      ['--skip-smoke'],
      ['--approved'],
      ['apply'],
    ])
      assert.equal(run(args).status, 1);
    for (const overrides of [
      { AWS_REGION: 'us-east-1' },
      { AWS_PROFILE: 'iamadmin-general' },
      { AWS_SESSION_TOKEN: 'fixture' },
      { DOCKER_HOST: 'tcp://foreign' },
    ])
      assert.equal(run([], overrides).status, 1);
    await assert.rejects(() => readFile(trace), /ENOENT/);
    assert.equal(run([]).status, 1);
    assert.equal((await readFile(trace, 'utf8')).trim(), 'aws');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
