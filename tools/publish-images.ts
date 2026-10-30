/** D3A only: committed sources -> three locally verified images -> exact Sydney ECR repositories. */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deployment, assertDeploymentEnvironment } from './deployment-guards';
import { deploymentContext, DeploymentSafetyError } from './deployment-context';
import {
  verifyDeploymentCaller,
  reportDeploymentFailure,
} from './deployment-preflight';

export const publicationImages = ['admin', 'ops', 'stripe'] as const;
type Image = (typeof publicationImages)[number];
const registry = `${deployment.account}.dkr.ecr.${deployment.region}.amazonaws.com`;
const caHash =
  'd73890748b5a95551800df8a6f07c9c800e32ed34da7e6c9505918bf8ac2398b';
const stateRun = 'plans/7672de2b-8c20-4488-b356-68075ce9b0d5';
const stateHash =
  '83a22793b582723d0849a1840a7236e4dd2c6d1aefdf7a332e4cca32ce956235';
const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new DeploymentSafetyError(message);
}
export function assertPublicationTarget(
  repository: string,
  revision: string,
  tag: string,
): void {
  check(
    revision.length === 40 && /^([a-f0-9]{40})$/.test(revision),
    'Committed full source revision required',
  );
  check(
    publicationImages.some((image) => repository === `flow-demo/${image}`),
    'Repository outside the approved image mapping',
  );
  check(
    new RegExp(
      `^d3a-${revision.slice(0, 12)}-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$`,
    ).exec(tag)?.[0] === tag,
    'Missing, mutable or conflicting source-linked tag',
  );
}
export function assertNoTagCollision(
  details: { imageTags?: string[] }[],
  tag: string,
): void {
  check(
    !details.some((d) => d.imageTags?.includes(tag)),
    'Existing immutable target tag refused',
  );
}
export function assertPublicationSource(
  expected: string,
  head: string,
  changed: string[],
): void {
  check(
    expected.length === 40 &&
      /^[a-f0-9]{40}$/.test(expected) &&
      head === expected,
    'Committed source revision changed',
  );
  const tooling = [
    'tools/publish-images.ts',
    'tests/publication.test.ts',
    'package.json',
    'infra/AGENTS.md',
    'docs/phase15/sydney-d3a.md',
  ];
  check(
    changed.every((f) => tooling.includes(f)),
    'Uncommitted application or unrelated source changes; commit intended source first',
  );
}
export function assertPublicationPackage(
  original: { scripts: Record<string, string>; [key: string]: unknown },
  current: unknown,
): void {
  const expected = structuredClone(original);
  expected.scripts['aws:images:publish'] = 'tsx tools/publish-images.ts';
  if (
    !expected.scripts['test:deployment']
      ?.split(' ')
      .includes('tests/publication.test.ts')
  )
    expected.scripts['test:deployment'] += ' tests/publication.test.ts';
  check(
    isDeepStrictEqual(current, expected),
    'Uncommitted workspace/package source changes',
  );
}
interface EcrRepository {
  repositoryName?: string;
  registryId?: string;
  repositoryArn?: string;
  repositoryUri?: string;
  imageTagMutability?: string;
  imageTagMutabilityExclusionFilters?: unknown[];
  encryptionConfiguration?: { encryptionType?: string };
  imageScanningConfiguration?: { scanOnPush?: boolean };
}
export function assertRepository(repo: EcrRepository, name: string): void {
  check(
    publicationImages.some((n) => name === `flow-demo/${n}`) &&
      repo.repositoryName === name &&
      repo.registryId === deployment.account &&
      repo.repositoryArn ===
        `arn:aws:ecr:${deployment.region}:${deployment.account}:repository/${name}` &&
      repo.repositoryUri === `${registry}/${name}`,
    'Foreign repository identity',
  );
  check(
    repo.imageTagMutability === 'IMMUTABLE' &&
      !repo.imageTagMutabilityExclusionFilters?.length &&
      repo.encryptionConfiguration?.encryptionType === 'AES256' &&
      repo.imageScanningConfiguration?.scanOnPush === true,
    'Repository security configuration differs from approved bootstrap',
  );
}
interface VerifiedImage {
  image: Image;
  repository: string;
  tag: string;
  revision: string;
  imageId: string;
  architecture: string;
  os: string;
  user: string;
  smokePassed: boolean;
  caHash: string;
}
export function assertVerifiedImages(
  images: VerifiedImage[],
  revision: string,
  tag: string,
): void {
  check(
    images.length === 3 && new Set(images.map((i) => i.image)).size === 3,
    'Exactly three verified images required',
  );
  for (const i of images) {
    assertPublicationTarget(i.repository, revision, tag);
    check(
      publicationImages.includes(i.image) &&
        i.repository === `flow-demo/${i.image}` &&
        i.revision === revision &&
        i.tag === tag &&
        /^sha256:[a-f0-9]{64}$/.test(i.imageId) &&
        i.architecture === 'amd64' &&
        i.os === 'linux' &&
        i.user === 'node' &&
        i.smokePassed &&
        i.caHash === caHash,
      'Unverified or conflicting build artifact',
    );
  }
}
export function assertPublishedManifest(
  manifestText: string,
  expectedDigest: string,
  imageId: string,
): void {
  check(
    /^sha256:[a-f0-9]{64}$/.test(expectedDigest) &&
      `sha256:${digest(manifestText)}` === expectedDigest,
    'Published manifest digest mismatch',
  );
  const m = JSON.parse(manifestText);
  check(
    m.schemaVersion === 2 &&
      [
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
      ].includes(m.mediaType) &&
      m.config?.digest === imageId &&
      Array.isArray(m.layers) &&
      m.layers.length > 0,
    'Published manifest does not match verified image config/platform',
  );
}

export async function publishImages(
  repository: string,
  inherited = process.env,
  cycle?: string,
) {
  check(
    cycle === undefined ||
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(cycle),
    'Exact publication cycle UUID required',
  );
  assertDeploymentEnvironment(inherited);
  check(
    !Object.keys(inherited).some((k) => /^(DOCKER_|BUILDX_)/.test(k)),
    'Inherited Docker endpoint/config overrides refused',
  );
  const context = deploymentContext(repository, 'demo');
  if (cycle) {
    const { runtimeCycleStore } = await import('./runtime-cycle.js');
    await runtimeCycleStore(repository, cycle).load();
  }
  const boot = deploymentContext(repository, 'bootstrap');
  const calls: object[] = [];
  const env = {
    ...inherited,
    AWS_PAGER: '',
    AWS_CLI_AUTO_PROMPT: 'off',
    AWS_MAX_ATTEMPTS: '1',
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
  };
  function identity() {
    verifyDeploymentCaller(env, (args, selected) => {
      const r = spawnSync('aws', args, {
        env: selected,
        encoding: 'utf8',
        timeout: 25000,
      });
      calls.push({
        action: 'sts:GetCallerIdentity',
        readOnly: true,
        success: r.status === 0,
      });
      check(
        r.status === 0 && !r.error,
        'STS failed; manual aws login --profile edtosoy required',
      );
      return r.stdout;
    });
  }
  identity();
  function command(
    program: string,
    args: string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      input?: string;
      timeout?: number;
    } = {},
  ) {
    const r = spawnSync(program, args, {
      cwd: options.cwd ?? repository,
      env: options.env ?? env,
      input: options.input,
      encoding: 'utf8',
      timeout: options.timeout ?? 30000,
      maxBuffer: 32 * 1024 * 1024,
    });
    check(
      r.status === 0 && !r.error,
      `${program} operation failed; stop and inspect private run evidence`,
    );
    return r.stdout;
  }
  const git = (args: string[]) => command('git', args);
  const revision = git(['rev-parse', 'HEAD']).trim();
  const tag = `d3a-${revision.slice(0, 12)}-${new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}-${randomUUID().slice(0, 8)}`;
  assertPublicationTarget('flow-demo/admin', revision, tag);
  function verifySource() {
    const files = [
      ...git(['diff', '--name-only', '--no-renames', '-z', 'HEAD']).split('\0'),
      ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
    ].filter(Boolean);
    assertPublicationSource(revision, git(['rev-parse', 'HEAD']).trim(), files);
    const original = JSON.parse(git(['show', `${revision}:package.json`]));
    const current = JSON.parse(
      readFileSync(resolve(repository, 'package.json'), 'utf8'),
    );
    assertPublicationPackage(original, current);
    return files;
  }
  verifySource();
  const statePaths = [
    'work/terraform.tfstate',
    'state-custody-backup.tfstate',
  ].map((n) => boot.path(`${stateRun}/${n}`));
  async function stateSnapshot() {
    return Promise.all(
      statePaths.map(async (p) => {
        const s = await lstat(p);
        const sha = digest(await readFile(p));
        check(
          s.isFile() &&
            s.nlink === 1 &&
            (s.mode & 0o777) === 0o600 &&
            sha === stateHash,
          'Bootstrap state custody changed; stop publication',
        );
        return {
          path: p,
          sha256: sha,
          mode: s.mode,
          mtime: s.mtimeMs,
          size: s.size,
        };
      }),
    );
  }
  const stateBefore = await stateSnapshot();
  const claim = context.path(
    cycle ? `cycles/${cycle}/image-publication.json` : 'd3a-publication.json',
  );
  try {
    await lstat(claim);
    throw new DeploymentSafetyError(
      'D3A publication already claimed; review existing/partial results, never auto-retry',
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  process.umask(0o077);
  await mkdir(context.base, { recursive: true, mode: 0o700 });
  for (const dir of [
    resolve(context.base, '../..'),
    resolve(context.base, '..'),
    context.base,
  ]) {
    const info = await lstat(dir);
    check(
      info.uid === process.getuid?.() && (info.mode & 0o077) === 0,
      'Publication namespace must be private and owned',
    );
  }
  const prefix = `publication/${randomUUID()}`;
  await mkdir(context.path('publication'), { recursive: true, mode: 0o700 });
  await mkdir(context.path(prefix), { mode: 0o700 });
  const path = (n: string) => context.path(`${prefix}/${n}`);
  const save = (n: string, v: unknown) =>
    writeFile(path(n), JSON.stringify(v, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  const dockerConfig = path('docker');
  await mkdir(dockerConfig, { mode: 0o700 });
  await writeFile(path('docker/config.json'), '{}\n', {
    mode: 0o600,
    flag: 'wx',
  });
  const dockerEnv = {
    PATH: inherited['PATH'],
    HOME: inherited['HOME'],
    DOCKER_CONFIG: dockerConfig,
    BUILDKIT_PROGRESS: 'plain',
  };
  const verified: VerifiedImage[] = [];
  const published: object[] = [];
  let publicationStarted = false;
  const aws = (op: string, args: string[] = [], secret = false) => {
    check(
      [
        'describe-repositories',
        'describe-images',
        'get-lifecycle-policy',
        'get-registry-scanning-configuration',
        'batch-get-image',
        'get-login-password',
      ].includes(op),
      'Unsupported AWS action',
    );
    const r = spawnSync(
      'aws',
      [
        'ecr',
        op,
        ...args,
        '--profile',
        deployment.profile,
        '--region',
        deployment.region,
        '--no-cli-pager',
        '--cli-connect-timeout',
        '5',
        '--cli-read-timeout',
        '15',
        ...(secret ? [] : ['--output', 'json', '--no-paginate']),
      ],
      { env, encoding: 'utf8', timeout: 25000, maxBuffer: 8 * 1024 * 1024 },
    );
    calls.push({
      action: `ecr:${op}`,
      readOnly: true,
      success: r.status === 0,
    });
    check(r.status === 0 && !r.error, `ECR ${op} failed; no automatic retry`);
    return secret ? r.stdout : JSON.parse(r.stdout);
  };
  function repositories() {
    const response = aws('describe-repositories', [
      '--registry-id',
      deployment.account,
      '--repository-names',
      ...publicationImages.map((n) => `flow-demo/${n}`),
    ]);
    check(response.repositories?.length === 3, 'Missing approved repositories');
    for (const image of publicationImages) {
      const name = `flow-demo/${image}`;
      assertRepository(
        response.repositories.find(
          (r: EcrRepository) => r.repositoryName === name,
        ) ?? {},
        name,
      );
      const lifecycle = aws('get-lifecycle-policy', [
        '--registry-id',
        deployment.account,
        '--repository-name',
        name,
      ]);
      check(
        isDeepStrictEqual(JSON.parse(lifecycle.lifecyclePolicyText), {
          rules: [
            {
              rulePriority: 1,
              description: 'Expire untagged build remnants after seven days',
              selection: {
                tagStatus: 'untagged',
                countType: 'sinceImagePushed',
                countUnit: 'days',
                countNumber: 7,
              },
              action: { type: 'expire' },
            },
          ],
        }),
        'Unexpected repository lifecycle policy',
      );
      const details = aws('describe-images', [
        '--registry-id',
        deployment.account,
        '--repository-name',
        name,
        '--max-results',
        '100',
      ]);
      check(
        !details.nextToken && Array.isArray(details.imageDetails),
        'Unbounded image inventory',
      );
      assertNoTagCollision(details.imageDetails, tag);
    }
  }
  try {
    repositories();
    const scanning = aws('get-registry-scanning-configuration');
    check(
      scanning.registryId === deployment.account &&
        scanning.scanningConfiguration?.scanType === 'BASIC',
      'Unexpected scanning mode',
    );
    await save('source.json', {
      revision,
      tag,
      mapping: {
        admin: 'one-shot provision/migration/verification tools',
        ops: 'Next.js operations dashboard',
        stripe: 'sandbox ingress and durable PostgreSQL Stripe worker',
      },
      sourceMode:
        'git archive of committed HEAD; uncommitted publication tooling excluded',
      initialToolingChanges: verifySource(),
      stateBefore,
    });
    const tree = git(['ls-tree', '-r', revision]);
    check(
      tree
        .split('\n')
        .filter(Boolean)
        .every((l) => /^(100644|100755) blob /.test(l)),
      'Symlink/submodule source entries unsupported',
    );
    command('git', [
      'archive',
      '--format=tar',
      `--output=${path('source.tar')}`,
      revision,
    ]);
    await mkdir(path('source'), { mode: 0o700 });
    command('tar', [
      '-xf',
      path('source.tar'),
      '-C',
      path('source'),
      '--no-same-owner',
      '--no-same-permissions',
    ]);
    const ignore = await readFile(path('source/.dockerignore'), 'utf8');
    check(
      ['.git', '.aws', '.deployment', '.env', '**/.env', '**/.env.*'].every(
        (p) => ignore.split('\n').includes(p),
      ),
      'Docker context credential exclusions missing',
    );
    check(
      digest(await readFile(path('source/container/rds-ca.pem'))) === caHash,
      'Unexpected Sydney CA source',
    );
    const assets = Object.fromEntries(
      await Promise.all(
        [
          'favicon-16x16.png',
          'favicon-32x32.png',
          'favicon-48x48.png',
          'apple-touch-icon.png',
          'android-chrome-192x192.png',
          'android-chrome-512x512.png',
          'site.webmanifest',
        ].map(async (n) => [
          n,
          digest(await readFile(path(`source/apps/ops/public/${n}`))),
        ]),
      ),
    );
    const commands: Record<Image, string[]> = {
      admin: ['node', 'tools/provision.cjs'],
      ops: ['node', 'apps/ops/server.js'],
      stripe: ['node', 'tools/ingress.cjs'],
    };
    for (const image of publicationImages) {
      console.log(
        JSON.stringify({ stage: 'build-and-smoke', image, revision }),
      );
      const target = `${registry}/flow-demo/${image}:${tag}`;
      const r = spawnSync(
        'docker',
        [
          'build',
          '--platform',
          'linux/amd64',
          '--target',
          image,
          '--build-arg',
          `VIGIL_IMAGE_REVISION=${revision}`,
          '--label',
          `org.opencontainers.image.revision=${revision}`,
          '-f',
          'container/Dockerfile',
          '-t',
          target,
          '.',
        ],
        {
          cwd: path('source'),
          env: dockerEnv,
          encoding: 'utf8',
          timeout: 1800000,
          maxBuffer: 32 * 1024 * 1024,
        },
      );
      await writeFile(
        path(`${image}-build.log`),
        (r.stdout ?? '') + (r.stderr ?? ''),
        { mode: 0o600, flag: 'wx' },
      );
      check(
        r.status === 0 && !r.error,
        `Image ${image} build failed; publish none`,
      );
      const inspected = JSON.parse(
        command('docker', ['image', 'inspect', target], { env: dockerEnv }),
      )[0];
      check(
        inspected.Architecture === 'amd64' &&
          inspected.Os === 'linux' &&
          inspected.Config.User === 'node' &&
          inspected.Config.Labels?.['org.opencontainers.image.revision'] ===
            revision &&
          isDeepStrictEqual(inspected.Config.Cmd, commands[image]),
        'Unexpected image platform/user/revision/entrypoint',
      );
      check(
        inspected.Config.Env.includes('NODE_EXTRA_CA_CERTS=/app/rds-ca.pem') &&
          !inspected.Config.Env.some((v: string) =>
            /^(AWS_|DATABASE_|STRIPE_(SECRET|API_KEY)|VIGIL_DEMO_(USERNAME|PASSWORD)|NODE_TLS_REJECT_UNAUTHORIZED=0)/.test(
              v,
            ),
          ),
        'Unexpected credential or insecure TLS image environment',
      );
      const smoke = `const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');assert.equal(process.getuid(),1000);assert.equal(process.env.NODE_EXTRA_CA_CERTS,'/app/rds-ca.pem');assert.equal(crypto.createHash('sha256').update(fs.readFileSync('/app/rds-ca.pem')).digest('hex'),'${caHash}');assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED,undefined);assert(require('node:tls').checkServerIdentity('wrong.example',{subjectaltname:'DNS:right.example'}) instanceof Error);for(const p of ['/app/.env','/app/.aws','/home/node/.aws','/app/apps/ops/.env','/app/apps/ops/.env.local'])assert(!fs.existsSync(p));const image=${JSON.stringify(image)};if(image==='ops'){assert(fs.existsSync('/app/apps/ops/server.js'));assert(fs.existsSync('/app/apps/ops/.next/static'));for(const [n,h]of Object.entries(${JSON.stringify(assets)}))assert.equal(crypto.createHash('sha256').update(fs.readFileSync('/app/apps/ops/public/'+n)).digest('hex'),h);}else{for(const n of image==='stripe'?['ingress','worker']:['provision','verify','backfill','proof','generalWorker'])assert.equal(cp.spawnSync(process.execPath,['--check','/app/tools/'+n+'.cjs']).status,0);if(image==='admin')assert(fs.existsSync('/app/database/migrations'));}console.log('PASS nonroot/CA/TLS/assets/entrypoints');`;
      const smokeOut = command(
        'docker',
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--entrypoint',
          'node',
          inspected.Id,
          '-e',
          smoke,
        ],
        { env: dockerEnv, timeout: 60000 },
      );
      await writeFile(path(`${image}-smoke.log`), smokeOut, {
        mode: 0o600,
        flag: 'wx',
      });
      if (image === 'ops') {
        const expected = cycle
          ? [
              ['/health/ready', 503],
              ['/sign-in', 200],
              ['/metrics', 307],
              ['/overview', 307],
            ]
          : [
              ['/health/ready', 503],
              ['/metrics', 503],
              ['/overview', 503],
            ];
        const httpSmoke = `const a=require('node:assert/strict'),s=require('node:child_process').spawn(process.execPath,['apps/ops/server.js'],{env:{...process.env,HOSTNAME:'127.0.0.1',PORT:'3000'},stdio:'ignore'});(async()=>{try{let live;for(let i=0;i<100;i++){try{live=await fetch('http://127.0.0.1:3000/health/live');if(live.status===200)break;}catch{}await new Promise(r=>setTimeout(r,200));}a.equal(live?.status,200);for(const [p,status] of ${JSON.stringify(expected)})a.equal((await fetch('http://127.0.0.1:3000'+p,{redirect:'manual'})).status,status);console.log('PASS health/access boundary');}finally{s.kill('SIGTERM');}})().catch(()=>{process.exitCode=1;});`;
        await writeFile(
          path('ops-http-smoke.log'),
          command(
            'docker',
            [
              'run',
              '--rm',
              '--network',
              'none',
              '--entrypoint',
              'node',
              inspected.Id,
              '-e',
              httpSmoke,
            ],
            { env: dockerEnv, timeout: 60000 },
          ),
          { mode: 0o600, flag: 'wx' },
        );
      }
      verified.push({
        image,
        repository: `flow-demo/${image}`,
        tag,
        revision,
        imageId: inspected.Id,
        architecture: 'amd64',
        os: 'linux',
        user: 'node',
        smokePassed: true,
        caHash,
      });
    }
    assertVerifiedImages(verified, revision, tag);
    await save('verified-builds.json', verified);
    verifySource();
    identity();
    repositories();
    check(
      isDeepStrictEqual(stateBefore, await stateSnapshot()),
      'Terraform state changed during builds',
    );
    await writeFile(
      claim,
      JSON.stringify({
        revision,
        tag,
        run: prefix,
        scope: publicationImages.map((n) => `flow-demo/${n}`),
        claimedAt: new Date().toISOString(),
        automaticRetry: false,
      }) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    publicationStarted = true;
    const token = aws('get-login-password', [], true) as string;
    command(
      'docker',
      ['login', '--username', 'AWS', '--password-stdin', registry],
      { env: dockerEnv, input: token },
    );
    for (const image of verified) {
      verifySource();
      identity();
      const target = `${registry}/${image.repository}:${tag}`;
      const local = JSON.parse(
        command('docker', ['image', 'inspect', target], { env: dockerEnv }),
      )[0];
      check(
        local.Id === image.imageId,
        'Verified local tag changed before push',
      );
      const existing = aws('describe-images', [
        '--registry-id',
        deployment.account,
        '--repository-name',
        image.repository,
        '--max-results',
        '100',
      ]);
      check(!existing.nextToken, 'Unbounded pre-push inventory');
      assertNoTagCollision(existing.imageDetails, tag);
      console.log(
        JSON.stringify({ stage: 'publish', image: image.image, tag }),
      );
      const r = spawnSync('docker', ['push', target], {
        env: dockerEnv,
        encoding: 'utf8',
        timeout: 900000,
        maxBuffer: 32 * 1024 * 1024,
      });
      await writeFile(
        path(`${image.image}-push.log`),
        (r.stdout ?? '') + (r.stderr ?? ''),
        { mode: 0o600, flag: 'wx' },
      );
      check(
        r.status === 0 && !r.error,
        `Push ${image.image} failed/uncertain; stop without retry/deletion`,
      );
      const described = aws('describe-images', [
        '--registry-id',
        deployment.account,
        '--repository-name',
        image.repository,
        '--image-ids',
        `imageTag=${tag}`,
      ]);
      check(
        described.imageDetails?.length === 1,
        'Published tag not uniquely verified',
      );
      const d = described.imageDetails[0];
      const batch = aws('batch-get-image', [
        '--registry-id',
        deployment.account,
        '--repository-name',
        image.repository,
        '--image-ids',
        `imageDigest=${d.imageDigest}`,
        '--accepted-media-types',
        'application/vnd.docker.distribution.manifest.v2+json',
        'application/vnd.oci.image.manifest.v1+json',
      ]);
      check(
        !batch.failures?.length && batch.images?.length === 1,
        'Published manifest unavailable',
      );
      const m = batch.images[0];
      check(
        m.registryId === deployment.account &&
          m.repositoryName === image.repository &&
          m.imageId.imageDigest === d.imageDigest &&
          d.registryId === deployment.account &&
          d.repositoryName === image.repository &&
          d.imageTags.includes(tag),
        'Published image scope/tag mismatch',
      );
      assertPublishedManifest(m.imageManifest, d.imageDigest, image.imageId);
      const manifest = JSON.parse(m.imageManifest);
      await save(`${image.image}-manifest.json`, manifest);
      published.push({
        ...image,
        digest: d.imageDigest,
        uri: `${registry}/${image.repository}@${d.imageDigest}`,
        imageSizeInBytes: d.imageSizeInBytes,
        verified: true,
      });
      await save(
        `${image.image}-published.json`,
        published[published.length - 1],
      );
    }
    check(
      isDeepStrictEqual(stateBefore, await stateSnapshot()),
      'Terraform state changed; stop',
    );
    const result = {
      account: deployment.account,
      profile: deployment.profile,
      region: deployment.region,
      role: deployment.role,
      revision,
      tag,
      run: prefix,
      published,
      stateUnchanged: true,
      calls,
      outcome:
        'PASS: exactly three verified image publications; no infrastructure/runtime mutation',
    };
    await save('publication-result.json', result);
    return result;
  } catch (error) {
    await save('publication-failure.json', {
      revision,
      tag,
      run: prefix,
      published,
      verifiedBuilds: verified,
      publicationStarted,
      calls,
      stateUnchanged: isDeepStrictEqual(stateBefore, await stateSnapshot()),
      outcome: 'STOP; no automatic retry/overwrite/deletion',
      error:
        error instanceof DeploymentSafetyError
          ? error.message
          : 'Unexpected failure; inspect private evidence',
    });
    throw error;
  } finally {
    await rm(dockerConfig, { recursive: true, force: true });
  }
}
async function main() {
  const args = process.argv.slice(2);
  const cycle =
    args.length === 3 && args[0] === '--cycle' && args[2] === '--cloud-approved'
      ? args[1]
      : undefined;
  check(
    !args.length || cycle !== undefined,
    'Use no arguments for historical D3A, or --cycle <uuid> --cloud-approved after separate publication approval; no target overrides',
  );
  console.log(
    JSON.stringify(
      await publishImages(resolve(__dirname, '..'), process.env, cycle),
      null,
      2,
    ),
  );
}
if (require.main === module) void main().catch(reportDeploymentFailure);
