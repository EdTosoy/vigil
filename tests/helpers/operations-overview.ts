import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, Request } from '@playwright/test';
import type { PostgresOperations } from '@vigil/operations-read-postgres';

/** Navigate existing public demo data only; no evidence or evaluation writes. */
export async function verifyOverview(
  page: Page,
  reads: PostgresOperations,
  base: string,
  book: string,
  evaluation: string,
  emptyBook: string,
  screenshots: string,
) {
  await mkdir(screenshots, { recursive: true });
  const target = (selected?: string, selectedBook = book) => {
    const url = new URL('/', base);
    url.searchParams.set('book', selectedBook);
    if (selected) url.searchParams.set('evaluation', selected);
    return url.href;
  };
  const requests: string[] = [];
  const onRequest = (request: Request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      requests.push(request.method());
  };
  page.on('request', onRequest);
  try {
    const expected = await reads.read('overview', book, { evaluation });
    const expectedSweep = expected.data!['integrity'] as Record<
      string,
      unknown
    >;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(target());
      await page.locator('.overview-summary').waitFor();
      assert.equal(
        await page.getByLabel('Evaluation scope', { exact: true }).inputValue(),
        '',
      );
      assert.equal(new URL(page.url()).searchParams.has('evaluation'), false);
      assert.equal(
        await page
          .getByRole('link', {
            name: 'Inspect selected evaluation controls',
            exact: true,
          })
          .count(),
        0,
      );
      await page
        .getByLabel('Evaluation scope', { exact: true })
        .selectOption(evaluation);
      await page
        .getByRole('button', { name: 'Apply evaluation', exact: true })
        .click();
      await page.waitForURL(
        (url) => url.searchParams.get('evaluation') === evaluation,
      );
      await page.locator('.overview-evaluation .evaluation').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('book'), book);
      assert.equal(
        await page.getByLabel('Evaluation scope', { exact: true }).inputValue(),
        evaluation,
      );
      assert(
        (await page.locator('.overview-assurance-state').innerText()).includes(
          String(expectedSweep['financialAssurance']),
        ),
      );
      assert((await page.locator('.overview-book').innerText()).includes(book));
      assert(
        (
          await page.locator('.overview-evaluation .evaluation').innerText()
        ).includes(evaluation),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      const summary = await page.locator('.overview-summary').boundingBox();
      const chooser = await page
        .getByLabel('Evaluation scope', { exact: true })
        .boundingBox();
      const exposure = await page.locator('.overview-exposure').boundingBox();
      assert(summary && chooser && exposure);
      assert(chooser.y >= summary.y && chooser.y < exposure.y);
      assert(chooser.x >= 0 && chooser.x + chooser.width <= width);
      if (width === 390)
        assert(
          chooser.y < 850,
          'Evaluation selection remains near the leading assurance on a narrow screen',
        );
      await page.reload();
      await page.locator('.overview-evaluation .evaluation').waitFor();
      assert.equal(
        await page.getByLabel('Evaluation scope', { exact: true }).inputValue(),
        evaluation,
      );
      await page.screenshot({
        path: join(screenshots, `overview-selected-${width}.png`),
        fullPage: true,
      });
      await page
        .getByRole('link', { name: 'Inspect terminal work', exact: true })
        .click();
      await page
        .getByRole('heading', { name: 'Durable work', exact: true })
        .waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get('status'),
        'FAILED_TERMINAL',
      );
      assert.equal(
        new URL(page.url()).searchParams.get('evaluation'),
        evaluation,
      );
      await page.goBack();
      await page.locator('.overview-summary').waitFor();
      assert.equal(
        await page.getByLabel('Evaluation scope', { exact: true }).inputValue(),
        evaluation,
      );
      await page
        .getByRole('link', {
          name: 'Inspect selected evaluation controls',
          exact: true,
        })
        .click();
      await page
        .getByRole('heading', { name: 'Financial controls', exact: true })
        .waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get('evaluation'),
        evaluation,
      );
      assert.equal(new URL(page.url()).searchParams.has('status'), false);
      await page.goBack();
      await page.locator('.overview-summary').waitFor();
      await page
        .getByRole('link', {
          name: 'Inspect source completeness in current sweep',
          exact: true,
        })
        .click();
      await page
        .getByRole('heading', {
          name: 'Independent integrity sweep',
          exact: true,
        })
        .waitFor();
      assert.equal(new URL(page.url()).hash, '#check-sourceCompleteness');
      assert.equal(await page.locator('#check-sourceCompleteness').count(), 1);
      assert.equal(
        new URL(page.url()).searchParams.get('evaluation'),
        evaluation,
      );
    }
    await page.goto(target(evaluation));
    await page.locator('.overview-summary').waitFor();
    const run = page
      .getByRole('link', { name: /^Inspect evaluation reconciliation run / })
      .first();
    assert(
      await run.count(),
      'Existing evaluation supplies reconciliation relationships',
    );
    await run.click();
    await page
      .getByRole('heading', { name: 'Frozen reconciliation population' })
      .waitFor();
    assert.equal(
      new URL(page.url()).searchParams.get('evaluation'),
      evaluation,
    );
    await page.goto(target(evaluation));
    await page.locator('.overview-summary').waitFor();
    await page.getByLabel('Evaluation scope', { exact: true }).selectOption('');
    await page
      .getByRole('button', { name: 'Apply evaluation', exact: true })
      .click();
    await page.locator('.overview-exposure .empty').waitFor();
    assert(!new URL(page.url()).searchParams.get('evaluation'));
    assert.equal(
      await page
        .getByRole('link', {
          name: 'Inspect selected evaluation controls',
          exact: true,
        })
        .count(),
      0,
    );

    const missing = '00000000-0000-4000-8000-000000000009';
    for (const [selected, selectedBook] of [
      [missing, book],
      [evaluation, emptyBook],
    ]) {
      await page.goto(target(selected, selectedBook));
      await page
        .getByRole('heading', { name: 'Scope not found', exact: true })
        .waitFor();
      assert.equal(await page.locator('.overview-summary').count(), 0);
      assert.equal(
        await page.locator('input[name=evaluation]').inputValue(),
        selected,
      );
      await page
        .getByRole('link', {
          name: 'Choose another evaluation in this book',
          exact: true,
        })
        .click();
      await page.locator('.overview-summary').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('book'), selectedBook);
      assert.equal(new URL(page.url()).searchParams.has('evaluation'), false);
    }
    await page.goto(target(undefined, emptyBook));
    await page.locator('.overview-summary').waitFor();
    assert(
      (await page.locator('.overview-concerns').innerText()).includes(
        'No open operational cases in this sweep',
      ),
    );
    assert(
      (await page.locator('.overview-concerns').innerText()).includes(
        'No terminal work recorded in this sweep',
      ),
    );
    assert(
      (await page.locator('.evaluation-selection').innerText()).includes(
        'No evaluations are available',
      ),
    );
    assert(
      (await page.locator('.overview-assurance-state').innerText()).includes(
        'UNKNOWN',
      ),
    );
    await page.screenshot({
      path: join(screenshots, 'overview-no-evaluation-390.png'),
      fullPage: true,
    });
    assert.deepEqual(requests, []);
    const result = {
      desktop: 'PASS',
      narrow: 'PASS',
      explicitSelectionAndClearing: 'PASS',
      deepRefresh: 'PASS',
      investigationLinks: 'PASS',
      missingAndForeignEvaluation: 'PASS',
      genuineZero: 'PASS',
      nonReadRequests: requests,
    };
    await writeFile(
      join(screenshots, 'overview-results.json'),
      JSON.stringify(result, null, 2),
    );
    console.log('OPERATIONS_OVERVIEW_BROWSER ' + JSON.stringify(result));
  } finally {
    page.off('request', onRequest);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}
