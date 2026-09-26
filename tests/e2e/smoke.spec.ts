import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/** Collect console errors and warnings; the brief requires zero of either. */
function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' || msg.type() === 'warning')
      problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

test('loads, validates data and renders the city with live counters', async ({ page }, info) => {
  const problems = watchConsole(page);
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');

  const today = page.locator('.counter__value');
  await expect(today).toHaveText(/^\d{1,3}(,\d{3})+$/);
  const first = await today.textContent();
  await page.waitForTimeout(1200);
  const second = await today.textContent();
  expect(Number(second!.replace(/,/g, ''))).toBeGreaterThan(Number(first!.replace(/,/g, '')));

  // every row of the data view carries a tier badge
  const rows = page.locator('.data-table tbody tr');
  await expect(rows).toHaveCount(15);
  await expect(page.locator('.data-table tbody .tier')).toHaveCount(15);

  // disclaimer is visible
  await expect(page.locator('#disclaimer')).toBeVisible();
  await expect(page.locator('#disclaimer')).toContainText('Not affiliated with');

  await expect(page.locator('#loader')).toBeHidden();
  await page.waitForTimeout(1000); // let the scene settle for the screenshot
  await page.screenshot({ path: `screenshots/m2-${info.project.name}.png` });
  expect(problems).toEqual([]);
});

test('falls back to the 2D dashboard without WebGL', async ({ page }, info) => {
  const problems = watchConsole(page);
  await page.addInitScript(() => {
    // Simulate a browser without WebGL: WebGL context requests return null.
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown;
    };
    const orig = proto.getContext;
    proto.getContext = function (type, ...rest) {
      return type.startsWith('webgl') ? null : orig.call(this, type, ...rest);
    };
  });
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('html')).toHaveClass(/no-webgl/);
  await expect(page.locator('.data-table tbody tr')).toHaveCount(15);
  await expect(page.locator('#loader')).toBeHidden();
  await page.screenshot({
    path: `screenshots/m2-${info.project.name}-no-webgl.png`,
    fullPage: true,
  });
  expect(problems).toEqual([]);
});

test('uses the last saved data when the network copy fails', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  // second visit: data requests fail
  await page.route('**/data/*.json', (route) => route.abort());
  const problems = watchConsole(page);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.notice')).toContainText('last saved copy');
  // failed requests log network errors in the console; nothing else may appear
  expect(problems.filter((p) => !p.includes('Failed to load resource'))).toEqual([]);
});
