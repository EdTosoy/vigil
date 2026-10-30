import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/** UI-only fault responses supplement real backend login and authorization tests. */
export async function verifyAuthExperience(page: Page, base: string) {
  const directory =
    process.env['VIGIL_AUTH_ARTIFACTS'] ?? '/tmp/vigil-auth-after';
  await mkdir(directory, { recursive: true });
  const email = page.getByLabel('Email', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
  const show = page.getByRole('button', { name: 'Show password', exact: true });
  const findings: unknown[] = [];
  const axePath = createRequire(resolve('package.json')).resolve(
    'axe-core/axe.min.js',
  );

  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/sign-in');
    // Complete a real client interaction before capturing hydrated markup.
    await show.click();
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(
      page.getByRole('heading', { name: 'Explore Vigil' }),
    ).toBeVisible();
    await expect(email).toHaveAttribute('autocomplete', 'username');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await page.addScriptTag({ path: axePath });
    const scan = (await page.evaluate(`(async () => {
      const result = await window.axe.run(document, {
        runOnly: {type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}
      });
      return { violations: result.violations, incomplete: result.incomplete.map(v => v.id) };
    })()`)) as { violations: unknown[]; incomplete: string[] };
    const layout = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
      headings: document.querySelectorAll('h1').length,
      font: getComputedStyle(document.querySelector('input')!).fontSize,
    }));
    assert.deepEqual(scan.violations, [], `WCAG automated scan at ${width}px`);
    assert.equal(layout.document, width);
    assert.equal(layout.headings, 1);
    assert.equal(layout.font, '16px');
    const buttonBox = await signIn.boundingBox();
    assert(buttonBox && buttonBox.y + buttonBox.height <= 900);
    await page.screenshot({
      path: join(directory, `sign-in-${width}.png`),
      fullPage: true,
    });
    findings.push({ width, ...scan, layout });
  }

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('about:blank');
  await page.goto(base + '/sign-in');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(email).toBeFocused();
  await expect(email).toHaveCSS('outline-style', 'solid');
  await expect(email).toHaveCSS('outline-width', '3px');
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await password.fill('keyboard-only-example');
  await page.keyboard.press('Tab');
  await expect(show).toBeFocused();
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('keyboard-only-example');
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'password');
  await page.keyboard.press('Tab');
  await expect(signIn).toBeFocused();

  await email.fill('');
  await password.fill('');
  await signIn.click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#email-error')).toHaveText(
    'Enter your email address.',
  );
  await expect(page.locator('#password-error')).toHaveText(
    'Enter your password.',
  );
  await email.fill('incomplete');
  await email.blur();
  await expect(page.locator('#email-error')).toContainText('valid email');
  await email.fill('invalid-login@example.test');
  await expect(email).toHaveAttribute('aria-invalid', 'false');
  await password.fill('invalid-password');
  const failed = page.waitForResponse(
    (response) => response.url() === base + '/api/auth/sign-in/email',
  );
  await signIn.click();
  assert.equal((await failed).status(), 401);
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'Check your email and password',
  );
  await expect(signIn).toBeEnabled();
  await page.screenshot({
    path: join(directory, 'invalid-credentials-375.png'),
    fullPage: true,
  });

  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/auth/sign-in/email', async (route) => {
    requests++;
    const body = route.request().postDataJSON();
    assert.equal(body.rememberMe, false);
    assert.equal(body.email, 'invalid-login@example.test');
    assert.equal(body.password, 'invalid-password');
    await held;
    await route.fulfill({ status: 503, body: 'Authentication unavailable' });
  });
  await signIn.click();
  const loading = page.getByRole('button', {
    name: 'Signing in…',
    exact: true,
  });
  await expect(loading).toBeDisabled();
  await expect(page.getByRole('status')).toHaveText('Signing in. Please wait.');
  await email.press('Enter');
  await page.screenshot({
    path: join(directory, 'loading-375.png'),
    fullPage: true,
  });
  release();
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'unavailable',
  );
  assert.equal(requests, 1, 'in-flight submission cannot be duplicated');
  await expect(signIn).toBeEnabled();
  await page.unroute('**/api/auth/sign-in/email');

  for (const status of [429, 503]) {
    await page.route('**/api/auth/sign-in/email', (route) =>
      route.fulfill({ status, body: 'Unavailable' }),
    );
    await signIn.click();
    await expect(page.locator('form').getByRole('alert')).toContainText(
      status === 429 ? 'Wait a minute' : 'unavailable',
    );
    await expect(signIn).toBeEnabled();
    await page.unroute('**/api/auth/sign-in/email');
  }
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.abort('failed'),
  );
  await signIn.click();
  await expect(page.locator('form').getByRole('alert')).toContainText(
    'unavailable',
  );
  await expect(signIn).toBeEnabled();
  await page.unroute('**/api/auth/sign-in/email');
  assert.equal(
    await page
      .getByRole('link', { name: /sign up|register|reset|request access/i })
      .count(),
    0,
  );
  assert.equal(
    (await page.request.post(base + '/api/auth/sign-up/email')).status(),
    404,
  );
  await writeFile(
    join(directory, 'accessibility.json'),
    JSON.stringify(findings, null, 2) + '\n',
  );
  // Restore the page to the original enabled-visitor journey.
  await page.goto(base + '/sign-in');
}
