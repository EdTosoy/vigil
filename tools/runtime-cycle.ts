/** Attended repeat cycles. Cloud effects are behind an explicit CLI gate and the injected driver. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deploymentContext, DeploymentSafetyError } from './deployment-context';
import { assertDeploymentEnvironment, deployment } from './deployment-guards';
import {
  assembleDeploymentSources,
  verifyDeploymentAssembly,
  type DeploymentAssembly,
} from './deployment-sources';
import { runtimeStateBackend } from './runtime-state-role';
import {
  claimRuntimeOperation,
  releaseProof as proof,
} from './runtime-apply-review';
import { reportDeploymentFailure } from './deployment-preflight';
import { sandboxKey } from '@vigil/stripe-integration';
import { hiddenInput } from './runtime-inputs';
import {
  cycleId,
  cycleUuid,
  cycleTarget,
  cycleCapabilities,
  cycleStages,
  cycleInstances,
  assertCycleStart,
  assertCycleState,
  assertCyclePlan,
  assertCycleBindings,
  assertCycleImages,
  type CycleStage,
  type CycleState,
  type CycleBindings,
  type CyclePlan,
} from './runtime-cycle-review';

export const cycleHash = (v: string | Uint8Array) =>
  createHash('sha256').update(v).digest('hex');
export interface CycleConfig {
  version: 1;
  id: string;
  target: typeof cycleTarget;
  bookId: string;
  values: Record<string, string>;
}
export interface CycleDriver {
  readiness(cleanup: boolean): Promise<void>;
  snapshot(): Promise<CycleState>;
  inventory(): Promise<string[]>;
  images(): Promise<Record<string, string>>;
  account(key: string): Promise<string>;
  terraform(
    assembly: DeploymentAssembly,
    args: string[],
    secrets: Record<string, string>,
  ): Promise<string>;
  dns(snapshot: CycleState): Promise<void>;
  destination(key: string, id: string): Promise<void>;
  registerDestination(key: string): Promise<{ id: string; secret: string }>;
  retireDestination(key: string, endpoint: string): Promise<void>;
  provision(
    snapshot: CycleState,
  ): Promise<{ taskArn: string; receipt: Record<string, unknown> }>;
  bindings(snapshot: CycleState, bindings: CycleBindings): Promise<void>;
  proof(snapshot: CycleState): Promise<void>;
  oneShots(snapshot: CycleState): Promise<string[]>;
  stopOneShots(snapshot: CycleState, tasks: string[]): Promise<void>;
}
type CycleReview = {
  version: 1;
  cycle: string;
  run: string;
  stage: CycleStage;
  createdAt: string;
  snapshot: CycleState;
  sourceHash: string;
  inputHash: string;
  executorHash: string;
  sha256: string;
  assembly: DeploymentAssembly;
  variables: Record<string, unknown>;
  oneShots: string[];
  secrets: never;
};
// No raw command output or secrets are returned by this module.
export async function privateCycleJson(path: string) {
  const s = await lstat(path);
  proof(
    s.isFile() &&
      !s.isSymbolicLink() &&
      s.nlink === 1 &&
      s.uid === process.getuid?.() &&
      (s.mode & 0o777) === 0o600,
    'Cycle files must be private, owned regular files',
  );
  return JSON.parse(await readFile(path, 'utf8'));
}
async function absent(path: string) {
  try {
    await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  throw new DeploymentSafetyError(
    'Existing cycle operation: retain history; no automatic retry',
  );
}
const save = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });

export function runtimeCycleStore(repository: string, id: string) {
  cycleId(id);
  const context = deploymentContext(repository, 'demo');
  const prefix = `cycles/${id}`;
  const path = (name: string) => context.path(`${prefix}/${name}`);
  async function load(): Promise<CycleConfig> {
    for (const directory of [
      resolve(context.base, '../..'),
      resolve(context.base, '..'),
      context.base,
      context.path('cycles'),
      context.path(prefix),
    ]) {
      const info = await lstat(directory);
      proof(
        info.isDirectory() &&
          info.uid === process.getuid?.() &&
          (info.mode & 0o777) === 0o700,
        'Cycle directories must remain private and owned',
      );
    }
    const c = (await privateCycleJson(path('inputs.json'))) as CycleConfig;
    proof(
      c.version === 1 &&
        c.id === id &&
        isDeepStrictEqual(c.target, cycleTarget) &&
        cycleUuid(c.bookId) &&
        c.values &&
        Object.values(c.values).every((v) => typeof v === 'string'),
      'Foreign or invalid cycle inputs',
    );
    proof(
      Object.keys(c.values).every((k) =>
        [
          'admin_password',
          'seed_password',
          'auth_secret',
          'demo_username',
          'demo_password',
          'admin_email',
          'stripe_key',
          'webhook_secrets',
          'webhook_endpoint',
          ...cycleCapabilities.map((k) => k.toLowerCase() + '_password'),
        ].includes(k),
      ),
      'Unknown cycle input',
    );
    for (const key of [
      'admin_password',
      'seed_password',
      'auth_secret',
      ...cycleCapabilities.map((k) => k.toLowerCase() + '_password'),
    ])
      proof(
        /^[A-Za-z0-9_-]{40,100}$/.test(c.values[key] ?? ''),
        'Fresh scoped passwords required',
      );
    return c;
  }
  return {
    context,
    path,
    load,
    async prepare() {
      await mkdir(context.base, { recursive: true, mode: 0o700 });
      for (const dir of [
        resolve(context.base, '../..'),
        resolve(context.base, '..'),
        context.base,
      ]) {
        const s = await lstat(dir);
        proof(
          s.uid === process.getuid?.() && (s.mode & 0o777) === 0o700,
          'Private owned cycle namespace required',
        );
      }
      await mkdir(context.path('cycles'), { recursive: true, mode: 0o700 });
      const cyclesInfo = await lstat(context.path('cycles'));
      proof(
        cyclesInfo.uid === process.getuid?.() &&
          (cyclesInfo.mode & 0o777) === 0o700,
        'Cycle namespace must remain private and owned',
      );
      await mkdir(context.path(prefix), { mode: 0o700 });
      const strong = () => randomBytes(36).toString('base64url');
      const values = Object.fromEntries(
        [
          'admin_password',
          'seed_password',
          'auth_secret',
          ...cycleCapabilities.map((k) => k.toLowerCase() + '_password'),
        ].map((k) => [k, strong()]),
      );
      await save(path('inputs.json'), {
        version: 1,
        id,
        target: cycleTarget,
        bookId: randomUUID(),
        values,
      });
      return {
        cycle: id,
        prepared: true,
        bindings: 'ABSENT',
        credentials: 'GENERATED_PRIVATELY',
        cloudOperations: 0,
      };
    },
    async set(key: string, value: string) {
      proof(
        [
          'admin_email',
          'stripe_key',
          'webhook_secrets',
          'webhook_endpoint',
        ].includes(key),
        'Only approved hidden cycle inputs may be set',
      );
      const c = await load();
      if (key === 'admin_email')
        proof(
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254,
          'Valid administrator email required',
        );
      if (key === 'stripe_key') {
        sandboxKey(value);
        proof(
          /^(sk|rk)_test_[A-Za-z0-9_]{16,}$/.test(value),
          'Sandbox key required',
        );
      }
      if (key === 'webhook_secrets')
        proof(
          /^whsec_[A-Za-z0-9]{16,}$/.test(value),
          'Dedicated sandbox signing secret required',
        );
      if (key === 'webhook_endpoint')
        proof(
          /^we_[A-Za-z0-9]+$/.test(value),
          'Actual dedicated sandbox endpoint required',
        );
      // Secrets are mutable only before their first use; new reviews bind all bytes.
      if (!key.startsWith('webhook_')) await absent(path('anchor.json'));
      else await absent(path('active-attempt.json'));
      const temporary = path(`inputs-${randomUUID()}.tmp`);
      await save(temporary, { ...c, values: { ...c.values, [key]: value } });
      await rename(temporary, path('inputs.json'));
      return { cycle: id, storedKey: key, valuesPrinted: false };
    },
  };
}

async function executorHash(repository: string) {
  const files = (await readdir(resolve(repository, 'tools')))
    .filter((n) =>
      /^(runtime-|deployment-|publish-images|cloud-provision|build-containers)/.test(
        n,
      ),
    )
    .sort();
  const h = createHash('sha256');
  for (const name of files)
    h.update(name).update(await readFile(resolve(repository, 'tools', name)));
  return h.digest('hex');
}
function stageVariables(
  stage: CycleStage,
  images: Record<string, string>,
  account: string,
  b?: CycleBindings,
) {
  return {
    aws_account_id: deployment.account,
    aws_profile: deployment.profile,
    aws_region: deployment.region,
    hostname: deployment.domain,
    images,
    stripe_account_id: account,
    secrets_version: 1,
    initial_infrastructure_only: stage === 'infrastructure',
    defer_webhook_secret: stage !== 'active',
    start_services: stage === 'active',
    certificate_dns_confirmed: ['https', 'active'].includes(stage),
    stripe_source_id: b?.sourceAccountId ?? '',
    ops_book_id: b?.syntheticBookId ?? '',
  };
}
function stageSecrets(c: CycleConfig, account: string, stage: CycleStage) {
  if (stage === 'infrastructure')
    return { admin_password: c.values['admin_password']! };
  proof(
    c.values['admin_email'] && c.values['stripe_key'],
    'Configure private administrator and sandbox inputs before provisioning',
  );
  const passwords = Object.fromEntries(
    cycleCapabilities.map((k) => [k, c.values[k.toLowerCase() + '_password']]),
  );
  const values: Record<string, string> = {
    ...c.values,
    provisioning: JSON.stringify({
      bookId: c.bookId,
      accountId: account,
      passwords,
    }),
  };
  delete values['webhook_endpoint'];
  return values;
}
export async function runtimeCycle(
  repository: string,
  id: string,
  driver: CycleDriver,
) {
  const store = runtimeCycleStore(repository, id),
    { context, path } = store;
  const config = await store.load();
  const readAnchor = () =>
    privateCycleJson(path('anchor.json')) as Promise<{
      snapshot: CycleState;
      images: Record<string, string>;
      account: string;
      startedAt: string;
    }>;
  async function sameCycle(snapshot: CycleState) {
    const anchor = await readAnchor();
    cycleInstances(snapshot);
    proof(
      anchor.snapshot.state.lineage === snapshot.state.lineage &&
        snapshot.state.serial >= anchor.snapshot.state.serial,
      'Cycle state lineage or serial changed',
    );
    return anchor;
  }
  async function currentBindings(snapshot: CycleState) {
    const evidence = (await privateCycleJson(path('provisioned.json'))) as {
      snapshot: CycleState;
      bindings: CycleBindings;
    };
    const anchor = await sameCycle(snapshot);
    assertCycleBindings(
      evidence.bindings,
      evidence.snapshot,
      config.bookId,
      anchor.account,
    );
    const db = (s: CycleState) =>
      cycleInstances(s).find((r) => r.address === 'aws_db_instance.demo')
        ?.attributes;
    proof(
      db(snapshot)?.['id'] === db(evidence.snapshot)?.['id'] &&
        db(snapshot)?.['resource_id'] ===
          evidence.bindings.databaseResourceId &&
        db(snapshot)?.['address'] === evidence.bindings.databaseAddress,
      'Database was replaced after provisioning',
    );
    await driver.bindings(snapshot, evidence.bindings);
    return evidence.bindings;
  }
  async function completed(stage: CycleStage) {
    const r = await privateCycleJson(path(`${stage}-result.json`));
    proof(
      r.status === 'SUCCEEDED',
      'Previous stage did not complete; obtain recovery review',
    );
  }
  async function destinationEvidence() {
    const evidence = await privateCycleJson(path('destination.json'));
    const anchor = await readAnchor();
    proof(
      evidence.cycle === id &&
        evidence.accountId === anchor.account &&
        evidence.endpointId === config.values['webhook_endpoint'] &&
        evidence.secretHash ===
          cycleHash(config.values['webhook_secrets'] ?? ''),
      'Signing secret must come from this cycle dedicated destination registration; manual syntax or historical values are insufficient',
    );
    await absent(path('destination-retired.json'));
    await driver.destination(
      sandboxKey(config.values['stripe_key']),
      evidence.endpointId,
    );
    return evidence;
  }
  async function secureAssembly(review: CycleReview) {
    const a = review.assembly;
    proof(
      a.prefix === `plan-preparation/${review.run}` &&
        a.mode === 'runtime-plan-preparation' &&
        a.work === context.path(`${a.prefix}/work`) &&
        a.data === context.path(`${a.prefix}/terraform-data`) &&
        a.manifest === context.path(`${a.prefix}/source-manifest.json`),
      'Foreign cycle work paths',
    );
    // Reconstruct the context: functions are intentionally not serialized into receipts.
    a.context = context;
    await verifyDeploymentAssembly(a);
    proof(
      cycleHash(JSON.stringify(a.receipt.files)) === review.sourceHash &&
        review.executorHash === (await executorHash(repository)),
      'Source or executor changed since review',
    );
    const backend = await privateCycleJson(
      context.path(`${a.prefix}/backend.json`),
    );
    proof(
      isDeepStrictEqual(backend, runtimeStateBackend(review.run)),
      'Only unchanged State-role backend is executable',
    );
    proof(
      (await readFile(context.path(`${a.prefix}/terraform.rc`), 'utf8')) ===
        'provider_installation {\n direct {}\n}\n',
      'Terraform CLI configuration changed',
    );
    proof(
      isDeepStrictEqual(
        await privateCycleJson(context.path(`${a.prefix}/variables.json`)),
        review.variables,
      ),
      'Stage variables changed',
    );
    return a;
  }
  return {
    async plan(stage: CycleStage) {
      proof(cycleStages.includes(stage), 'Unknown cycle stage');
      const cleanup = stage === 'teardown';
      await driver.readiness(cleanup);
      const snapshot = await driver.snapshot();
      let anchor: Awaited<ReturnType<typeof readAnchor>>;
      if (stage === 'infrastructure') {
        proof(
          config.values['admin_email'] &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.values['admin_email']),
          'Configure the private administrator email before initial resource planning',
        );
        assertCycleStart(snapshot, await driver.inventory());
        const images = await driver.images();
        assertCycleImages(images);
        const account = await driver.account(
          sandboxKey(config.values['stripe_key']),
        );
        proof(
          /^acct_[A-Za-z0-9]+$/.test(account),
          'Verified sandbox account required',
        );
        // An exclusive permanent claim binds an empty state version to one cycle.
        await mkdir(context.path('cycle-claims'), {
          recursive: true,
          mode: 0o700,
        });
        try {
          anchor = await readAnchor();
          assertCycleState(anchor.snapshot, snapshot);
          proof(
            isDeepStrictEqual(images, anchor.images) &&
              account === anchor.account,
            'Initial cycle intent changed',
          );
          await absent(path('infrastructure-attempt.json'));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          anchor = {
            snapshot,
            images,
            account,
            startedAt: new Date().toISOString(),
          };
          await claimRuntimeOperation(
            context.path(
              `cycle-claims/${cycleHash(JSON.stringify(snapshot))}.json`,
            ),
            { cycle: id },
            () => save(path('anchor.json'), anchor),
          );
        }
      } else {
        anchor = await sameCycle(snapshot);
        if (!cleanup) {
          const predecessor =
            stage === 'provisioning'
              ? 'infrastructure'
              : stage === 'https'
                ? 'provisioning'
                : 'https';
          await completed(predecessor);
          await absent(path(`${stage}-attempt.json`));
          proof(
            Date.now() - Date.parse(anchor.startedAt) < 3 * 3600000,
            'New resource work stopped at T+3h; prepare cleanup',
          );
          proof(
            isDeepStrictEqual(await driver.images(), anchor.images),
            'Image publication changed',
          );
        }
      }
      let b: CycleBindings | undefined;
      if (['https', 'active'].includes(stage)) {
        b = await currentBindings(snapshot);
        await driver.dns(snapshot);
      }
      if (stage === 'active') {
        proof(
          config.values['webhook_endpoint'] && config.values['webhook_secrets'],
          'Register the actual dedicated sandbox destination and privately supply its signing secret before activation',
        );
        await destinationEvidence();
      }
      if (!cleanup)
        proof(
          Date.now() - Date.parse(anchor.startedAt) < 3 * 3600000,
          'Resource work window expired; prepare cleanup',
        );
      const oneShots = cleanup ? await driver.oneShots(snapshot) : [];
      // Teardown uses the last exact variables and all same-cycle secrets, including
      // the active signing secret. Never roll flags backward to remove secrets.
      const last = cleanup
        ? await privateCycleJson(path('last-applied.json'))
        : null;
      const variables: Record<string, unknown> = last
        ? last.variables
        : stageVariables(stage, anchor.images, anchor.account, b);
      const secrets = stageSecrets(
        config,
        anchor.account,
        last ? last.stage : stage,
      );
      const a = await assembleDeploymentSources(
        repository,
        'demo',
        randomUUID(),
        'runtime-plan-preparation',
      );
      const run = a.prefix.split('/')[1]!;
      await save(
        context.path(`${a.prefix}/backend.json`),
        runtimeStateBackend(run),
      );
      await save(context.path(`${a.prefix}/variables.json`), variables);
      await writeFile(
        context.path(`${a.prefix}/terraform.rc`),
        'provider_installation {\n direct {}\n}\n',
        { mode: 0o600, flag: 'wx' },
      );
      await verifyDeploymentAssembly(a);
      await driver.terraform(
        a,
        [
          'init',
          '-reconfigure',
          '-input=false',
          '-lockfile=readonly',
          `-backend-config=${context.path(`${a.prefix}/backend.json`)}`,
        ],
        secrets,
      );
      await driver.terraform(a, ['validate', '-no-color'], secrets);
      assertCycleState(snapshot, await driver.snapshot());
      const plan = context.path(`${a.prefix}/cycle.tfplan`);
      await claimRuntimeOperation(
        context.path(`${a.prefix}/plan-attempt.json`),
        { cycle: id, stage, snapshot },
        () =>
          driver.terraform(
            a,
            [
              'plan',
              ...(cleanup ? ['-destroy'] : []),
              '-input=false',
              '-no-color',
              '-lock-timeout=30s',
              `-var-file=${context.path(`${a.prefix}/variables.json`)}`,
              `-out=${plan}`,
            ],
            secrets,
          ),
      );
      const parsed = JSON.parse(
        await driver.terraform(a, ['show', '-json', plan], {}),
      ) as CyclePlan;
      const summary = assertCyclePlan(parsed, snapshot, stage);
      assertCycleState(snapshot, await driver.snapshot());
      const review = {
        version: 1 as const,
        cycle: id,
        run,
        stage,
        createdAt: new Date().toISOString(),
        snapshot,
        sourceHash: cycleHash(JSON.stringify(a.receipt.files)),
        inputHash: cycleHash(JSON.stringify(config)),
        executorHash: await executorHash(repository),
        sha256: cycleHash(await readFile(plan)),
        assembly: a,
        variables,
        oneShots,
      };
      await save(context.path(`${a.prefix}/cycle-review.json`), review);
      // Track planning inputs even if apply fails partially: exact teardown inputs survive.
      await save(path(`review-${run}.json`), { run, stage });
      return {
        cycle: id,
        stage,
        reviewId: `${run}:${review.sha256}`,
        ...summary,
        oneShotStops: oneShots.length,
        executionAuthorized: false,
      };
    },
    async apply(reviewId: string) {
      const m = /^([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(reviewId);
      proof(m && cycleUuid(m[1]), 'Exact cycle saved-plan review ID required');
      const review = (await privateCycleJson(
        context.path(`plan-preparation/${m[1]}/cycle-review.json`),
      )) as CycleReview;
      const age = Date.now() - Date.parse(review.createdAt);
      proof(
        review.version === 1 &&
          review.cycle === id &&
          review.run === m[1] &&
          review.sha256 === m[2] &&
          cycleStages.includes(review.stage) &&
          Number.isFinite(age) &&
          age >= 0 &&
          age <= 900000,
        'Foreign, modified or expired cycle review',
      );
      proof(
        cycleHash(JSON.stringify(config)) === review.inputHash,
        'Cycle inputs changed since review',
      );
      const a = await secureAssembly(review);
      const plan = context.path(`${a.prefix}/cycle.tfplan`);
      proof(
        cycleHash(await readFile(plan)) === review.sha256,
        'Saved plan changed',
      );
      const anchor = await sameCycle(review.snapshot);
      if (review.stage !== 'teardown')
        proof(
          Date.now() - Date.parse(anchor.startedAt) < 3 * 3600000,
          'Resource work window expired; prepare cleanup',
        );
      const last =
        review.stage === 'teardown'
          ? await privateCycleJson(path('last-applied.json'))
          : null;
      const secrets = stageSecrets(
        config,
        anchor.account,
        last ? last.stage : review.stage,
      );
      assertCyclePlan(
        JSON.parse(await driver.terraform(a, ['show', '-json', plan], {})),
        review.snapshot,
        review.stage,
      );
      await driver.readiness(review.stage === 'teardown');
      assertCycleState(review.snapshot, await driver.snapshot());
      if (review.stage === 'infrastructure')
        assertCycleStart(review.snapshot, await driver.inventory());
      if (['https', 'active'].includes(review.stage)) {
        await currentBindings(review.snapshot);
        await driver.dns(review.snapshot);
      }
      if (review.stage === 'active') await destinationEvidence();
      const attempt = path(
        review.stage === 'teardown'
          ? `teardown-attempt-${review.run}.json`
          : `${review.stage}-attempt.json`,
      );
      await absent(attempt);
      const history = path(`applied-inputs-${review.run}.json`);
      await save(history, { variables: review.variables, stage: review.stage });
      // Global state-version claim prevents competing plans in this or another cycle
      // from both applying. Terraform's native lock remains the concurrency barrier.
      await mkdir(context.path('operation-claims'), {
        recursive: true,
        mode: 0o700,
      });
      const claim = context.path(
        `operation-claims/${cycleHash(JSON.stringify(review.snapshot))}${review.stage === 'teardown' ? '-' + review.run : ''}.json`,
      );
      await claimRuntimeOperation(claim, { cycle: id, reviewId }, async () => {
        await claimRuntimeOperation(
          attempt,
          { reviewId, startedAt: new Date().toISOString() },
          async () => {
            const temporary = path(`last-applied-${randomUUID()}.tmp`);
            await save(temporary, {
              variables: review.variables,
              stage: last ? last.stage : review.stage,
            });
            await rename(temporary, path('last-applied.json'));
            try {
              if (review.stage === 'teardown')
                await driver.stopOneShots(review.snapshot, review.oneShots);
              await driver.terraform(
                a,
                ['apply', '-input=false', '-no-color', plan],
                secrets,
              );
              const after = await driver.snapshot();
              await sameCycle(after);
              proof(
                after.versionId !== review.snapshot.versionId &&
                  after.state.serial > review.snapshot.state.serial,
                'Apply needs a new durable state version',
              );
              if (review.stage === 'teardown')
                assertCycleStart(after, await driver.inventory());
              await save(
                path(
                  review.stage === 'teardown'
                    ? `teardown-result-${review.run}.json`
                    : `${review.stage}-result.json`,
                ),
                {
                  status: 'SUCCEEDED',
                  reviewId,
                  snapshot: after,
                  variables: review.variables,
                },
              );
            } catch {
              await save(
                path(
                  review.stage === 'teardown'
                    ? `teardown-result-${review.run}.json`
                    : `${review.stage}-result.json`,
                ),
                {
                  status: 'FAILED_OR_UNKNOWN',
                  reviewId,
                  automaticRetry: false,
                },
              );
              throw new DeploymentSafetyError(
                'Cycle operation failed or outcome unknown; retain state/claims and review current-inventory cleanup; never retry automatically',
              );
            }
          },
        );
      });
      return {
        cycle: id,
        stage: review.stage,
        status: 'SUCCEEDED',
        financialAssurance: 'NOT_ESTABLISHED',
      };
    },
    async provision() {
      await completed('provisioning');
      await absent(path('provision-attempt.json'));
      await driver.readiness(false);
      const snapshot = await driver.snapshot(),
        anchor = await sameCycle(snapshot);
      proof(
        Date.now() - Date.parse(anchor.startedAt) < 3 * 3600000,
        'Destination work window expired; prepare cleanup',
      );
      proof(
        Date.now() - Date.parse(anchor.startedAt) < 3 * 3600000,
        'Provisioning window expired; prepare cleanup',
      );
      const result = await claimRuntimeOperation(
        path('provision-attempt.json'),
        { snapshot },
        () => driver.provision(snapshot),
      );
      assertCycleState(snapshot, await driver.snapshot());
      const r = result.receipt;
      const db = cycleInstances(snapshot).find(
        (r) => r.address === 'aws_db_instance.demo',
      )!.attributes;
      const task = cycleInstances(snapshot).find(
        (r) => r.address === 'aws_ecs_task_definition.app["admin"]',
      )!.attributes;
      const bindings: CycleBindings = {
        state: {
          versionId: snapshot.versionId,
          etag: snapshot.etag,
          sha256: snapshot.sha256,
        },
        databaseId: String(db['id']),
        databaseResourceId: String(db['resource_id']),
        databaseAddress: String(db['address']),
        taskArn: result.taskArn,
        taskDefinition: String(task['arn']),
        stripeBookId: String(r['stripeBookId']),
        sourceAccountId: String(r['sourceAccountId']),
        syntheticBookId: String(r['syntheticBookId']),
        accountId: anchor.account,
        applicationAuth: r['applicationAuth'] as 'PASS',
      };
      proof(
        r['operation'] === 'cloud-provision' &&
          r['outcome'] === 'PASS' &&
          r['permissions'] === 'PASS',
        'One-shot provisioning receipt missing',
      );
      assertCycleBindings(bindings, snapshot, config.bookId, anchor.account);
      await driver.bindings(snapshot, bindings);
      await save(path('provisioned.json'), { snapshot, bindings });
      return {
        cycle: id,
        provisioned: true,
        applicationAuth: 'PASS',
        bindings: 'CURRENT_DATABASE_VERIFIED',
      };
    },
    async verify() {
      await completed('active');
      await driver.readiness(true);
      const snapshot = await driver.snapshot();
      await sameCycle(snapshot);
      await currentBindings(snapshot);
      await driver.dns(snapshot);
      await driver.proof(snapshot);
      assertCycleState(snapshot, await driver.snapshot());
      await save(path(`proof-${randomUUID()}.json`), {
        snapshot,
        observedAt: new Date().toISOString(),
        technicalReadiness: 'PASS',
        financialAssurance: 'NOT_ESTABLISHED',
      });
      return {
        cycle: id,
        technicalReadiness: 'PASS',
        financialAssurance: 'NOT_ESTABLISHED',
      };
    },
    async destination() {
      await completed('https');
      await absent(path('destination-attempt.json'));
      await driver.readiness(false);
      const snapshot = await driver.snapshot(),
        anchor = await sameCycle(snapshot);
      await currentBindings(snapshot);
      await driver.dns(snapshot);
      const result = await claimRuntimeOperation(
        path('destination-attempt.json'),
        { cycle: id, snapshot },
        () =>
          driver.registerDestination(sandboxKey(config.values['stripe_key'])),
      );
      await store.set('webhook_endpoint', result.id);
      await store.set('webhook_secrets', result.secret);
      await save(path('destination.json'), {
        cycle: id,
        accountId: anchor.account,
        endpointId: result.id,
        secretHash: cycleHash(result.secret),
      });
      return {
        cycle: id,
        dedicatedSandboxDestination: 'REGISTERED',
        secret: 'RETAINED_PRIVATELY',
      };
    },
    async retireDestination() {
      await absent(path('destination-retirement-attempt.json'));
      const evidence = await destinationEvidence();
      await driver.readiness(true);
      const snapshot = await driver.snapshot();
      await sameCycle(snapshot);
      assertCycleStart(snapshot, await driver.inventory());
      await claimRuntimeOperation(
        path('destination-retirement-attempt.json'),
        { cycle: id, endpointId: evidence.endpointId },
        () =>
          driver.retireDestination(
            sandboxKey(config.values['stripe_key']),
            evidence.endpointId,
          ),
      );
      await save(path('destination-retired.json'), {
        cycle: id,
        endpointId: evidence.endpointId,
        retiredAt: new Date().toISOString(),
      });
      return {
        cycle: id,
        dedicatedSandboxDestination: 'RETIRED',
        financialObjects: 'RETAINED',
      };
    },
    async verifyTeardown() {
      proof(
        (await readdir(context.path(`cycles/${id}`))).some((n) =>
          /^teardown-attempt-[a-f0-9-]{36}\.json$/.test(n),
        ),
        'Teardown attempt required before removal verification',
      );
      await driver.readiness(true);
      const snapshot = await driver.snapshot();
      await sameCycle(snapshot);
      assertCycleStart(snapshot, await driver.inventory());
      await save(path(`removal-proof-${randomUUID()}.json`), {
        snapshot,
        observedAt: new Date().toISOString(),
        stateRetained: true,
        actualRuntimeInventory: 'ABSENT',
      });
      return {
        cycle: id,
        actualRuntimeInventory: 'ABSENT',
        stateRetained: true,
      };
    },
  };
}

export function runtimeCycleCommand(args: string[]) {
  if (args.length === 1 && args[0] === 'prepare')
    return { operation: 'prepare' as const };
  if (
    args.length === 5 &&
    args[0] === 'operator-checks' &&
    args[2] === '--budget-alert-delivery-confirmed' &&
    args[3] === '--account-spend-reviewed' &&
    args[4] === '--cleanup-window-confirmed'
  ) {
    cycleId(args[1]!);
    return { operation: 'operator-checks' as const, id: args[1]! };
  }
  if (args[0] === 'set' && args.length === 3) {
    cycleId(args[1]!);
    proof(
      [
        'admin_email',
        'stripe_key',
        'webhook_secrets',
        'webhook_endpoint',
      ].includes(args[2]!),
      'Approved private input required',
    );
    return { operation: 'set' as const, id: args[1]!, key: args[2]! };
  }
  // No cloud capability is reached by default, including plan's lock writes.
  proof(
    args.at(-1) === '--cloud-approved',
    'Cloud commands require separate explicit authorization and --cloud-approved; local preparation is available',
  );
  cycleId(args[1]!);
  if (
    args[0] === 'plan' &&
    args.length === 4 &&
    cycleStages.includes(args[2] as CycleStage)
  )
    return {
      operation: 'plan' as const,
      id: args[1]!,
      stage: args[2] as CycleStage,
    };
  if (
    args[0] === 'apply' &&
    args.length === 5 &&
    args[2] === '--reviewed' &&
    /^[a-f0-9-]{36}:[a-f0-9]{64}$/.test(args[3]!)
  )
    return { operation: 'apply' as const, id: args[1]!, review: args[3]! };
  if (
    [
      'provision',
      'verify',
      'verify-teardown',
      'destination',
      'retire-destination',
    ].includes(args[0] ?? '') &&
    args.length === 3
  )
    return {
      operation: args[0] as
        | 'provision'
        | 'verify'
        | 'verify-teardown'
        | 'destination'
        | 'retire-destination',
      id: args[1]!,
    };
  throw new DeploymentSafetyError(
    'Use prepare, set <cycle> <key>, plan <cycle> <stage>, apply <cycle> --reviewed <run:sha256>, provision <cycle> or verify <cycle>; cloud commands also require --cloud-approved',
  );
}
async function main() {
  const command = runtimeCycleCommand(process.argv.slice(2));
  assertDeploymentEnvironment(process.env);
  process.umask(0o077);
  const repository = resolve(__dirname, '..');
  if (command.operation === 'prepare')
    return runtimeCycleStore(repository, randomUUID()).prepare();
  if (command.operation === 'set')
    return runtimeCycleStore(repository, command.id).set(
      command.key,
      await hiddenInput(),
    );
  if (command.operation === 'operator-checks') {
    const store = runtimeCycleStore(repository, command.id);
    await store.load();
    const temporary = store.path(`operator-checks-${randomUUID()}.tmp`);
    await save(temporary, {
      cycle: command.id,
      observedAt: new Date().toISOString(),
      budgetAlertDeliveryConfirmed: true,
      accountWideSpendReviewed: true,
      fourHourCleanupWindowConfirmed: true,
    });
    await rename(temporary, store.path('operator-checks.json'));
    return {
      cycle: command.id,
      operatorAssertionsRecorded: true,
      cloudAuthorization: 'NOT_GRANTED',
    };
  }
  const { runtimeCycleDriver } = await import('./runtime-cycle-aws.js');
  const driver = await runtimeCycleDriver(repository, command.id, process.env);
  const cycle = await runtimeCycle(repository, command.id, driver);
  if (command.operation === 'plan') return cycle.plan(command.stage);
  if (command.operation === 'apply') return cycle.apply(command.review);
  if (command.operation === 'verify-teardown') return cycle.verifyTeardown();
  if (command.operation === 'retire-destination')
    return cycle.retireDestination();
  return cycle[command.operation]();
}
if (require.main === module)
  void main()
    .then((v) => console.log(JSON.stringify(v, null, 2)))
    .catch(reportDeploymentFailure);
