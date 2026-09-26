import { expect, test } from '@playwright/test';

test('an HQ opens with sourced, tiered numbers and closes back to the city', async ({
  page,
}, info) => {
  const problems: string[] = [];
  page.on(
    'console',
    (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(m.text()),
  );
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#loader')).toBeHidden();

  // Labels are keyboard-reachable buttons.
  const label = page.locator('.label[data-id="doubao"]');
  await expect(label).toHaveCount(1);
  await label.focus();
  await page.keyboard.press('Enter');

  const panel = page.locator('#panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.panel__title')).toHaveText('Doubao');
  // every metric carries a tier badge
  const metrics = panel.locator('.metric');
  const n = await metrics.count();
  expect(n).toBeGreaterThanOrEqual(7);
  await expect(panel.locator('.metric .tier')).toHaveCount(n);
  // the latest published figure links to its source
  await expect(panel.locator('.source a')).toHaveAttribute('href', /^https:\/\//);
  await page.waitForTimeout(2200); // camera flight
  await page.screenshot({ path: `screenshots/m3-${info.project.name}-panel.png` });

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(problems).toEqual([]);
});

test('true scale makes the giants obvious', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#loader')).toBeHidden();
  await page.getByRole('button', { name: 'True scale' }).click();
  await expect(page.getByRole('button', { name: 'True scale' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `screenshots/m3-${info.project.name}-true-scale.png` });
});
