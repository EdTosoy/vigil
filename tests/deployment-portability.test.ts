import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, X509Certificate } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { deploymentContext } from '../tools/deployment-context';
import {
  assembleDeploymentSources,
  verifyDeploymentAssembly,
} from '../tools/deployment-sources';
import { assertDeploymentImage } from '../tools/deployment-guards';

const repository = resolve(__dirname, '..');

test('offline CLI permits only fixed backend-disabled/mock commands and rejects modification/credential overrides', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-offline-cli-'));
  const trace = resolve(dir, 'calls.jsonl');
  let work: string | undefined;
  try {
    await writeFile(
      resolve(dir, 'terraform'),
      `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.MOCK_TRACE,JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),data:process.env.TF_DATA_DIR,config:process.env.TF_CLI_CONFIG_FILE})+'\\n');
`,
      { mode: 0o700 },
    );
    await writeFile(resolve(dir, 'aws'), '#!/bin/sh\nexit 99\n', {
      mode: 0o700,
    });
    const env = {
      PATH: `${dir}:${process.env['PATH']}`,
      HOME: process.env['HOME'],
      AWS_PROFILE: 'edtosoy',
      AWS_REGION: 'ap-southeast-2',
      MOCK_TRACE: trace,
    };
    const run = (args: string[], overrides = {}) =>
      spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          resolve(repository, 'tools/validate-deployment.ts'),
          ...args,
        ],
        {
          cwd: repository,
          env: { ...env, ...overrides },
          encoding: 'utf8',
          timeout: 15000,
        },
      );
    for (const args of [
      ['apply'],
      ['destroy'],
      ['--backend=true'],
      ['bootstrap', '-migrate-state'],
    ])
      assert.equal(run(args).status, 1);
    for (const overrides of [
      { AWS_PROFILE: 'iamadmin-general' },
      { AWS_REGION: 'us-east-1' },
      { TF_DATA_DIR: '/foreign' },
      { AWS_SESSION_TOKEN: 'fixture' },
    ])
      assert.equal(run(['bootstrap'], overrides).status, 1);
    await assert.rejects(
      () => readFile(trace),
      /ENOENT/,
      'all invalid commands fail before Terraform',
    );
    const result = run(['bootstrap']);
    assert.equal(result.status, 0, result.stderr);
    const calls = (await readFile(trace, 'utf8'))
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            args: string[];
            cwd: string;
            data: string;
            config: string;
          },
      );
    work = calls[0]!.cwd;
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        ['fmt', '-check', '-recursive'],
        ['init', '-backend=false', '-input=false', '-lockfile=readonly'],
        ['validate', '-no-color'],
        ['test', '-no-color'],
      ],
    );
    const context = deploymentContext(repository, 'bootstrap');
    for (const call of calls) {
      assert.ok(call.cwd.startsWith(context.path('offline') + '/'));
      assert.equal(call.data, resolve(call.cwd, '../terraform-data'));
      assert.equal(call.config, resolve(call.cwd, '../terraform.rc'));
    }
  } finally {
    if (work) {
      const context = deploymentContext(repository, 'bootstrap');
      const runId = work.split('/').at(-2)!;
      if (/^[a-f0-9-]{36}$/.test(runId))
        await rm(context.path(`offline/${runId}`), {
          recursive: true,
          force: true,
        });
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('offline assembly excludes legacy backends/cache/state/variables, rejects stale manifests and cannot overwrite work', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'vigil-portability-'));
  try {
    // Copy only tracked public source fixtures. Poisoned legacy artifacts must never be loaded.
    const paths = [
      'main.tf',
      'outputs.tf',
      'target.tf',
      'variables.tf',
      'versions.tf',
      '.terraform.lock.hcl',
      'tests/bootstrap.tftest.hcl',
    ];
    await mkdir(resolve(dir, 'infra/bootstrap/tests'), { recursive: true });
    for (const name of paths)
      await copyFile(
        resolve(repository, 'infra/bootstrap', name),
        resolve(dir, 'infra/bootstrap', name),
      );
    await mkdir(resolve(dir, 'infra/bootstrap/.terraform'), {
      recursive: true,
    });
    for (const name of [
      'backend.generated.tf',
      'terraform.tfstate',
      'bootstrap.tfplan',
      'terraform.tfvars',
      '.terraform/terraform.tfstate',
    ])
      await writeFile(
        resolve(dir, 'infra/bootstrap', name),
        'foreign-must-not-be-read',
      );
    const assembly = await assembleDeploymentSources(dir, 'bootstrap');
    await verifyDeploymentAssembly(assembly);
    assert.ok(
      assembly.work.startsWith(
        `${dir}/.deployment/747240980964/ap-southeast-2/bootstrap/offline/`,
      ),
    );
    await assert.rejects(
      () =>
        assembleDeploymentSources(
          dir,
          'bootstrap',
          assembly.prefix.split('/')[1],
        ),
      /EEXIST/,
    );
    await writeFile(resolve(assembly.work, 'backend.generated.tf'), 'foreign');
    await assert.rejects(
      () => verifyDeploymentAssembly(assembly),
      /Unexpected/,
    );
    await rm(resolve(assembly.work, 'backend.generated.tf'));
    await writeFile(
      assembly.manifest,
      JSON.stringify({ ...assembly.receipt, account: '163596511125' }),
    );
    await assert.rejects(() => verifyDeploymentAssembly(assembly), /manifest/);
    await writeFile(assembly.manifest, JSON.stringify(assembly.receipt));
    await writeFile(resolve(assembly.work, 'main.tf'), 'tampered');
    await assert.rejects(() => verifyDeploymentAssembly(assembly), /tampered/);
    await copyFile(
      resolve(repository, 'infra/bootstrap/main.tf'),
      resolve(assembly.work, 'main.tf'),
    );
    await writeFile(resolve(dir, 'infra/bootstrap/main.tf'), 'changed-source');
    await assert.rejects(() => verifyDeploymentAssembly(assembly), /Stale/);
    await rm(resolve(dir, 'infra/bootstrap/target.tf'));
    await symlink(
      resolve(repository, 'infra/bootstrap/target.tf'),
      resolve(dir, 'infra/bootstrap/target.tf'),
    );
    await assert.rejects(
      () => assembleDeploymentSources(dir, 'bootstrap'),
      /regular unshared file/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('provider, backend, budget and DNS sources encode exact new target without any DNS/budget ownership', async () => {
  for (const stage of ['bootstrap', 'demo']) {
    const provider = await readFile(
      resolve(repository, `infra/${stage}/versions.tf`),
      'utf8',
    );
    assert.match(provider, /allowed_account_ids\s*=\s*\[var.aws_account_id\]/);
    assert.match(provider, /profile\s*=\s*var.aws_profile/);
    assert.match(provider, /region\s*=\s*var.aws_region/);
    assert.match(provider, /6\.68\.0/);
    const target = await readFile(
      resolve(repository, `infra/${stage}/target.tf`),
      'utf8',
    );
    for (const value of ['747240980964', 'edtosoy', 'ap-southeast-2'])
      assert.ok(target.includes(`== "${value}"`));
  }
  const backend = await readFile(
    resolve(repository, 'infra/demo/backend.tf'),
    'utf8',
  );
  for (const value of [
    '747240980964',
    'ap-southeast-2',
    'edtosoy',
    'use_lockfile',
    'encrypt',
  ])
    assert.ok(backend.includes(value));
  assert.doesNotMatch(backend, /163596511125|iamadmin-general|us-east-1/);
  const bootstrap = await readFile(
    resolve(repository, 'infra/bootstrap/main.tf'),
    'utf8',
  );
  assert.match(bootstrap, /data "aws_budgets_budget" "existing"/);
  assert.doesNotMatch(
    bootstrap,
    /resource "aws_budgets_budget"|aws_route53_zone/,
  );
  const https = await readFile(
    resolve(repository, 'infra/demo/https.tf'),
    'utf8',
  );
  assert.doesNotMatch(https, /aws_route53|flow\.edtosoy\.com/);
  assert.match(https, /certificate_dns_confirmed \? 1 : 0/);
});

test('image identities reject historical accounts, regions, repositories, mutable tags and newline suffixes', () => {
  const valid =
    '747240980964.dkr.ecr.ap-southeast-2.amazonaws.com/flow-demo/ops@sha256:' +
    'a'.repeat(64);
  assertDeploymentImage(valid);
  for (const value of [
    valid.replace('747240980964', '163596511125'),
    valid.replace('ap-southeast-2', 'us-east-1'),
    valid.replace('/ops@', '/foreign@'),
    valid.replace('@sha256:', ':latest-'),
    valid + '\n',
  ])
    assert.throws(() => assertDeploymentImage(value));
});

test('official Sydney CA bundle is intact, self-signed, unexpired and packaged for every image without weakening pg TLS', async () => {
  const pem = await readFile(resolve(repository, 'container/rds-ca.pem'));
  const metadata = JSON.parse(
    await readFile(resolve(repository, 'container/rds-ca.json'), 'utf8'),
  ) as {
    source: string;
    sha256: string;
    certificates: { fingerprint256: string }[];
  };
  assert.equal(
    metadata.source,
    'https://truststore.pki.rds.amazonaws.com/ap-southeast-2/ap-southeast-2-bundle.pem',
  );
  assert.equal(createHash('sha256').update(pem).digest('hex'), metadata.sha256);
  const blocks = pem
    .toString()
    .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)!;
  assert.equal(blocks.length, 3);
  for (const [index, block] of blocks.entries()) {
    const cert = new X509Certificate(block);
    assert.match(cert.subject, /Amazon RDS ap-southeast-2 Root CA/);
    assert.ok(cert.ca && cert.verify(cert.publicKey));
    assert.equal(cert.issuer, cert.subject);
    assert.equal(
      cert.fingerprint256,
      metadata.certificates[index]!.fingerprint256,
    );
    assert.ok(
      Date.parse(cert.validFrom) < Date.now() &&
        Date.parse(cert.validTo) > Date.now() + 30 * 86400000,
    );
  }
  const docker = await readFile(
    resolve(repository, 'container/Dockerfile'),
    'utf8',
  );
  assert.match(docker, /NODE_EXTRA_CA_CERTS=\/app\/rds-ca.pem/);
  assert.match(
    docker,
    /COPY --chown=node:node container\/rds-ca.pem \/app\/rds-ca.pem/,
  );
  for (const target of ['ops', 'stripe', 'admin'])
    assert.match(docker, new RegExp(`FROM base AS ${target}`));
  const database = await readFile(
    resolve(repository, 'infra/demo/database.tf'),
    'utf8',
  );
  assert.ok((database.match(/sslmode=verify-full/g) ?? []).length >= 2);
  assert.match(database, /rds.force_ssl/);
  const requirePg = createRequire(createRequire(__filename).resolve('pg'));
  const parse = requirePg('pg-connection-string').parse as (url: string) => {
    ssl: Record<string, unknown>;
  };
  const ssl = parse(
    'postgresql://example:example@db.ap-southeast-2.rds.amazonaws.com/db?sslmode=verify-full',
  ).ssl;
  assert.equal(typeof ssl, 'object');
  assert.notEqual(ssl['rejectUnauthorized'], false);
  assert.equal(
    ssl['checkServerIdentity'],
    undefined,
    'Node retains hostname verification',
  );
});

test('production Docker assembly uses Vigil packages, standalone assets and all expected worker/admin entrypoints', async () => {
  const docker = await readFile(
    resolve(repository, 'container/Dockerfile'),
    'utf8',
  );
  assert.match(docker, /pnpm install --frozen-lockfile/);
  assert.match(docker, /pnpm --filter @vigil\/ops build/);
  assert.doesNotMatch(docker, /@flow\//);
  for (const path of [
    'apps/ops/.next/standalone',
    'apps/ops/.next/static',
    'apps/ops/public',
  ])
    assert.ok(docker.includes(path));
  const builder = await readFile(
    resolve(repository, 'tools/build-containers.mjs'),
    'utf8',
  );
  for (const path of [
    'apps/integrations/src/main.ts',
    'tools/stripe-worker.ts',
    'tools/cloud-provision.ts',
    'tools/stripe-backfill.ts',
    'tools/stripe-verify-sandbox.ts',
    'tools/cloud-stripe-proof.ts',
    'tools/worker.ts',
  ])
    assert.ok(builder.includes(path));
  const ignore = await readFile(resolve(repository, '.dockerignore'), 'utf8');
  for (const path of [
    '.deployment',
    '.aws',
    '**/.env.*',
    'infra',
    '**/*oracle*',
  ])
    assert.ok(ignore.includes(path));
});
