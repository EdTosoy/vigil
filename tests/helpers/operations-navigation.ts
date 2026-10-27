import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, Request } from '@playwright/test';
import type { PostgresOperations } from '@vigil/operations-read-postgres';

/** Existing public synthetic fixture only. This helper performs no financial writes. */
export async function verifyNavigation(
  page: Page,
  reads: PostgresOperations,
  base: string,
  book: string,
  evaluation: string,
  otherBook: string,
  screenshots: string,
) {
  await mkdir(screenshots, { recursive: true });
  const nonReadRequests: string[] = [];
  const onRequest = (request: Request) => {
    if (!['GET', 'HEAD'].includes(request.method()))
      nonReadRequests.push(request.method());
  };
  page.on('request', onRequest);
  const scoped = (path: string, extra: Record<string, string> = {}) => {
    const target = new URL(path, base);
    target.search = new URLSearchParams({
      book,
      evaluation,
      ...extra,
    }).toString();
    return target.href;
  };
  const heading = (name: string) =>
    page.getByRole('heading', { name, exact: true }).waitFor();
  const resultsReturn = () =>
    page.getByRole('link', { name: /^Return to .* results$/ });
  const evidence: Record<string, unknown> = {};
  let filteredDetail: string | undefined;
  try {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(scoped('/workers', { status: 'SUCCEEDED', limit: '1' }));
      await heading('Durable work');
      const first = await page.locator('main a.identifier').first().innerText();
      await page
        .getByRole('link', { name: 'Next results', exact: false })
        .click();
      await page.waitForURL((url) => url.searchParams.has('cursor'));
      await page.waitForFunction(
        (id) => document.querySelector('main a.identifier')?.textContent !== id,
        first,
      );
      const record = await page
        .locator('main a.identifier')
        .first()
        .innerText();
      const list = new URL(page.url());
      await page.locator('main a.identifier').first().click();
      await heading('Durable work metadata');
      const deep = page.url();
      filteredDetail = deep;
      const origin = JSON.parse(new URL(deep).searchParams.get('from')!);
      assert.equal(origin.filters.cursor, list.searchParams.get('cursor'));
      assert.equal(origin.filters.status, 'SUCCEEDED');
      assert.equal(new URL(deep).searchParams.has('status'), false);
      assert.equal(new URL(deep).searchParams.get('evaluation'), evaluation);
      assert((await page.getByText(record, { exact: false }).count()) > 0);
      await page.reload();
      await heading('Durable work metadata');
      assert.equal(
        page.url(),
        deep,
        'A refreshed deep link retains URL context',
      );
      await page.screenshot({
        path: join(screenshots, `detail-${width}.png`),
        fullPage: true,
      });
      await resultsReturn().click();
      await heading('Durable work');
      const returned = new URL(page.url());
      assert.deepEqual(
        [...returned.searchParams].sort(),
        [...list.searchParams].sort(),
      );
      assert.equal(
        decodeURIComponent(returned.hash.slice(1)),
        'record-' + record,
      );
      await page.waitForFunction(
        (id) => document.getElementById('record-' + id) !== null,
        record,
      );
      await page.waitForFunction((id) => {
        const row = document.getElementById('record-' + id);
        if (!row) return false;
        const rect = row.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0;
      }, record);
      await page.screenshot({
        path: join(screenshots, `returned-results-${width}.png`),
        fullPage: true,
      });
      await page.goBack();
      await heading('Durable work metadata');
      assert.equal(page.url(), deep);
      await page.goForward();
      await heading('Durable work');
      assert.deepEqual(
        [...new URL(page.url()).searchParams].sort(),
        [...list.searchParams].sort(),
      );
      evidence[String(width)] = {
        status: 'SUCCEEDED',
        paginationPreserved: true,
        rowRestored: record,
        history: 'PASS',
        deepRefresh: 'PASS',
      };
    }

    const works = await reads.read('workers', book, {
      status: 'SUCCEEDED',
      limit: '1',
    });
    const work = String(works.items![0]!['id']);
    await page.goto(
      scoped('/workers', { status: 'SUCCEEDED', limit: '1', id: 'not-a-uuid' }),
    );
    await heading('Invalid request');
    assert.equal(
      await page.locator('input[name=id]').inputValue(),
      'not-a-uuid',
    );
    assert.equal(
      await page.locator('select[name=status]').inputValue(),
      'SUCCEEDED',
    );
    assert.equal(
      await page.locator('input[name=evaluation]').inputValue(),
      evaluation,
    );
    await page.screenshot({
      path: join(screenshots, 'invalid-identifier-mobile.png'),
      fullPage: true,
    });
    await page.locator('input[name=id]').fill(work);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await heading('Durable work');
    assert.equal(new URL(page.url()).searchParams.get('id'), work);
    assert.equal(
      new URL(page.url()).searchParams.get('evaluation'),
      evaluation,
    );
    assert.equal(new URL(page.url()).searchParams.get('status'), 'SUCCEEDED');
    assert.equal(
      await page.locator('main a.identifier').first().innerText(),
      work,
    );

    const missing = '00000000-0000-4000-8000-000000000002';
    await page.goto(scoped('/workers/' + missing));
    await heading('Scope not found');
    assert.equal(await page.locator('input[name=id]').inputValue(), missing);
    assert.equal(
      await page
        .getByRole('heading', { name: 'Durable work metadata', exact: true })
        .count(),
      0,
    );
    await page.locator('input[name=id]').fill(work);
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await heading('Durable work');
    assert.equal(
      await page.locator('main a.identifier').first().innerText(),
      work,
    );

    const cases = await reads.read('exceptions', book, { limit: '1' });
    const caseRecord = cases.items![0]!;
    const caseId = String(caseRecord['id']);
    await page.goto(
      scoped('/exceptions', {
        id: caseId,
        status: String(caseRecord['state']),
        limit: '1',
      }),
    );
    await heading('Exception queue');
    await page.locator('main a.identifier').first().click();
    await heading('Operational case');
    const linkedRun = page.getByRole('link', {
      name: /^Inspect linked reconciliation run /,
    });
    const runHref = new URL((await linkedRun.getAttribute('href'))!, base);
    assert(
      (await linkedRun.innerText()).includes(
        runHref.pathname.split('/').at(-1)!,
      ),
    );
    await linkedRun.click();
    await heading('Frozen reconciliation population');
    assert.equal(
      new URL(page.url()).searchParams.get('evaluation'),
      evaluation,
    );
    assert.equal(
      JSON.parse(new URL(page.url()).searchParams.get('from')!).section,
      'exceptions',
    );
    assert.equal(new URL(page.url()).searchParams.has('status'), false);
    await resultsReturn().click();
    await heading('Exception queue');
    assert.equal(new URL(page.url()).searchParams.get('id'), caseId);
    assert.equal(
      new URL(page.url()).searchParams.get('status'),
      String(caseRecord['state']),
    );

    let control: Record<string, unknown> | undefined;
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 3 && !control; pageNumber++) {
      const controls = await reads.read('controls', book, {
        evaluation,
        limit: '100',
        cursor,
      });
      control = controls.items?.find(
        (row) => Array.isArray(row['caseIds']) && row['caseIds'].length > 0,
      );
      if (!controls.nextCursor) break;
      cursor = controls.nextCursor;
    }
    assert(
      control,
      'The existing public fixture includes a linked control case',
    );
    await page.goto(scoped('/controls', { limit: '1' }));
    await heading('Financial controls');
    const controlRowLink = page.locator('main a.identifier').first();
    const selectedKey = await controlRowLink.innerText();
    assert.equal(
      new URL(
        (await controlRowLink.getAttribute('href'))!,
        base,
      ).searchParams.get('key'),
      selectedKey,
    );
    await controlRowLink.click();
    await heading('Control evidence');
    await resultsReturn().click();
    await heading('Financial controls');
    assert.equal(new URL(page.url()).searchParams.get('limit'), '1');
    await page.goto(
      scoped('/controls/result', { key: String(control['key']) }),
    );
    await heading('Control evidence');
    const caseLink = page.getByRole('link', { name: /^Linked case / }).first();
    assert.equal(
      new URL((await caseLink.getAttribute('href'))!, base).searchParams.get(
        'evaluation',
      ),
      evaluation,
    );
    await caseLink.click();
    await heading('Operational case');
    assert.equal(
      new URL(page.url()).searchParams.get('evaluation'),
      evaluation,
    );

    await page.goto(
      scoped('/controls/result', { key: 'missing_control:NOT_FOUND' }),
    );
    await heading('Scope not found');
    assert.equal(
      await page.locator('input[name=key]').inputValue(),
      'missing_control:NOT_FOUND',
    );
    await page.locator('input[name=key]').fill(String(control['key']));
    await page
      .getByRole('button', { name: 'Open control', exact: true })
      .click();
    await heading('Control evidence');
    assert.equal(
      new URL(page.url()).searchParams.get('key'),
      String(control['key']),
    );
    await page.screenshot({
      path: join(screenshots, 'control-detail-mobile.png'),
      fullPage: true,
    });

    await page.goto(scoped('/', { evaluation: 'not-a-uuid' }));
    await heading('Invalid request');
    assert.equal(
      await page.locator('input[name=evaluation]').inputValue(),
      'not-a-uuid',
    );
    await page.locator('input[name=evaluation]').fill(evaluation);
    await page.getByRole('button', { name: 'Open scope', exact: true }).click();
    await heading('Financial assurance checks');
    assert.equal(
      new URL(page.url()).searchParams.get('evaluation'),
      evaluation,
    );

    await page.goto(scoped('/workers/' + work));
    await heading('Durable work metadata');
    const originatingDetail = new URL(filteredDetail!);
    await page.getByRole('link', { name: 'Change book', exact: true }).click();
    await heading('Select a financial book');
    const picker = new URL(page.url());
    assert.equal(picker.searchParams.get('book'), '');
    assert.equal(picker.searchParams.has('evaluation'), false);
    assert.equal(picker.searchParams.has('from'), false);
    assert.equal(picker.pathname, '/workers');
    await page.screenshot({
      path: join(screenshots, 'book-selection-mobile.png'),
      fullPage: true,
    });
    await page.goto(
      scoped('/workers', { book: 'not-a-uuid', cursor: works.nextCursor! }),
    );
    await heading('Invalid request');
    await page
      .getByRole('link', { name: 'Select a financial book', exact: true })
      .click();
    await heading('Select a financial book');
    assert.equal(new URL(page.url()).searchParams.has('cursor'), false);
    assert.equal(new URL(page.url()).searchParams.has('evaluation'), false);
    await page
      .locator('.book-list li')
      .filter({ hasText: otherBook })
      .getByRole('link')
      .click();
    await heading('Durable work');
    assert.equal(new URL(page.url()).searchParams.get('book'), otherBook);
    assert.equal(new URL(page.url()).searchParams.has('evaluation'), false);
    assert.equal(new URL(page.url()).searchParams.has('from'), false);
    await page.reload();
    await heading('Durable work');
    assert.equal(new URL(page.url()).searchParams.get('book'), otherBook);

    originatingDetail.searchParams.set('book', otherBook);
    originatingDetail.searchParams.delete('evaluation');
    await page.goto(originatingDetail.href);
    await heading('Invalid request');
    assert(
      (await page.locator('main').innerText()).includes(
        'belongs to another book',
      ),
    );
    assert.equal(
      await page
        .getByRole('heading', { name: 'Durable work metadata', exact: true })
        .count(),
      0,
    );
    await page.goto(
      new URL('/workers/' + work + '?book=' + otherBook, base).href,
    );
    await heading('Scope not found');
    assert.equal(
      await page
        .getByRole('heading', { name: 'Durable work metadata', exact: true })
        .count(),
      0,
    );
    await page.goto(scoped('/controls', { book: otherBook }));
    await heading('Scope not found');
    assert.equal(
      await page.locator('input[name=evaluation]').inputValue(),
      evaluation,
    );

    await page.goto(
      scoped('/workers', {
        returnTo: 'https://example.com',
        status: 'SUCCEEDED',
      }),
    );
    await heading('Invalid request');
    assert.equal(new URL(page.url()).origin, new URL(base).origin);
    assert.equal(
      await page.locator('select[name=status]').inputValue(),
      'SUCCEEDED',
    );
    await page
      .getByRole('link', { name: 'Open valid results', exact: true })
      .click();
    await heading('Durable work');
    assert.equal(new URL(page.url()).searchParams.has('returnTo'), false);
    assert.equal(new URL(page.url()).searchParams.get('status'), 'SUCCEEDED');
    assert.deepEqual(nonReadRequests, []);
    evidence['recovery'] = 'PASS';
    evidence['relatedEvaluation'] = 'PASS';
    evidence['bookSwitchAndIsolation'] = 'PASS';
    evidence['nonReadRequests'] = nonReadRequests;
    await writeFile(
      join(screenshots, 'navigation-results.json'),
      JSON.stringify(evidence, null, 2),
    );
    console.log('OPERATIONS_NAVIGATION_BROWSER ' + JSON.stringify(evidence));
  } finally {
    page.off('request', onRequest);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}
