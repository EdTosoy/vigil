import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
  mkdir,
  readdir,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { chromium } from '@playwright/test';
import type { SystemInput } from '@vigil/simulator';
import { PostgresOperations } from '@vigil/operations-read-postgres';
import { seedDemo, type DemoPools } from '../tools/ops-demo';
import { clean, witness } from './helpers/resilience';
import { distribution } from './helpers/profile-reads';
import { verifyLoading } from './helpers/operations-loading';
import { verifyNavigation } from './helpers/operations-navigation';
import { verifyOverview } from './helpers/operations-overview';
import { verifyAccessibility } from './helpers/operations-accessibility';
import { verifyEvidence } from './helpers/operations-evidence';
import { authPool } from '../apps/ops/server/auth-service';
import { seedAccount } from '../apps/ops/server/seed-account';
const exec = promisify(execFile);
const keys: Record<keyof DemoPools, string> = {
  admin: 'ADMIN',
  ingestion: 'INGESTION',
  processor: 'PROCESSOR',
  bank: 'BANK',
  reconciliation: 'RECONCILIATION',
  exceptions: 'EXCEPTION',
  controls: 'CONTROL',
  worker: 'WORKER',
  integrity: 'INTEGRITY',
};
const p = Object.fromEntries(
  Object.entries(keys).map(([k, v]) => [
    k,
    new Pool({ connectionString: process.env['VIGIL_TEST_' + v + '_URL'] }),
  ]),
) as unknown as DemoPools;
const op = new Pool({
    connectionString: process.env['VIGIL_TEST_OPERATIONS_URL'],
  }),
  reads = new PostgresOperations(op);
if (!process.env['VIGIL_TEST_OPERATIONS_URL'])
  throw new Error('Run pnpm test:integration');
after(async () => {
  await Promise.all([...Object.values(p), op].map((p) => p.end()));
});
async function port() {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const a = s.address();
  if (!a || typeof a === 'string') throw new Error('No test port');
  await new Promise<void>((r) => s.close(() => r()));
  return a.port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  const done = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await done;
  clearTimeout(timer);
}
test(
  'public simulator demo, restricted production browser, query plans and local performance',
  // Includes the five-viewport WCAG matrix and keyboard journey; latency gates below remain unchanged.
  { timeout: 420000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vigil-ops-public-'));
    let child: ChildProcess | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    const authSeed = authPool(
      process.env['VIGIL_TEST_ADMIN_URL']!.replace(
        'flow_test_admin@',
        'flow_test_auth_seed@',
      ),
    );
    let authUser: string;
    const authPassword = randomUUID();
    const authEmail = 'browser-' + randomUUID() + '@vigil.example';
    const serverLogs: Record<string, unknown>[] = [];
    const memory: Record<string, unknown>[] = [];
    let pendingLog = '';
    function receiveLogs(chunk: Buffer) {
      pendingLog += chunk.toString();
      const lines = pendingLog.split('\n');
      pendingLog = lines.pop()!;
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (record.subsystem === 'operations') {
            serverLogs.push(record);
            if (serverLogs.length > 1000) serverLogs.shift();
          }
        } catch {
          /* framework startup lines */
        }
      }
    }
    async function measureMemory() {
      const status = await readFile('/proc/' + child!.pid + '/status', 'utf8');
      memory.push(
        Object.fromEntries(
          status
            .split('\n')
            .filter((line) => /^(VmRSS|VmHWM):/.test(line))
            .map((line) => line.trim().split(/:\s*/)),
        ),
      );
    }
    try {
      const scale = process.env['VIGIL_PROFILE_LARGE'] ? 2 : 1;
      const configs = [
        { seed: 71200, paymentCount: 40 * scale, batchSizeRange: [5, 10] },
        {
          seed: 71201,
          paymentCount: 12 * scale,
          batchSizeRange: [1, 1],
          anomalies: {
            'missing-bank-transaction': { count: 2 },
            'duplicate-bank-observation': { count: 2 },
            'incorrect-amount': { count: 2 },
          },
        },
        { seed: 71202, paymentCount: 12 * scale, batchSizeRange: [1, 1] },
        { seed: 71203, paymentCount: 8 * scale, batchSizeRange: [2, 2] },
      ];
      const inputs: SystemInput[] = [];
      for (const [i, config] of configs.entries()) {
        const file = join(dir, 'config-' + i + '.json');
        await writeFile(file, JSON.stringify(config));
        const output = join(dir, 'public-' + i);
        await exec(
          process.execPath,
          [
            '--import',
            'tsx',
            'tools/simulator.ts',
            'generate',
            '--config',
            file,
            '--out',
            output,
            ...(i === 2 ? ['--group-size', '2'] : []),
          ],
          { timeout: 30000 },
        );
        inputs.push(
          JSON.parse(
            await readFile(join(output, 'input.json'), 'utf8'),
          ) as SystemInput,
        );
      }
      // Public synthetic USD variant exercises separate currency projections, without oracle labels.
      const usd = inputs[3]!;
      function usdCurrency(v: unknown): unknown {
        if (Array.isArray(v)) return v.map(usdCurrency);
        if (v && typeof v === 'object')
          return Object.fromEntries(
            Object.entries(v).map(([k, x]) => [
              k,
              k === 'currency' ? 'USD' : usdCurrency(x),
            ]),
          );
        return v;
      }
      inputs[3] = {
        ...(usdCurrency(usd) as SystemInput),
        processorEvents: usd.processorEvents.map((e) => ({
          ...e,
          payload: JSON.stringify(usdCurrency(JSON.parse(e.payload))),
        })),
      };
      const demo = await seedDemo(p, inputs, 'phase12-browser-benchmark', 12);
      authUser = await seedAccount(authSeed, {
        email: authEmail,
        password: authPassword,
        name: 'Browser operator',
        role: 'Admin',
        books: [demo.bookId],
      });
      const dataset = (
        await p.admin.query(
          'SELECT count(*)::integer AS receipts,count(DISTINCT r.revision_id)::integer AS revisions FROM ingestion.raw_record r JOIN ingestion.batch b ON b.id=r.batch_id JOIN ingestion.source_account s ON s.id=b.source_account_id WHERE s.book_id=$1',
          [demo.bookId],
        )
      ).rows[0];
      assert(dataset.receipts >= 1000);
      if (process.env['VIGIL_PROFILE_READS']) {
        const { profileReads } = await import('./helpers/profile-reads.js');
        await profileReads(p.admin, op, demo, dataset);
        await clean(p.admin, demo.bookId, demo.reconciliationRunIds);
        return;
      }
      const exposed = await reads.read('overview', demo.bookId, {
        evaluation: demo.evaluationId,
      });
      const currencies = new Set(
        (
          exposed.data!['evaluation'] as { exposure: { currency: string }[] }
        ).exposure.map((x) => x.currency),
      );
      assert.deepEqual([...currencies].sort(), ['PHP', 'USD']);
      const grouped = await reads.read('run', demo.bookId, {
        id: demo.reconciliationRunIds[2],
      });
      assert(
        grouped.items!.some(
          (m) =>
            (m['allocation'] as { shape?: string } | null)?.shape === 'N:1',
        ),
      );
      assert(
        grouped
          .items!.filter((m) => m['allocation'])
          .every(
            (m) =>
              (m['allocation'] as { frozenDifferenceMinor: string })
                .frozenDifferenceMinor === '0',
          ),
      );
      const retain = await witness(p.admin);
      const queryMeasurements: Record<string, number> = {};
      const queryDistributions: Record<
        string,
        ReturnType<typeof distribution>
      > = {};
      for (const [name, kind, args] of [
        ['overview', 'overview', { evaluation: demo.evaluationId }],
        ['exceptionList', 'exceptions', {}],
        ['reconciliationDetail', 'run', { id: demo.reconciliationRunIds[0] }],
        ['controlsList', 'controls', { evaluation: demo.evaluationId }],
      ] as const) {
        const samples: number[] = [];
        await reads.read(kind, demo.bookId, args);
        for (let i = 0; i < 5; i++) {
          const begin = performance.now();
          await reads.read(kind, demo.bookId, args);
          samples.push(performance.now() - begin);
        }
        queryDistributions[name] = distribution(samples);
        queryMeasurements[name] = queryDistributions[name]!.medianMs;
      }
      const plans: Record<string, unknown> = {};
      const queries = {
        exceptions:
          'SELECT c.id FROM exceptions.case_record c JOIN reconciliation.account_mapping m ON m.id=c.mapping_id WHERE m.book_id=$1 ORDER BY c.created_at,c.id LIMIT 51',
        controls:
          'SELECT key FROM controls.result WHERE run_id=$1 ORDER BY key LIMIT 51',
        run: 'SELECT item_id FROM reconciliation.run_member WHERE run_id=$1 ORDER BY item_id LIMIT 51',
        workers:
          'SELECT w.id FROM worker.work_item w JOIN outbox.outbox_event o ON o.id=w.event_id WHERE o.book_id=$1 ORDER BY w.created_at,w.id LIMIT 51',
      };
      for (const [name, sql] of Object.entries(queries)) {
        const id =
          name === 'controls'
            ? demo.evaluationId
            : name === 'run'
              ? demo.reconciliationRunIds[0]
              : demo.bookId;
        const plan = (
          await p.admin.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + sql, [
            id,
          ])
        ).rows[0]['QUERY PLAN'][0];
        plans[name] = { executionMs: plan['Execution Time'], plan: plan.Plan };
      }
      console.log(
        'PHASE12_QUERY_MEASUREMENTS ' +
          JSON.stringify({ dataset, queryMedianMs: queryMeasurements }),
      );
      const bind = await port(),
        base = 'http://127.0.0.1:' + bind;
      child = spawn(
        process.execPath,
        [
          'apps/ops/node_modules/next/dist/bin/next',
          'start',
          'apps/ops',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(bind),
        ],
        {
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) => !/^(DATABASE_|VIGIL_TEST_|OPS_)/.test(key),
              ),
            ),
            OPS_SLOW_READ_MS: '500',
            OPS_BOOK_ID: demo.bookId,
            DATABASE_OPERATIONS_URL: process.env['VIGIL_TEST_OPERATIONS_URL'],
            VIGIL_DEPLOYMENT_MODE: 'application',
            DATABASE_AUTH_URL: process.env['VIGIL_TEST_ADMIN_URL']!.replace(
              'flow_test_admin@',
              'flow_test_auth@',
            ),
            BETTER_AUTH_URL: base,
            BETTER_AUTH_SECRET: randomUUID() + randomUUID(),
            NEXT_TELEMETRY_DISABLED: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      child.stdout?.on('data', receiveLogs);
      child.stderr?.resume();
      const started = performance.now();
      let ready = false;
      while (performance.now() - started < 15000) {
        if (child.exitCode !== null)
          throw new Error('Production app exited (' + child.exitCode + ')');
        try {
          const r = await fetch(base + '/health/live', {
            signal: AbortSignal.timeout(1000),
          });
          if (r.ok) {
            ready = true;
            break;
          }
        } catch {
          /* readiness only */
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      assert(ready, 'Production server ready within bound');
      await measureMemory();
      const live = await fetch(base + '/health/live', {
        headers: {
          'x-flow-request-id': 'untrusted-secret',
          'x-vigil-request-id': 'untrusted-secret',
        },
      });
      assert.equal(live.status, 200);
      const correlationId = live.headers.get('x-flow-request-id')!;
      assert.equal(live.headers.get('x-vigil-request-id'), correlationId);
      assert.match(correlationId, /^[0-9a-f-]{36}$/);
      assert.notEqual(correlationId, 'untrusted-secret');
      assert.equal((await live.json()).status, 'LIVE');
      const readyResponse = await fetch(base + '/health/ready');
      assert.equal(
        readyResponse.status,
        200,
        'Technical readiness despite financial FAIL/UNKNOWN',
      );
      assert.equal((await readyResponse.json()).financialAssurance, 'SEPARATE');

      let executable = process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'];
      if (!executable) {
        try {
          executable = (await exec('which', ['chromium'])).stdout.trim();
        } catch {
          /* use Playwright-managed Chromium on supported hosts */
        }
      }
      browser = await chromium.launch({
        headless: true,
        ...(executable ? { executablePath: executable } : {}),
      });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      await page.goto(base + '/sign-in');
      await page.getByLabel('Email', { exact: true }).fill(authEmail);
      await page.getByLabel('Password', { exact: true }).fill(authPassword);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(base + '/');
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.name));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push('console error');
      });
      const overview =
        base + '/?book=' + demo.bookId + '&evaluation=' + demo.evaluationId;
      const initialLoad = performance.now();
      const overviewResponse = await page.goto(overview);
      const overviewCorrelationId =
        overviewResponse!.headers()['x-flow-request-id'];
      const initialLoadMs = performance.now() - initialLoad;
      const navigation = await page.evaluate(() => {
        const n = performance.getEntriesByType(
          'navigation',
        )[0] as PerformanceNavigationTiming;
        return {
          ttfbMs: n.responseStart - n.requestStart,
          domContentLoadedMs: n.domContentLoadedEventEnd - n.startTime,
          loadMs: n.loadEventEnd - n.startTime,
        };
      });
      await page
        .getByRole('heading', { name: 'Financial operations', exact: true })
        .waitFor();
      assert.equal(await page.title(), 'Vigil · Financial operations');
      assert.equal(
        await page
          .locator('meta[name="application-name"]')
          .getAttribute('content'),
        'Vigil',
      );
      const brand = page.getByRole('link', {
        name: 'Vigil operations overview',
      });
      assert(await brand.isVisible());
      assert.equal(
        await brand.getAttribute('href'),
        new URL(overview).pathname + new URL(overview).search,
      );
      const logo = brand.locator('img');
      await logo.evaluate((img: HTMLImageElement) => img.decode());
      assert.equal(await logo.getAttribute('alt'), '');
      const iconLinks = await page
        .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
        .evaluateAll((links) =>
          links.map((link) => (link as HTMLLinkElement).href),
        );
      for (const path of [
        '/favicon.ico',
        '/favicon-16x16.png',
        '/favicon-32x32.png',
        '/favicon-48x48.png',
        '/apple-touch-icon.png',
      ]) {
        assert(
          iconLinks.some((href) => new URL(href).pathname === path),
          path,
        );
        const response = await page.request.get(base + path);
        assert.equal(response.status(), 200, path);
        assert.match(response.headers()['content-type']!, /^image\//);
      }
      const manifestHref = await page
        .locator('link[rel="manifest"]')
        .getAttribute('href');
      assert.equal(manifestHref, '/site.webmanifest');
      const manifestResponse = await page.request.get(base + manifestHref);
      assert.equal(manifestResponse.status(), 200);
      const manifest = await manifestResponse.json();
      assert.equal(manifest.name, 'Vigil');
      assert.equal(manifest.short_name, 'Vigil');
      for (const icon of manifest.icons) {
        const response = await page.request.get(base + icon.src);
        assert.equal(response.status(), 200, icon.src);
        assert.match(response.headers()['content-type']!, /^image\/png/);
      }
      assert((await page.getByText('UNKNOWN', { exact: false }).count()) > 0);
      assert((await page.getByText('FAIL', { exact: false }).count()) > 0);
      assert(
        (await page
          .getByText('Accepted-risk subset', { exact: true })
          .count()) > 0,
      );
      await page.locator('nav a').filter({ hasText: 'Reconciliation' }).click();
      await page
        .getByRole('heading', { name: 'Reconciliation', exact: true })
        .waitFor();
      if (process.env['VIGIL_OPS_SCREENSHOTS']) {
        await mkdir(process.env['VIGIL_OPS_SCREENSHOTS'], { recursive: true });
        await page.screenshot({
          path: join(
            process.env['VIGIL_OPS_SCREENSHOTS'],
            'reconciliation-list.png',
          ),
          fullPage: true,
        });
      }
      await page.locator('main table a.identifier').first().click();
      await page
        .getByRole('heading', { name: 'Frozen reconciliation population' })
        .waitFor();
      if (process.env['VIGIL_OPS_SCREENSHOTS'])
        await page.screenshot({
          path: join(
            process.env['VIGIL_OPS_SCREENSHOTS'],
            'reconciliation-detail.png',
          ),
          fullPage: true,
        });
      assert((await page.getByText('CURRENT', { exact: false }).count()) > 0);
      await page.locator('nav a').filter({ hasText: 'Exceptions' }).click();
      await page.getByRole('heading', { name: 'Exception queue' }).waitFor();
      await page.locator('main table a.identifier').first().click();
      await page.getByRole('heading', { name: 'Operational case' }).waitFor();
      if (process.env['VIGIL_OPS_SCREENSHOTS'])
        await page.screenshot({
          path: join(process.env['VIGIL_OPS_SCREENSHOTS'], 'case-detail.png'),
          fullPage: true,
        });
      await page
        .getByRole('heading', { name: 'Financial reconciliation', exact: true })
        .waitFor();
      assert(
        (await page.getByText('Append-only case history and notes').count()) >
          0,
      );
      for (const [nav, heading] of [
        ['Controls', 'Financial controls'],
        ['Workers', 'Durable work'],
        ['Integrity', 'Independent integrity sweep'],
      ] as const) {
        await page.locator('nav a').filter({ hasText: nav }).click();
        await page.getByRole('heading', { name: heading }).waitFor();
        if (nav === 'Controls' && process.env['VIGIL_OPS_SCREENSHOTS'])
          await page.screenshot({
            path: join(
              process.env['VIGIL_OPS_SCREENSHOTS'],
              'controls-comparison.png',
            ),
            fullPage: true,
          });
      }
      await page.goto(
        base + '/workers?book=' + demo.bookId + '&status=FAILED_TERMINAL',
      );
      assert(
        (await page.getByText('DEMO_POISON', { exact: true }).count()) > 0,
      );
      await page.goto(
        base +
          '/controls?book=' +
          demo.bookId +
          '&evaluation=' +
          demo.evaluationId +
          '&status=UNKNOWN',
      );
      assert((await page.getByText('UNKNOWN', { exact: false }).count()) > 0);
      await page.goto(base + '/?book=invalid');
      await page.getByRole('heading', { name: 'Invalid request' }).waitFor();
      await verifyLoading(
        page,
        p.admin,
        overview,
        process.env['VIGIL_OPS_SCREENSHOTS'] ??
          join(dir, 'loading-screenshots'),
      );
      await p.admin.query(
        'REVOKE EXECUTE ON FUNCTION operations.read_v1(uuid,text,jsonb) FROM flow_operations_reader',
      );
      try {
        const unavailableReady = await fetch(base + '/health/ready');
        assert.equal(unavailableReady.status, 503);
        assert.equal((await unavailableReady.json()).status, 'UNAVAILABLE');
        assert.equal((await fetch(base + '/health/live')).status, 200);
        await page.goto(overview);
        await page
          .getByRole('heading', { name: 'Operations data unavailable' })
          .waitFor();
        assert.equal(
          await page
            .getByRole('heading', { name: 'Financial assurance checks' })
            .count(),
          0,
        );
        assert.equal(await page.locator('.page-skeleton:visible').count(), 0);
        assert.equal(
          await page.locator('main').getByRole('alert').isVisible(),
          true,
        );
        if (process.env['VIGIL_OPS_SCREENSHOTS'])
          await page.screenshot({
            path: join(
              process.env['VIGIL_OPS_SCREENSHOTS'],
              'overview-unavailable.png',
            ),
            fullPage: true,
          });
      } finally {
        await p.admin.query(
          'GRANT EXECUTE ON FUNCTION operations.read_v1(uuid,text,jsonb) TO flow_operations_reader',
        );
      }
      const empty = randomUUID();
      await p.admin.query(
        "INSERT INTO ledger.book(id,code,environment) VALUES($1,$2,'synthetic')",
        [empty, 'empty-browser-' + empty],
      );
      await p.admin.query('INSERT INTO app_auth.book_grant VALUES($1,$2)', [
        authUser,
        empty,
      ]);
      await page.goto(base + '/?book=' + empty);
      assert(
        (await page.getByText('Assurance: UNKNOWN', { exact: false }).count()) >
          0,
      );
      await verifyNavigation(
        page,
        reads,
        base,
        demo.bookId,
        demo.evaluationId,
        empty,
        join(
          process.env['VIGIL_OPS_SCREENSHOTS'] ?? join(dir, 'screenshots'),
          'navigation',
        ),
      );
      await verifyOverview(
        page,
        reads,
        base,
        demo.bookId,
        demo.evaluationId,
        empty,
        join(
          process.env['VIGIL_OPS_SCREENSHOTS'] ?? join(dir, 'screenshots'),
          'overview',
        ),
      );
      await verifyEvidence(
        page,
        reads,
        base,
        demo.bookId,
        demo.evaluationId,
        join(
          process.env['VIGIL_OPS_SCREENSHOTS'] ?? join(dir, 'screenshots'),
          'evidence',
        ),
      );
      await verifyAccessibility(
        page,
        base,
        demo.bookId,
        demo.evaluationId,
        empty,
        join(
          process.env['VIGIL_OPS_SCREENSHOTS'] ?? join(dir, 'screenshots'),
          'accessibility',
        ),
      );
      await page.goto(overview);
      await page.keyboard.press('Tab');
      assert.equal(
        await page.locator(':focus').textContent(),
        'Skip to content',
      );
      await page.keyboard.press('Enter');
      assert.equal(await page.locator(':focus').getAttribute('id'), 'main');
      const screenshots =
        process.env['VIGIL_OPS_SCREENSHOTS'] ?? join(dir, 'screenshots');
      await mkdir(screenshots, { recursive: true });
      await page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        window.scrollTo(0, 0);
      });
      await page.screenshot({
        path: join(screenshots, 'overview.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 640, height: 900 });
      await page.goto(
        base +
          '/exceptions?book=' +
          demo.bookId +
          '&evaluation=' +
          demo.evaluationId,
      );
      await page.getByRole('heading', { name: 'Exception queue' }).waitFor();
      assert(
        await page
          .getByRole('link', { name: 'Vigil operations overview' })
          .isVisible(),
      );
      await page.screenshot({
        path: join(screenshots, 'exceptions-narrow.png'),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
      assert.deepEqual(errors, []);
      await measureMemory();
      const connections = (
        await p.admin.query(
          "SELECT count(*)::integer AS total,count(*) FILTER(WHERE state='idle in transaction')::integer AS stranded FROM pg_stat_activity WHERE application_name='flow-operations'",
        )
      ).rows[0];
      assert(connections.total <= 4);
      assert.equal(connections.stranded, 0);
      const metricsResponse = await page.request.get(base + '/metrics');
      assert.equal(metricsResponse.status(), 200);
      const metrics = await metricsResponse.text();
      assert(metrics.includes('flow_read_duration_seconds_bucket'));
      assert(
        metrics.includes('flow_server_errors_total{surface="readiness"} 1'),
      );
      assert(
        metrics.includes('flow_last_observed_control_total{status="UNKNOWN"}'),
      );
      assert(
        metrics.includes(
          'flow_last_observed_work_total{state="FAILED_TERMINAL"}',
        ),
      );
      assert(!metrics.includes(demo.bookId));
      assert(!metrics.includes(demo.evaluationId));
      assert(metrics.length < 30000);
      assert(
        serverLogs.some(
          (log) =>
            log.correlationId === correlationId && log.operation === 'liveness',
        ),
      );
      assert(
        serverLogs.some(
          (log) =>
            log.classification === 'PERMISSION_DENIED' &&
            log.outcome === 'FAILURE',
        ),
      );
      assert(
        serverLogs.some(
          (log) =>
            log.correlationId === overviewCorrelationId &&
            log.operation === 'overview' &&
            log.queryCount === 5,
        ),
      );
      assert(!JSON.stringify(serverLogs).includes('untrusted-secret'));
      for (const log of serverLogs)
        assert(
          Object.keys(log).every((key) =>
            [
              'timestamp',
              'level',
              'subsystem',
              'operation',
              'correlationId',
              'outcome',
              'durationMs',
              'databaseMs',
              'queryCount',
              'rows',
              'classification',
              'slow',
            ].includes(key),
          ),
        );

      await retain();
      await clean(p.admin, demo.bookId, demo.reconciliationRunIds);
      // Production client artifacts never contain database ports/connection strings or privileged implementations.
      async function scan(dir: string): Promise<string[]> {
        const result: string[] = [];
        for (const e of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, e.name);
          if (e.isDirectory()) result.push(...(await scan(path)));
          else if (e.name.endsWith('.js')) result.push(path);
        }
        return result;
      }
      const chunks = await scan('apps/ops/.next/static');
      let clientJsBytes = 0;
      for (const file of chunks) {
        const source = await readFile(file, 'utf8');
        clientJsBytes += Buffer.byteLength(source);
        for (const forbidden of [
          'VIGIL_TEST_OPERATIONS_URL',
          'DATABASE_OPERATIONS_URL',
          'postgresql://',
          'operations.read_v1',
          'PostgresOperations',
          'simulator-oracle',
          'pg-connection-string',
        ])
          assert(!source.includes(forbidden), file + ' contains ' + forbidden);
      }
      console.log(
        'PHASE12_READ_BENCHMARK ' +
          JSON.stringify({
            dataset,
            queryMedianMs: queryMeasurements,
            plans,
            clientChunks: chunks.length,
            browserErrors: errors.length,
            queryDistributions,
            clientJsBytes,
            initialLoadMs,
            navigation,
            memory,
            structuredLogCount: serverLogs.length,
            metricsBytes: metrics.length,
            serverPool: connections,
            browserVersion: browser.version(),
            assurance: demo.assurance,
          }),
      );
    } finally {
      await browser?.close();
      if (child) await stop(child);
      await authSeed.end();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
