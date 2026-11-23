import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

interface Service {
  image?: string;
  platform?: string;
  ports?: { target: number; published: string }[];
  networks: Record<string, unknown>;
  secrets?: { source: string; target: string }[];
  environment?: Record<string, string>;
  restart: string;
  profiles?: string[];
  command: string[];
  healthcheck: { test?: string[]; disable?: boolean };
  volumes?: {
    target: string;
    type: string;
    bind?: { create_host_path?: boolean };
  }[];
}
const model = JSON.parse(
  execFileSync(
    'docker',
    [
      'compose',
      '--profile',
      'setup',
      '-f',
      'container/startup/compose.yaml',
      'config',
      '--format',
      'json',
    ],
    {
      env: {
        ...process.env,
        OPS_IMAGE: 'local-ops:verify',
        STRIPE_IMAGE: 'local-stripe:verify',
        ADMIN_IMAGE: 'local-admin:verify',
        DOMAIN: 'vigil.example.com',
        ACME_EMAIL: 'operator@example.com',
      },
      encoding: 'utf8',
    },
  ),
) as {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean }>;
};
const composeSource = readFileSync('container/startup/compose.yaml', 'utf8');
function storagePolicies(source: string) {
  // These are the three reviewed persistent mounts, not a general YAML parser.
  // Check the declaration itself: older Compose config JSON omits false bools.
  const policies = [
    ...source.matchAll(
      /target: (\/var\/lib\/postgresql|\/data|\/config)\s*\n\s+bind:\s*\{\s*create_host_path:\s*(false|true)\s*\}/g,
    ),
  ];
  assert.deepEqual(policies.map((p) => p[1]).sort(), [
    '/config',
    '/data',
    '/var/lib/postgresql',
  ]);
  for (const p of policies)
    assert.equal(
      p[2],
      'false',
      'persistent storage must explicitly refuse missing paths',
    );
  return policies.map((p) => p[1]!);
}

test('only Caddy publishes ports; PostgreSQL is isolated and persists on an existing mounted directory', () => {
  assert.equal(model.networks['database']!.internal, true);
  for (const [name, service] of Object.entries(model.services)) {
    assert.equal(service.platform, 'linux/arm64');
    if (name !== 'caddy') assert.equal(service.ports, undefined, name);
  }
  assert.deepEqual(
    model.services['caddy']!.ports!.map((p) => p.target),
    [80, 443],
  );
  const db = model.services['postgres']!;
  assert.deepEqual(Object.keys(db.networks), ['database']);
  assert.equal(
    db.environment?.['POSTGRES_PASSWORD_FILE'],
    '/run/secrets/postgres-password',
  );
  assert(!JSON.stringify(db).includes('trust'));
  assert.equal(db.volumes?.[0]?.target, '/var/lib/postgresql');
  storagePolicies(composeSource);
  // Omitted false is a serialization difference, never an inferred safe default.
  assert([undefined, false].includes(db.volumes?.[0]?.bind?.create_host_path));
});

test('persistent mount declaration rejects enabled or omitted host-directory creation', () => {
  assert.throws(() =>
    storagePolicies(
      composeSource.replaceAll(
        'create_host_path: false',
        'create_host_path: true',
      ),
    ),
  );
  assert.throws(() =>
    storagePolicies(
      composeSource.replaceAll('bind: { create_host_path: false }', 'bind: {}'),
    ),
  );
});

test(
  'Compose actually refuses each missing persistent bind path without creating it',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vigil-bind-safety-'));
    const project = 'vigil-bind-test-' + randomUUID();
    const file = join(directory, 'compose.json');
    const image = model.services['postgres']!.image;
    assert(typeof image === 'string');
    const compose = (...args: string[]) =>
      execFileSync('docker', ['compose', '-p', project, '-f', file, ...args], {
        encoding: 'utf8',
        timeout: 15000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    let configured = false;
    const configure = async (
      source: string,
      target: string,
      create: boolean,
    ) => {
      await writeFile(
        file,
        JSON.stringify({
          services: {
            probe: {
              image,
              entrypoint: ['/bin/true'],
              network_mode: 'none',
              volumes: [
                {
                  type: 'bind',
                  source,
                  target,
                  bind: { create_host_path: create },
                },
              ],
            },
          },
        }),
      );
      configured = true;
    };
    try {
      for (const [index, target] of storagePolicies(composeSource).entries()) {
        const source = join(directory, 'missing-' + index);
        await configure(source, target, false);
        assert.throws(
          () => compose('run', '--rm', '--no-deps', '--pull', 'never', 'probe'),
          (error: unknown) =>
            typeof error === 'object' &&
            error !== null &&
            'stderr' in error &&
            typeof error.stderr === 'string' &&
            /bind source path does not exist/i.test(error.stderr),
        );
        await assert.rejects(access(source), { code: 'ENOENT' });
      }
      // A positive control proves a missing image/daemon cannot satisfy the test.
      const control = join(directory, 'creation-control');
      await configure(control, '/proof', true);
      compose('run', '--rm', '--no-deps', '--pull', 'never', 'probe');
      await access(control);
    } finally {
      try {
        if (configured) compose('down', '--remove-orphans');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);

test('runtime containers have scoped secret mounts, technical healthchecks and restarts; owner runs only manually', () => {
  for (const name of ['ops', 'ingress', 'stripe-worker', 'financial-worker']) {
    const service = model.services[name]!;
    assert.equal(service.restart, 'unless-stopped');
    assert.deepEqual(service.secrets, [
      { source: name, target: 'environment' },
    ]);
    assert(service.command.includes('--env-file=/run/secrets/environment'));
    assert(service.healthcheck.test?.length);
    assert(
      !JSON.stringify(service.environment ?? {}).includes('DATABASE_ADMIN_URL'),
    );
  }
  const provision = model.services['provision']!;
  assert.equal(provision.restart, 'no');
  assert.deepEqual(provision.profiles, ['setup']);
  assert.equal(
    model.services['ops']!.environment?.['VIGIL_DEPLOYMENT_MODE'],
    'application',
  );
  assert(
    readFileSync('.dockerignore', 'utf8')
      .split('\n')
      .includes('container/startup/secrets'),
  );
  assert(
    readFileSync('container/startup/secrets/.gitignore', 'utf8').startsWith(
      '*\n',
    ),
  );
});

test('Terraform stays in its exact startup state and retains EBS; host bootstrap cannot leak secrets or start unprovisioned services', () => {
  const version = readFileSync('infra/startup/versions.tf', 'utf8');
  assert(version.includes('startup/terraform.tfstate'));
  assert(!version.includes('demo/terraform.tfstate'));
  assert(version.includes('allowed_account_ids = ["747240980964"]'));
  const source = readFileSync('infra/startup/main.tf', 'utf8');
  const allowed = new Set([
    'aws_security_group',
    'aws_iam_role',
    'aws_iam_role_policy',
    'aws_iam_instance_profile',
    'aws_ebs_volume',
    'aws_instance',
    'aws_volume_attachment',
    'aws_eip',
  ]);
  const resources = [...source.matchAll(/resource "([^"]+)"/g)].map(
    (m) => m[1],
  );
  assert.equal(resources.length, 8);
  for (const resource of resources) assert(allowed.has(resource!));
  assert.match(source, /prevent_destroy\s*=\s*true/);
  assert(!source.includes('aws_ssm_parameter'));
  const shell = readFileSync('infra/startup/user-data.sh.tftpl', 'utf8');
  execFileSync('bash', ['-n'], { input: shell });
  assert(shell.includes('RequiresMountsFor=/srv/vigil-data'));
  assert(shell.includes('ConditionPathIsMountPoint=/srv/vigil-data'));
  assert(!shell.includes('systemctl enable --now vigil-compose'));
  assert(shell.includes('--with-decryption'));
  assert(!shell.includes('set -x'));
});
