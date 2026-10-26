import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { Page, Request, Browser } from '@playwright/test';
import type { PostgresOperations } from '@vigil/operations-read-postgres';
import { money } from '../../apps/ops/components/format';
import { exactReference } from '../../apps/ops/test/readability-fixtures';

/** Existing public synthetic data only; copy and navigation perform no financial writes. */
export async function verifyEvidence(
  page: Page,
  reads: PostgresOperations,
  base: string,
  book: string,
  evaluation: string,
  screenshots: string,
) {
  await mkdir(screenshots, { recursive: true });
  await page
    .context()
    .grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const requests: string[] = [];
  const onRequest = (request: Request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      requests.push(request.method());
  };
  page.on('request', onRequest);
  const scoped = (path: string, extra: Record<string, string> = {}) => {
    const url = new URL(path, base);
    url.search = new URLSearchParams({ book, evaluation, ...extra }).toString();
    return url.href;
  };
  async function copy(
    label: string,
    expected: string,
    key: 'Enter' | 'Space' = 'Enter',
  ) {
    const button = page
      .getByRole('button', { name: 'Copy ' + label, exact: true })
      .first();
    await button.focus();
    assert.equal(
      await button.evaluate((element) => element === document.activeElement),
      true,
    );
    assert.notEqual(
      await button.evaluate(
        (element) => getComputedStyle(element).outlineStyle,
      ),
      'none',
    );
    await button.press(key);
    await page
      .getByRole('status')
      .filter({ hasText: 'Copied ' + label })
      .first()
      .waitFor();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      expected,
    );
  }
  try {
    const workers = await reads.read('workers', book, {
      status: 'SUCCEEDED',
      limit: '1',
    });
    const id = String(workers.items![0]!['id']);
    const work = (await reads.read('work', book, { id })).data!;
    const controls = await reads.read('controls', book, {
      evaluation,
      limit: '100',
    });
    const monetary = controls.items!.find(
      (row) => row['unit'] === 'MINOR_UNITS',
    );
    assert(monetary, 'Existing public fixture exposes monetary comparisons');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(scoped('/workers/' + id));
      await page
        .getByRole('heading', { name: 'Durable work metadata', exact: true })
        .waitFor();
      await copy('worker identifier', id);
      await copy('event type', String(work['eventType']), 'Space');
      await copy('worker creation timestamp', String(work['createdAt']));
      if (work['nextAttemptAt'] === null)
        assert.equal(
          await page
            .getByRole('button', {
              name: 'Copy next attempt at timestamp',
              exact: true,
            })
            .count(),
          0,
        );
      assert(
        (await page.locator('main').innerText()).includes(
          'Identity and source',
        ),
      );
      assert(
        (await page.locator('main').innerText()).includes(
          'No failure recorded',
        ),
      );
      await page.screenshot({
        path: join(screenshots, `worker-${width}.png`),
        fullPage: true,
      });
      await page.goto(scoped('/controls'));
      const region = page.getByRole('region', {
        name: 'Frozen control comparisons',
        exact: true,
      });
      await region.waitFor();
      for (const name of ['Expected', 'Observed', 'Discrepancy'])
        assert.equal(
          await region
            .getByRole('columnheader', { name, exact: true })
            .evaluate((element) => getComputedStyle(element).textAlign),
          'right',
        );
      const amounts = region.locator('td.money');
      assert(await amounts.count());
      assert.equal(
        await amounts
          .first()
          .evaluate((element) => getComputedStyle(element).textAlign),
        'right',
      );
      assert(
        (
          await amounts
            .first()
            .evaluate((element) => getComputedStyle(element).fontVariantNumeric)
        ).includes('tabular-nums'),
      );
      await page.screenshot({
        path: join(screenshots, `comparison-${width}.png`),
        fullPage: true,
      });
      await page.goto(
        scoped('/controls/result', { key: String(monetary['key']) }),
      );
      await page
        .getByRole('heading', { name: 'Control evidence', exact: true })
        .waitFor();
      await copy('control key', String(monetary['key']));
      const comparison = page.getByRole('region', {
        name: 'Control value comparison',
        exact: true,
      });
      for (const field of ['expected', 'observed', 'discrepancy'])
        assert(
          (await comparison.innerText()).includes(
            money(monetary[field], monetary['currency']),
          ),
        );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: join(screenshots, `control-${width}.png`),
        fullPage: true,
      });
    }
    const runs = await reads.read('reconciliation', book, { limit: '1' });
    await page.goto(scoped('/reconciliation/' + String(runs.items![0]!['id'])));
    await page
      .getByRole('heading', {
        name: 'Frozen reconciliation population',
        exact: true,
      })
      .waitFor();
    assert(
      (await page.locator('main').innerText()).includes(
        'Window and processing times',
      ),
    );
    const raw = page.getByText('Raw approved read evidence', { exact: true });
    await raw.click();
    assert(
      await page.locator('details.raw-evidence[open] pre').first().isVisible(),
    );
    await raw.click();
    await page.screenshot({
      path: join(screenshots, 'run-390.png'),
      fullPage: true,
    });
    const cases = await reads.read('exceptions', book, { limit: '1' });
    await page.goto(scoped('/exceptions/' + String(cases.items![0]!['id'])));
    await page
      .getByRole('heading', { name: 'Operational case', exact: true })
      .waitFor();
    assert(
      (await page.locator('main').innerText()).includes(
        'Identity and financial scope',
      ),
    );
    await copy('case id', String(cases.items![0]!['id']));
    await page.screenshot({
      path: join(screenshots, 'case-390.png'),
      fullPage: true,
    });
    assert.deepEqual(requests, []);

    // Isolated, labelled client-component fixture: tests arbitrary punctuation and
    // clipboard denial without creating or substituting financial records.
    const browser = page.context().browser();
    assert(browser);
    await verifyClipboardFixture(browser, base, screenshots);
    const result = {
      desktop: 'PASS',
      narrow: 'PASS',
      numericAlignment: 'PASS',
      exactClipboard: 'PASS',
      keyboardEnterAndSpace: 'PASS',
      clipboardFailure: 'PASS',
      structuredRecords: ['work', 'control', 'run', 'case'],
      nonReadRequests: requests,
    };
    await writeFile(
      join(screenshots, 'evidence-results.json'),
      JSON.stringify(result, null, 2),
    );
    console.log('OPERATIONS_EVIDENCE_BROWSER ' + JSON.stringify(result));
  } finally {
    page.off('request', onRequest);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}

/** Test-only component fixture. No financial read or write is involved. */
export async function verifyClipboardFixture(
  browser: Browser,
  base: string,
  screenshots: string,
) {
  await mkdir(screenshots, { recursive: true });
  const fixtureContext = await browser.newContext({
    viewport: { width: 900, height: 700 },
  });
  await fixtureContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: base,
  });
  const fixture = await fixtureContext.newPage();
  const errors: string[] = [];
  fixture.on('pageerror', (error) => errors.push(error.name));
  try {
    await fixture.goto(base + '/health/live');
    await fixture.setContent(
      '<h1>Clipboard interaction fixture — UI-only, never persisted</h1><div id="copy-fixture"></div>',
    );
    const values = [
      { label: 'test reference', value: exactReference },
      {
        label: 'test event type',
        value: 'ingestion.normalization_requested',
      },
      { label: 'Unicode identifier', value: 'Åß_ID__Ref.v2:/A?x=Y+Z#OK' },
    ];
    const bundle = await build({
      stdin: {
        contents: `import {createElement as h} from 'react'; import {createRoot} from 'react-dom/client'; import {CopyValue} from './components/copy-value'; const values=${JSON.stringify(values)}; createRoot(document.getElementById('copy-fixture')).render(h('div',{},...values.map(v=>h('section',{key:v.label},h('pre',{},v.value),h(CopyValue,v)))));`,
        resolveDir: resolve('apps/ops'),
        sourcefile: 'copy-fixture.tsx',
        loader: 'tsx',
      },
      bundle: true,
      // This workspace can have logical paths that differ from native realpaths.
      preserveSymlinks: true,
      nodePaths: [
        dirname(
          dirname(
            createRequire(resolve('apps/ops/package.json')).resolve(
              'react-dom/package.json',
            ),
          ),
        ),
      ],
      write: false,
      platform: 'browser',
      format: 'iife',
      jsx: 'automatic',
      tsconfig: resolve('apps/ops/tsconfig.json'),
    });
    await fixture.addScriptTag({ content: bundle.outputFiles[0]!.text });
    for (const value of values) {
      const button = fixture.getByRole('button', {
        name: 'Copy ' + value.label,
        exact: true,
      });
      await button.focus();
      await button.press('Enter');
      await fixture
        .getByRole('status')
        .filter({ hasText: 'Copied ' + value.label })
        .waitFor();
      assert.equal(
        await fixture.evaluate(() => navigator.clipboard.readText()),
        value.value,
      );
    }
    await fixture.evaluate(
      "Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } } })",
    );
    await fixture
      .getByRole('button', { name: 'Copy test reference', exact: true })
      .press('Space');
    await fixture
      .getByRole('status')
      .filter({
        hasText: 'Copy failed. Select the value and copy it manually.',
      })
      .waitFor();
    assert.equal(
      await fixture
        .getByRole('button', { name: 'Copy test reference', exact: true })
        .isEnabled(),
      true,
    );
    assert.deepEqual(errors, []);
    await fixture.screenshot({
      path: join(screenshots, 'copy-failure-ui-fixture.png'),
      fullPage: true,
    });
  } finally {
    await fixtureContext.close();
  }
}
