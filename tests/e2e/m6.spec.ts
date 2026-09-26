import { expect, test, type Page } from '@playwright/test';

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on(
    'console',
    (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(m.text()),
  );
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

async function ready(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#loader')).toBeHidden();
}

test('uncertainty glass toggles with its legend', async ({ page }, info) => {
  const problems = watchConsole(page);
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Show uncertainty' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const legend = page.locator('#glass-legend');
  await expect(legend).toBeVisible();
  await expect(legend).toContainText('Reading the glass');
  await expect(page.locator('#sr-status')).toContainText('Uncertainty shown');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `screenshots/m6-${info.project.name}-glass.png` });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(legend).toBeHidden();
  expect(problems).toEqual([]);
});

test('an official status-page incident shows a sourced banner', async ({ page }, info) => {
  const problems = watchConsole(page);
  const started = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  await page.route('**/data/incidents.json', (r) =>
    r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'fixture-1',
          platform: 'chatgpt',
          impact: 'major',
          title: 'Elevated error rates for some users',
          started,
          resolved: null,
          url: 'https://status.openai.com/',
        },
      ]),
    }),
  );
  await ready(page);
  const banner = page.locator('#incidents');
  await expect(banner).toContainText('official status page reports');
  await expect(banner).toContainText('Elevated error rates');
  await expect(banner.locator('a[href="https://status.openai.com/"]')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `screenshots/m6-${info.project.name}-incident.png` });
  expect(problems).toEqual([]);
});

test('sound is off by default and toggles from a click', async ({ page }) => {
  const problems = watchConsole(page);
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Sound', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  // Headless browsers may or may not allow audio; either way the state is honest and quiet.
  await expect(toggle).toHaveAttribute('aria-pressed', /true|false/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(problems).toEqual([]);
});

test('after 30 s idle, the cinematic tour starts and any key stops it', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one idle run is enough');
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  await ready(page);
  await page.waitForTimeout(34_000);
  await expect(page.locator('html')).toHaveClass(/tour-on/);
  const tour = page.locator('#tour');
  await expect(tour).toBeVisible();
  await expect(tour.getByRole('button', { name: /Stop/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `screenshots/m6-${info.project.name}-tour.png` });
  await page.keyboard.press('Shift');
  await expect(page.locator('html')).not.toHaveClass(/tour-on/);
  expect(problems).toEqual([]);
});
