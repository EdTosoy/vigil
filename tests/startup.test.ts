import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

interface Service {
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
  assert.equal(db.volumes?.[0]?.bind?.create_host_path, false);
});

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
