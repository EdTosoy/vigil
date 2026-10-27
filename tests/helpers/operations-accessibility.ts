import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import type { Page } from '@playwright/test';

/** Browser-only checks against the disposable PostgreSQL integration instance. */
export async function verifyAccessibility(
  page: Page,
  base: string,
  book: string,
  evaluation: string,
  empty: string,
  directory: string,
) {
  await mkdir(directory, { recursive: true });
  const before = process.env['VIGIL_OPS_A11Y_MODE'] === 'before';
  const axePath = createRequire(resolve('package.json')).resolve(
    'axe-core/axe.min.js',
  );
  const results: unknown[] = [];
  if (before) {
    await page.goto(
      base + '/workers?' + new URLSearchParams({ book, evaluation }),
    );
    await page
      .getByRole('heading', { name: 'Durable work', exact: true })
      .waitFor();
    await page.locator('select[name="status"]').selectOption('SUCCEEDED');
    const apply = page.getByRole('button', {
      name: 'Apply filters',
      exact: true,
    });
    await apply.focus();
    await apply.press('Enter');
    await page.waitForURL(
      (url) => url.searchParams.get('status') === 'SUCCEEDED',
    );
    await page
      .getByText('Updating results…', { exact: true })
      .waitFor({ state: 'detached' });
    await writeFile(
      join(directory, 'filter-focus.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          text: document.activeElement?.textContent?.slice(0, 60),
        })),
        null,
        2,
      ),
    );
  }
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const section of [
      'overview',
      'reconciliation',
      'exceptions',
      'controls',
      'workers',
      'integrity',
      'error',
      'books',
      'empty',
    ]) {
      const path =
        section === 'overview' || section === 'empty' || section === 'books'
          ? '/'
          : section === 'error'
            ? '/exceptions'
            : '/' + section;
      const query =
        section === 'books'
          ? 'book='
          : new URLSearchParams({
              book: section === 'empty' ? empty : book,
              ...(section === 'empty' ? {} : { evaluation }),
              ...(section === 'error' ? { id: 'malformed_identifier' } : {}),
            }).toString();
      await page.goto(base + path + '?' + query);
      await page.locator('main h1').first().waitFor();
      await page.locator('.page-skeleton').waitFor({ state: 'detached' });
      await page.addScriptTag({ path: axePath });
      const scan = await scanPage(page);
      const layout = await page.evaluate(() => {
        const nav = document
          .querySelector('nav [aria-current="page"]')
          ?.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          activeVisible: !nav || (nav.left >= 0 && nav.right <= innerWidth),
          headings: document.querySelectorAll('h1').length,
        };
      });
      const colors = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            '.scope-strip, .time, th, .status, .nav-index, .eyebrow, footer, label, input, button',
          ),
        )
          .slice(0, 60)
          .map((element) => {
            const style = getComputedStyle(element);
            let ancestor: Element | null = element;
            let background = 'rgba(0, 0, 0, 0)';
            while (ancestor && background === 'rgba(0, 0, 0, 0)') {
              background = getComputedStyle(ancestor).backgroundColor;
              ancestor = ancestor.parentElement;
            }
            return {
              selector: element.tagName + '.' + element.className,
              text: element.textContent?.slice(0, 60),
              color: style.color,
              background,
              size: style.fontSize,
              opacity: style.opacity,
              border: style.borderTopColor,
              outline: style.outlineColor,
            };
          }),
      );
      results.push({ width, section, layout, scan, colors });
      await writeFile(
        join(directory, 'accessibility.json'),
        JSON.stringify(results, null, 2),
      );
      if (
        [
          'overview',
          'controls',
          'workers',
          'integrity',
          'error',
          'empty',
        ].includes(section)
      )
        await page.screenshot({
          path: join(directory, `${section}-${width}.png`),
          fullPage: true,
        });
      if (!before) {
        if (section === 'overview' || section === 'empty')
          assert.equal(
            await page
              .getByRole('region', {
                name: 'Investigation destinations',
                exact: true,
              })
              .count(),
            1,
          );
        if (section === 'books')
          await page
            .getByRole('heading', {
              name: 'Select a financial book',
              exact: true,
            })
            .waitFor();
        assert.equal(
          layout.documentWidth <= width,
          true,
          `${section} document overflow at ${width}`,
        );
        assert.equal(
          layout.activeVisible,
          true,
          `${section} current navigation visible at ${width}`,
        );
        assert.equal(layout.headings, 1, `${section} has one page heading`);
        assert.deepEqual(
          (scan as { violations: unknown[] }).violations,
          [],
          `${section} WCAG scan at ${width}`,
        );
        if (
          [320, 390].includes(width) &&
          ['reconciliation', 'exceptions', 'controls', 'workers'].includes(
            section,
          )
        ) {
          const href = await page
            .locator('tbody a.identifier')
            .first()
            .getAttribute('href');
          assert(
            href,
            'Existing scoped record supplies its detail destination',
          );
          await page.goto(new URL(href, base).href);
          await page.locator('.page-skeleton').waitFor({ state: 'detached' });
          await page.addScriptTag({ path: axePath });
          const detailScan = await scanPage(page);
          assert.deepEqual(
            (detailScan as { violations: unknown[] }).violations,
            [],
            `${section} detail WCAG scan at ${width}`,
          );
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          results.push({
            width,
            section: section + '-detail',
            scan: detailScan,
          });
          await writeFile(
            join(directory, 'accessibility.json'),
            JSON.stringify(results, null, 2),
          );
          await page.screenshot({
            path: join(directory, `${section}-detail-${width}.png`),
            fullPage: true,
          });
        }
      }
    }
  }
  if (!before) {
    await verifyKeyboard(page, base, book, evaluation, directory);
  }
  if (!before) {
    await page.goto(
      base + '/workers?' + new URLSearchParams({ book, evaluation }),
    );
    await page
      .getByRole('region', { name: 'Worker operations', exact: true })
      .waitFor();
    await measureInteractions(page, directory);
    await verifyTouch(page, base, book, evaluation, directory);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

async function verifyKeyboard(
  page: Page,
  base: string,
  book: string,
  evaluation: string,
  directory: string,
) {
  const scoped = (path: string, extra: Record<string, string> = {}) =>
    base + path + '?' + new URLSearchParams({ book, evaluation, ...extra });
  async function tabTo(target: import('@playwright/test').Locator) {
    for (let i = 0; i < 100; i++) {
      if (
        await target.evaluate((element) => element === document.activeElement)
      )
        return;
      await page.keyboard.press('Tab');
    }
    assert.fail(
      'Keyboard could not reach ' + (await target.getAttribute('aria-label')),
    );
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto(scoped('/'));
  await page.locator('.overview-summary').waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator(':focus').innerText(), 'Skip to content');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'main');
  const selector = page.getByLabel('Evaluation scope', { exact: true });
  await tabTo(selector);
  await selector.press('Home');
  await selector.press('End');
  const chosen = await selector.inputValue();
  await tabTo(
    page.getByRole('button', { name: 'Apply evaluation', exact: true }),
  );
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.searchParams.get('evaluation') === chosen);
  await page.locator('.overview-summary').waitFor();
  await tabTo(page.getByRole('link', { name: 'Change book', exact: true }));
  await page.keyboard.press('Enter');
  await page
    .getByRole('heading', { name: 'Select a financial book' })
    .waitFor();
  const bookChoice = page.locator(`.book-list a[href*="${book}"]`);
  await tabTo(bookChoice);
  await page.keyboard.press('Enter');
  await page.locator('.overview-summary').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('book'), book);
  assert.equal(new URL(page.url()).searchParams.has('evaluation'), false);
  await tabTo(
    page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: /Workers/ }),
  );
  await page.keyboard.press('Enter');
  await page
    .getByRole('heading', { name: 'Durable work', exact: true })
    .waitFor();
  const identifier = page.getByRole('textbox', {
    name: 'Exact identifier',
    exact: true,
  });
  const record = await page.locator('tbody a.identifier').first().innerText();
  await tabTo(identifier);
  await page.keyboard.type('invalid_identifier');
  await page.keyboard.press('Enter');
  await page
    .getByRole('heading', { name: 'Invalid request', exact: true })
    .waitFor();
  assert.equal(await identifier.getAttribute('aria-invalid'), 'true');
  assert.equal(
    await identifier.evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(record);
  await tabTo(page.getByRole('button', { name: 'Apply filters', exact: true }));
  await page.keyboard.press('Enter');
  await page
    .getByRole('heading', { name: 'Durable work', exact: true })
    .waitFor();
  await page
    .locator('.filters [aria-disabled="true"]')
    .waitFor({ state: 'detached' });
  assert.equal(await page.locator(':focus').innerText(), 'Apply filters');
  assert.equal(await identifier.inputValue(), record);
  const link = page.locator('tbody a.identifier').first();
  await tabTo(link);
  await page.keyboard.press('Enter');
  await page
    .getByRole('heading', { name: 'Durable work metadata', exact: true })
    .waitFor();
  const copy = page.getByRole('button', {
    name: 'Copy worker identifier',
    exact: true,
  });
  await tabTo(copy);
  assert.equal(
    await copy.evaluate((element) => getComputedStyle(element).outlineWidth),
    '3px',
  );
  await page.keyboard.press('Space');
  await page
    .getByRole('status')
    .filter({ hasText: 'Copied worker identifier' })
    .waitFor();
  await tabTo(
    page.getByRole('link', { name: 'Return to workers results', exact: true }),
  );
  await page.keyboard.press('Enter');
  await page
    .getByRole('heading', { name: 'Durable work', exact: true })
    .waitFor();
  assert.equal(new URL(page.url()).searchParams.get('id'), record);
  await page.screenshot({
    path: join(directory, 'keyboard-return-320.png'),
    fullPage: true,
  });

  await page.goto(scoped('/controls'));
  await page
    .getByRole('region', { name: 'Frozen control comparisons', exact: true })
    .waitFor();
  const table = page.getByRole('region', {
    name: 'Frozen control comparisons',
    exact: true,
  });
  await tabTo(table);
  const heading = table.getByRole('rowheader').first();
  const original = await heading.innerText();
  const left = (await heading.boundingBox())!.x;
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Frozen control comparisons"]')!
        .scrollLeft > 0,
  );
  assert.equal(Math.abs((await heading.boundingBox())!.x - left) < 2, true);
  assert.equal(await heading.innerText(), original);
  assert((await heading.innerText()).includes('Frozen result'));
  await page.screenshot({
    path: join(directory, 'comparison-scrolled-320.png'),
    fullPage: true,
  });
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator(':focus').getAttribute('type'), 'checkbox');
  await page.keyboard.press('Space');
  assert.equal(
    await page
      .getByRole('checkbox', { name: 'Pin record identity' })
      .first()
      .isChecked(),
    false,
  );
  await page.keyboard.press('Tab');
  await table.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  assert.equal(
    await heading.evaluate((element) => getComputedStyle(element).position),
    'static',
  );
  await page.screenshot({
    path: join(directory, 'comparison-unpinned-320.png'),
    fullPage: true,
  });
  await writeFile(
    join(directory, 'keyboard.json'),
    JSON.stringify(
      {
        skip: 'PASS',
        primaryNavigation: 'PASS',
        bookSelection: 'PASS',
        evaluationSelection: 'PASS',
        invalidIdentifierCorrection: 'PASS',
        filterFocus: 'PASS',
        detailCopyAndReturn: 'PASS',
        tableKeyboardScroll: 'PASS',
        pinnedIdentity: 'PASS',
        unpin: 'PASS',
      },
      null,
      2,
    ),
  );
}

async function measureInteractions(page: Page, directory: string) {
  const samples: unknown[] = [];
  async function sample(selector: string, kind = 'text') {
    const result = await page.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      const kind = ${JSON.stringify(kind)};
      const style = getComputedStyle(element, kind === 'placeholder' ? '::placeholder' : null);
      const opaque = element => {
        while(element) { const color=getComputedStyle(element).backgroundColor; if(color !== 'rgba(0, 0, 0, 0)') return color; element=element.parentElement; }
        return 'rgb(255, 255, 255)';
      };
      const luminance = color => color.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4)).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const foreground = kind === 'border' ? style.borderTopColor : kind === 'focus' ? style.outlineColor : style.color;
      const background = opaque(element);
      const a=luminance(foreground), b=luminance(background);
      return {selector:${JSON.stringify(selector)},kind,foreground,background,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),size:style.fontSize,outline:style.outlineStyle,outlineWidth:style.outlineWidth};
    })()`);
    assert(result, selector + ' is rendered');
    samples.push(result);
    if (kind === 'focus') {
      assert.equal((result as { outline: string }).outline, 'solid');
      assert.equal((result as { outlineWidth: string }).outlineWidth, '3px');
    }
    const threshold = ['border', 'focus'].includes(kind) ? 3 : 4.5;
    assert(
      (result as { contrast: number }).contrast >= threshold,
      JSON.stringify(result),
    );
  }
  for (const selector of [
    '.eyebrow',
    '.time',
    '.scope-strip',
    'thead th',
    '.status',
    '.filters label',
    'footer',
  ])
    await sample(selector);
  await sample('input[name="id"]', 'placeholder');
  await sample('input[name="id"]', 'border');
  await sample('button.secondary', 'border');
  await page.locator('.sidebar nav [aria-current="page"]').focus();
  await sample('.sidebar nav [aria-current="page"]', 'focus');
  await page.locator('.filters button').hover();
  await sample('.filters button');
  await page.locator('button.secondary').hover();
  await sample('button.secondary');
  await page
    .getByRole('region', { name: 'Worker operations', exact: true })
    .focus();
  await sample('[aria-label="Worker operations"]', 'focus');
  await writeFile(
    join(directory, 'computed-interactions.json'),
    JSON.stringify(samples, null, 2),
  );
}

async function scanPage(page: Page) {
  return page.evaluate(
    "axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}}).then(r => ({violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary,checks:n.any.map(c=>c.data)}))})), incomplete:r.incomplete.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))}))",
  );
}

async function verifyTouch(
  page: Page,
  base: string,
  book: string,
  evaluation: string,
  directory: string,
) {
  const browser = page.context().browser();
  assert(browser);
  const context = await browser.newContext({
    viewport: { width: 390, height: 1000 },
    hasTouch: true,
    isMobile: true,
  });
  const touch = await context.newPage();
  try {
    await touch.goto(
      base + '/controls?' + new URLSearchParams({ book, evaluation }),
    );
    const region = touch.getByRole('region', {
      name: 'Frozen control comparisons',
      exact: true,
    });
    await region.waitFor();
    await region.scrollIntoViewIfNeeded();
    const identity = region.getByRole('rowheader').first();
    const left = (await identity.boundingBox())!.x;
    const box = (await region.boundingBox())!;
    const cdp = await context.newCDPSession(touch);
    const x = box.x + box.width - 15,
      y = box.y + 100;
    await region.evaluate((element) => {
      element.dataset['touchScroll'] = 'pending';
      element.addEventListener(
        'scrollend',
        () => {
          element.dataset['touchScroll'] = 'done';
        },
        { once: true },
      );
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 5; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - step * 20, y }],
      });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await touch.waitForFunction(
      () =>
        document.querySelector('[aria-label="Frozen control comparisons"]')!
          .scrollLeft > 0,
    );
    // A tap during native inertial scrolling stops the fling rather than activating a control.
    await touch.waitForFunction(
      () =>
        document.querySelector<HTMLElement>(
          '[aria-label="Frozen control comparisons"]',
        )?.dataset['touchScroll'] === 'done',
    );
    assert(Math.abs((await identity.boundingBox())!.x - left) < 2);
    const pin = touch
      .getByRole('checkbox', { name: 'Pin record identity' })
      .first();
    await pin.tap();
    // Touch activation can be delivered after tap dispatch; wait for its DOM state.
    await touch.waitForFunction(
      () =>
        document.querySelector<HTMLInputElement>(
          '.table-tools input[type="checkbox"]',
        )?.checked === false,
    );
    assert.equal(await pin.isChecked(), false);
    await touch.screenshot({
      path: join(directory, 'touch-comparison-390.png'),
      fullPage: true,
    });
    await touch
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Integrity', exact: true })
      .tap();
    await touch
      .getByRole('heading', {
        name: 'Independent integrity sweep',
        exact: true,
      })
      .waitFor();
    const active = await touch
      .locator('nav [aria-current="page"]')
      .boundingBox();
    assert(active && active.x >= 0 && active.x + active.width <= 390);
    await writeFile(
      join(directory, 'touch.json'),
      JSON.stringify(
        {
          touchSwipe: 'PASS',
          identityRetained: 'PASS',
          unpinTap: 'PASS',
          primaryNavigationTap: 'PASS',
        },
        null,
        2,
      ),
    );
  } finally {
    await context.close();
  }
}
