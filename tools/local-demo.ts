/** Offline provisioner and lifecycle owner. Never imported by a runtime app. */
import assert from 'node:assert/strict';
import { PostgresOperations } from '@vigil/operations-read-postgres';
import { PostgresProcessor } from '@vigil/processor-postgres';
import { PostgresWorker } from '@vigil/worker-postgres';
import { object, rows } from '../apps/ops/components/model';
import type { InvestigationEvidence } from '../apps/ops/server/investigation-guide';
import { PostgresIngestion } from '@vigil/ingestion-postgres';
import { PostgresReconciliation } from '@vigil/reconciliation-postgres';
import { simulatorBatch } from './ingestion-input';
import { simulatorBankBatch } from './bank-input';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  mkdtemp,
  chmod,
  cp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import type { SystemInput } from '@vigil/simulator';
import { migrate } from './migrations';
import { seedDemo, type DemoPools } from './ops-demo-seed';
import { seedAccount } from '../apps/ops/server/seed-account';
import { authPool } from '../apps/ops/server/auth-service';
import { visitor } from '../apps/ops/visitor';
import {
  demoArguments,
  demoEnvironment,
  demoContainerName,
  LOCAL_DEMO_HELP,
  LOCAL_DEMO_IMAGE,
  LOCAL_DOCKER,
} from './local-demo-config';

const exec = promisify(execFile);
async function reservePort() {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Local port unavailable');
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}
export async function localDemo(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) {
  const options = demoArguments(args);
  if (options.help) {
    console.log(LOCAL_DEMO_HELP);
    return;
  }
  const clean = demoEnvironment(env);
  const root = resolve(__dirname, '..');
  const standalone = join(root, 'apps/ops/.next/standalone');
  await stat(join(standalone, 'apps/ops/server.js')).catch(() => {
    throw new Error('Production build missing; run pnpm build first');
  });
  const docker = (...args: string[]) =>
    exec('docker', [...LOCAL_DOCKER, ...args], {
      env: clean,
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
  await docker('image', 'inspect', LOCAL_DEMO_IMAGE).catch(() => {
    throw new Error(
      'Local Docker or the pinned PostgreSQL test image is unavailable; see docs/local-demo.md',
    );
  });
  const container = demoContainerName(randomUUID());
  const dir = await mkdtemp(join(tmpdir(), 'vigil-local-demo-'));
  await chmod(dir, 0o700);
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  let started = false;
  let app: ChildProcess | undefined;
  const pools: Pool[] = [];
  try {
    const databasePort = await reservePort(),
      appPort = await reservePort();
    if (stop.signal.aborted) return;
    console.log('Preparing a new isolated synthetic investigation demo...');
    await docker(
      'run',
      '--detach',
      '--rm',
      '--pull=never',
      '--name',
      container,
      '--label',
      'vigil.local-demo=' + container,
      '--publish',
      `127.0.0.1:${databasePort}:5432`,
      '--env',
      'POSTGRES_USER=flow_local_demo_admin',
      '--env',
      'POSTGRES_DB=flow_local_demo',
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      LOCAL_DEMO_IMAGE,
      '-c',
      'fsync=on',
      '-c',
      'synchronous_commit=on',
    );
    started = true;
    const url = (role: string) =>
      `postgresql://${role}@127.0.0.1:${databasePort}/flow_local_demo`;
    const admin = new Pool({
      connectionString: url('flow_local_demo_admin'),
      connectionTimeoutMillis: 1000,
    });
    pools.push(admin);
    let available = false;
    for (let i = 0; i < 100 && !stop.signal.aborted; i++) {
      try {
        await admin.query('SELECT 1');
        available = true;
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    if (!available) throw new Error('Disposable database was not ready');
    await migrate(admin);
    const capabilities = {
      ingestion: 'flow_ingestion_writer',
      processor: 'flow_processor_writer',
      bank: 'flow_bank_writer',
      reconciliation: 'flow_reconciliation_writer',
      exceptions: 'flow_exception_writer',
      controls: 'flow_control_writer',
      worker: 'flow_worker',
      integrity: 'flow_integrity_reader',
      operations: 'flow_operations_reader',
      auth: 'flow_auth_runtime',
      seed: 'flow_auth_seeder',
    };
    const scoped: Record<string, Pool> = { admin };
    for (const [name, role] of Object.entries(capabilities)) {
      const login = 'flow_local_demo_' + name;
      await admin.query(
        `CREATE ROLE ${login} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS IN ROLE ${role}`,
      );
      const pool = ['auth', 'seed'].includes(name)
        ? authPool(url(login))
        : new Pool({
            connectionString: url(login),
            connectionTimeoutMillis: 1000,
          });
      scoped[name] = pool;
      pools.push(pool);
    }
    const inputDirectory = join(dir, 'public-input');
    const scenarioPath = join(dir, 'scenario.json');
    await writeFile(
      scenarioPath,
      JSON.stringify({
        seed: 71201,
        paymentCount: 12,
        batchSizeRange: [1, 1],
        anomalies: { 'missing-bank-transaction': { count: 1 } },
      }),
      { mode: 0o600 },
    );
    await exec(
      process.execPath,
      [
        '--import',
        'tsx',
        join(root, 'tools/simulator.ts'),
        'generate',
        '--config',
        scenarioPath,
        '--out',
        inputDirectory,
      ],
      {
        cwd: root,
        env: clean,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    );
    const input = JSON.parse(
      await readFile(join(inputDirectory, 'input.json'), 'utf8'),
    ) as SystemInput;
    const summary = await seedDemo(
      scoped as unknown as DemoPools,
      [input],
      'local-reviewer-demo-v1',
    );
    const recon = new PostgresReconciliation(scoped['reconciliation']!);
    const initial = await recon.summary(summary.reconciliationRunIds[0]!);
    assert.equal(initial.matchedGroups, 11);
    assert.deepEqual(initial.current, [{ status: 'ACTIVE', count: 11 }]);
    assert(
      initial.outcomes.some(
        (x) =>
          x.side === 'PROCESSOR' && x.outcome === 'UNMATCHED' && x.count === 1,
      ),
      'Missing bank evidence must remain unresolved',
    );
    assert.equal(initial.sourceCoverage, 'UNKNOWN');
    const ingestion = new PostgresIngestion(scoped['ingestion']!);
    const sources = (
      await admin.query<{ id: string; external_account_id: string }>(
        'SELECT id,external_account_id FROM ingestion.source_account WHERE book_id=$1',
        [summary.bookId],
      )
    ).rows;
    const processorSource = sources.find(
      (x) => x.external_account_id === input.scope.processorAccountId,
    )!.id;
    const bankSource = sources.find(
      (x) => x.external_account_id === input.scope.bankAccountId,
    )!.id;
    const counts = async () =>
      (
        await admin.query(
          `SELECT (SELECT count(*)::text FROM ingestion.source_fact WHERE source_account_id=$1) facts,
       (SELECT count(*)::text FROM ingestion.revision WHERE source_account_id=$1) revisions,
       (SELECT count(*)::text FROM processor.activity WHERE source_account_id=$1) activities,
       (SELECT count(*)::text FROM ledger.ledger_transaction WHERE book_id=$2) journals`,
          [processorSource, summary.bookId],
        )
      ).rows[0];
    const before = await counts();
    assert.equal(before.journals, '0');
    const replay = await ingestion.ingest(
      simulatorBatch(input, processorSource, 'local-demo-duplicate'),
    );
    assert.equal(
      replay.replayed,
      false,
      'Replay must create a distinct delivery batch',
    );
    await new PostgresWorker(scoped['worker']!).processBatch(
      'local-demo-replay',
      10000,
      summary.bookId,
    );
    const replaySummary = await ingestion.summary(replay.id);
    assert(replaySummary.received > 0);
    assert.equal(replaySummary.normalized, replaySummary.received);
    await new PostgresProcessor(scoped['processor']!).deriveBatch(
      replay.id,
      'synthetic-movement-v1',
    );
    assert.deepEqual(
      await counts(),
      before,
      'Duplicate delivery must retain economic and accounting identities',
    );
    const operations = new PostgresOperations(scoped['operations']!);
    const readRun = () =>
      operations.read('run', summary.bookId, { id: initial.id, limit: '100' });
    const frozen = await readRun();
    assert.equal(frozen.nextCursor, null);
    const original = input.bankObservations[0]!;
    const revisedMember = frozen.items?.find(
      (m) =>
        m['side'] === 'BANK' &&
        object(m['snapshot'])['reference'] === original.transferReference,
    );
    assert(
      revisedMember && object(revisedMember['allocation'])['current'] === true,
    );
    const missing = frozen.items?.find(
      (m) =>
        m['outcome'] === 'UNMATCHED' &&
        object(m['cause'])['classification'] === 'MISSING_BANK_MOVEMENT',
    );
    const missingCase = rows(missing?.['cases'])[0];
    assert(missingCase && typeof missingCase['id'] === 'string');
    const missingDetail = await operations.read('case', summary.bookId, {
      id: missingCase['id'],
    });
    assert.equal(
      missingDetail.data?.['classification'],
      'MISSING_BANK_MOVEMENT',
    );
    assert.equal(missingDetail.data?.['resolution'], 'ACCEPTED_RISK');
    assert.equal(missingDetail.data?.['currentlyReconciled'], false);
    const revised = {
      ...input,
      bankObservations: [
        {
          ...original,
          amount: {
            ...original.amount,
            amountMinor: (BigInt(original.amount.amountMinor) + 1n).toString(),
          },
        },
      ],
    };
    const revision = await ingestion.ingest(
      simulatorBankBatch(revised, bankSource, 'local-demo-revision'),
    );
    const after = await recon.summary(initial.id);
    assert(
      after.current.some((x) => x.status === 'INVALIDATED' && x.count > 0),
      'Revised evidence must invalidate earlier assurance',
    );
    assert.equal(
      after.matchedGroups,
      initial.matchedGroups,
      'Historical matches remain frozen',
    );
    const observed = await readRun();
    const revisedAfter = observed.items?.find(
      (m) => m['id'] === revisedMember['id'],
    );
    assert(revisedAfter);
    assert.equal(revisedAfter['outcome'], 'MATCHED');
    assert.deepEqual(revisedAfter['snapshot'], revisedMember['snapshot']);
    assert.equal(object(revisedAfter['allocation'])['current'], false);
    const exact = observed.items
      ?.filter(
        (m) =>
          m['side'] === 'PROCESSOR' &&
          m['outcome'] === 'MATCHED' &&
          object(m['allocation'])['current'] === true &&
          object(m['allocation'])['frozenDifferenceMinor'] === '0',
      )
      .sort((a, b) =>
        String(object(a['snapshot'])['reference']).localeCompare(
          String(object(b['snapshot'])['reference']),
        ),
      )[0];
    assert(
      exact &&
        typeof exact['id'] === 'string' &&
        typeof revisedAfter['id'] === 'string',
    );

    const deliveries = (
      await admin.query<{
        id: string;
        received: string;
        count: number;
        revisions: string[];
      }>(
        `SELECT b.id, to_char(b.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') received, b.imported_count count,
                ARRAY(SELECT r.revision_id FROM ingestion.raw_record r WHERE r.batch_id=b.id ORDER BY r.locator) revisions
         FROM ingestion.batch b
         WHERE b.source_account_id=$1 AND b.batch_key IN ('demo-activities','local-demo-duplicate')
         ORDER BY b.batch_key`,
        [processorSource],
      )
    ).rows;
    const [originalDelivery, repeatDelivery] = deliveries;
    assert(originalDelivery && repeatDelivery);
    assert.equal(repeatDelivery.id, replay.id);
    assert.equal(originalDelivery.count, replaySummary.received);
    assert.deepEqual(repeatDelivery.revisions, originalDelivery.revisions);
    const newRevision = (
      await admin.query<{
        id: string;
        received: string;
        original: string;
        state: string;
      }>(
        `SELECT r.revision_id id, to_char(r.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') received,
                prior.revision_id original, f.revision_state state
         FROM ingestion.raw_record r JOIN ingestion.revision v ON v.id=r.revision_id
         JOIN ingestion.fact_status f ON f.id=v.fact_id
         JOIN ingestion.raw_record prior ON prior.source_account_id=r.source_account_id AND prior.external_id=r.external_id
         JOIN ingestion.batch b ON b.id=prior.batch_id AND b.batch_key='demo-bank'
         WHERE r.batch_id=$1`,
        [revision.id],
      )
    ).rows[0];
    assert(newRevision);
    assert.equal(
      newRevision.original,
      object(revisedMember['snapshot'])['revisionId'],
    );
    assert.notEqual(newRevision.id, newRevision.original);
    assert.equal(newRevision.state, 'REVIEW_REQUIRED');
    const coverageKey = 'source:' + originalDelivery.id;
    const coverage = await operations.read('control', summary.bookId, {
      evaluation: summary.evaluationId,
      key: coverageKey,
    });
    assert.equal(coverage.data?.['status'], 'UNKNOWN');
    assert.equal(coverage.data?.['current'], false);
    assert.equal(coverage.data?.['currentReason'], 'INPUTS_CHANGED');
    const investigation: InvestigationEvidence = {
      book: summary.bookId,
      evaluation: summary.evaluationId,
      run: initial.id,
      exactItem: exact['id'],
      missingCase: missingCase['id'],
      revisedItem: revisedAfter['id'],
      coverageKey,
      originalDelivery: {
        id: originalDelivery.id,
        received: originalDelivery.received,
        count: originalDelivery.count,
      },
      repeatDelivery: {
        id: repeatDelivery.id,
        received: repeatDelivery.received,
        count: repeatDelivery.count,
      },
      newRevision,
      ...before,
    };
    const scenarios = {
      matchedGroups: initial.matchedGroups,
      currentGroups: after.current,
      missingBank: 'UNMATCHED',
      sourceCoverage: initial.sourceCoverage,
      duplicateDelivery: 'PASS',
      repeatedReceipts: replaySummary.received,
      unchangedCounts: before,
      revisedAssurance: 'INVALIDATED',
    };
    console.log('VIGIL_LOCAL_DEMO_SCENARIOS ' + JSON.stringify(scenarios));
    await seedAccount(scoped['seed']!, {
      ...visitor,
      role: 'Viewer',
      books: [summary.bookId],
      visitor: true,
    });
    if (stop.signal.aborted) return;
    const serverRoot = join(dir, 'server');
    await cp(standalone, serverRoot, {
      recursive: true,
      filter: (source) => !basename(source).startsWith('.env'),
    });
    await cp(
      join(root, 'apps/ops/.next/static'),
      join(serverRoot, 'apps/ops/.next/static'),
      { recursive: true },
    );
    await cp(
      join(root, 'apps/ops/public'),
      join(serverRoot, 'apps/ops/public'),
      { recursive: true },
    );
    const base = `http://127.0.0.1:${appPort}`;
    // Only these runtime capabilities reach the web process; owner and seed pools stay offline.
    const serverEnv = {
      ...clean,
      PORT: String(appPort),
      HOSTNAME: '127.0.0.1',
      VIGIL_DEPLOYMENT_MODE: 'application',
      VIGIL_VISITOR_LOGIN: 'true',
      DATABASE_OPERATIONS_URL: url('flow_local_demo_operations'),
      DATABASE_AUTH_URL: url('flow_local_demo_auth'),
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      BETTER_AUTH_URL: base,
      OPS_BOOK_ID: summary.bookId,
      VIGIL_LOCAL_INVESTIGATION: JSON.stringify(investigation),
    };
    app = spawn(process.execPath, [join(serverRoot, 'apps/ops/server.js')], {
      env: serverEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    // Runtime diagnostics may contain identifiers. They stay private and are removed on exit.
    let diagnostics = '';
    app.stderr?.on('data', (chunk: Buffer) => {
      if (diagnostics.length < 65536) diagnostics += chunk.toString();
    });
    let ready = false;
    for (let i = 0; i < 150 && !stop.signal.aborted; i++) {
      if (app.exitCode !== null)
        throw new Error('Local dashboard exited before readiness');
      try {
        if (
          (
            await fetch(base + '/health/ready', {
              signal: AbortSignal.timeout(2000),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {
        /* bounded startup polling */
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    if (!ready) {
      await writeFile(join(dir, 'server.log'), diagnostics, { mode: 0o600 });
      throw new Error('Local dashboard was not ready');
    }
    const report = {
      version: 'local-demo-v1',
      url:
        base +
        '/?book=' +
        summary.bookId +
        '&evaluation=' +
        summary.evaluationId,
      signInUrl: base + '/sign-in',
      bookId: summary.bookId,
      evaluationId: summary.evaluationId,
      visitor: { email: visitor.email, password: visitor.password },
      environment: 'synthetic',
      financialAssurance: summary.assurance,
      container,
      databasePort,
      appPort,
    };
    console.log('VIGIL_LOCAL_DEMO_READY ' + JSON.stringify(report));
    if (options.smoke) {
      const { chromium, expect } = await import('@playwright/test');
      const executable = (
        await exec('which', ['chromium'], { env: clean }).catch(() => ({
          stdout: '',
        }))
      ).stdout.trim();
      const browser = await chromium.launch({
        headless: true,
        ...(executable ? { executablePath: executable } : {}),
      });
      try {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(report.url);
        await page.waitForURL(base + '/sign-in');
        await expect(
          page.getByRole('heading', { name: 'Synthetic investigation guide' }),
        ).toHaveCount(0);
        await page.getByLabel('Email', { exact: true }).fill(visitor.email);
        await page
          .getByLabel('Password', { exact: true })
          .fill(visitor.password);
        await page
          .getByRole('button', { name: 'Sign in', exact: true })
          .click();
        await page.waitForURL(base + '/');
        const guide = page.locator('section.panel').filter({
          has: page.getByRole('heading', {
            name: 'Synthetic investigation guide',
          }),
        });
        const openGuide = async () => {
          await page.goto(report.url);
          await expect(guide).toBeVisible({ timeout: 30_000 });
          await expect(guide.getByRole('heading', { level: 3 })).toHaveCount(5);
        };
        for (const width of [1280, 320]) {
          await page.setViewportSize({ width, height: 800 });
          await openGuide();
          assert(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <=
                document.documentElement.clientWidth,
            ),
            'Guide must fit within the viewport',
          );
          const exactLink = guide.getByRole('link', {
            name: 'Compare the matched pair and its current proof',
          });
          await exactLink.focus();
          await expect(exactLink).toBeFocused();
          await page.keyboard.press('Enter');
          const exactMember = page.locator(
            'article[id="record-' + investigation.exactItem + '"]',
          );
          await expect(
            exactMember.locator('.status').filter({ hasText: /^• CURRENT$/ }),
          ).toBeVisible({ timeout: 30_000 });
          await expect(
            exactMember.locator('.status').filter({ hasText: /^• MATCHED$/ }),
          ).toBeInViewport();
        }

        await openGuide();
        await guide
          .getByRole('link', {
            name: 'Review the exception and linked settlement run',
          })
          .click();
        await expect(
          page.getByText('MISSING_BANK_MOVEMENT', { exact: true }).first(),
        ).toBeVisible({ timeout: 30_000 });
        await page
          .getByRole('link', { name: /Inspect linked reconciliation run/ })
          .click();
        await expect(
          page.getByRole('heading', {
            name: 'Frozen reconciliation population',
          }),
        ).toBeVisible({ timeout: 30_000 });

        await openGuide();
        await guide
          .getByText('Compare delivery IDs and receipt times', { exact: true })
          .click();
        await expect(
          guide.getByText(repeatDelivery.id, { exact: true }),
        ).toBeVisible();
        await expect(
          guide.getByText(originalDelivery.id, { exact: true }),
        ).toBeVisible();

        await guide
          .getByText('Compare bank revision IDs', { exact: true })
          .click();
        await expect(
          guide.getByText(newRevision.id, { exact: true }),
        ).toBeVisible();
        await guide
          .getByRole('link', {
            name: 'Compare frozen history with current applicability',
          })
          .click();
        const revisedEvidence = page.locator(
          'article[id="record-' + investigation.revisedItem + '"]',
        );
        await expect(
          revisedEvidence
            .locator('.status')
            .filter({ hasText: /^\? NOT CURRENT$/ }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          revisedEvidence.locator('.status').filter({ hasText: /^• MATCHED$/ }),
        ).toBeInViewport();

        await openGuide();
        await guide
          .getByRole('link', {
            name: 'Inspect expected and observed evidence for the coverage control',
          })
          .click();
        const control = page.locator('section.panel').filter({
          has: page.getByRole('heading', { name: 'Control evidence' }),
        });
        await expect(
          control.locator('.status').filter({ hasText: /^\? STALE$/ }),
        ).toBeVisible({
          timeout: 30_000,
        });
        await expect(
          control
            .locator('.status')
            .filter({ hasText: /^\? UNKNOWN$/ })
            .first(),
        ).toBeVisible();
        console.log(
          'VIGIL_LOCAL_DEMO_JOURNEY PASS 5 scenarios, 1280px and 320px, keyboard activation',
        );
        for (const section of [
          'overview',
          'reconciliation',
          'exceptions',
          'controls',
          'workers',
          'integrity',
        ]) {
          const response = await page.goto(
            base +
              '/' +
              section +
              '?book=' +
              summary.bookId +
              '&evaluation=' +
              summary.evaluationId,
          );
          assert.equal(response?.status(), 200);
          await expect(page.locator('main')).toBeVisible();
          assert(!page.url().includes('/sign-in'));
        }
        assert.deepEqual(errors, []);
        console.log(
          'VIGIL_LOCAL_DEMO_BROWSER PASS authenticated navigation: 6 sections',
        );
      } finally {
        await browser.close();
      }
    }
    if (!options.smoke)
      await new Promise<void>((done, reject) => {
        const finish = () => done();
        stop.signal.addEventListener('abort', finish, { once: true });
        app!.once('exit', () =>
          stop.signal.aborted
            ? done()
            : reject(new Error('Local dashboard exited')),
        );
        if (stop.signal.aborted) done();
      });
  } finally {
    stop.abort();
    if (app && app.exitCode === null) {
      app.kill('SIGTERM');
      await Promise.race([
        new Promise<void>((done) => app!.once('exit', () => done())),
        new Promise<void>((done) => setTimeout(done, 5000)),
      ]);
      if (app.exitCode === null) {
        app.kill('SIGKILL');
        await new Promise<void>((done) => app!.once('exit', () => done()));
      }
    }
    await Promise.all(pools.map((pool) => pool.end()));
    if (started) {
      const label = (
        await docker(
          'inspect',
          '--format',
          '{{index .Config.Labels "vigil.local-demo"}}',
          container,
        )
      ).stdout.trim();
      if (label !== container)
        throw new Error('Demo ownership changed; automatic cleanup refused');
      await docker('stop', '--time', '2', container);
      assert.equal(
        (
          await docker('ps', '-aq', '--filter', 'name=^/' + container + '$')
        ).stdout.trim(),
        '',
        'Owned container must be removed',
      );
    }
    await rm(dir, { recursive: true, force: true });
    await assert.rejects(stat(dir), { code: 'ENOENT' });
    console.log('VIGIL_LOCAL_DEMO_CLEANUP PASS');
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
  }
}
if (require.main === module)
  void localDemo(process.argv.slice(2), process.env).catch(() => {
    console.error(
      'Local demo failed; no existing database was used. Check prerequisites in docs/local-demo.md.',
    );
    process.exitCode = 1;
  });
