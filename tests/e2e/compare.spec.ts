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

test('compare mode shows campuses side by side with sourced, tiered figures', async ({
  page,
}, info) => {
  const problems = watchConsole(page);
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#loader')).toBeHidden();

  const toggle = page.getByRole('button', { name: 'Compare', exact: true });
  await toggle.click();
  const compare = page.getByRole('region', { name: 'Compare' });
  await expect(compare).toBeVisible();
  await expect(compare.locator('.compare__col')).toHaveCount(2);
  await compare.getByRole('combobox', { name: 'Add a platform to compare' }).selectOption('gemini');
  await expect(compare.locator('.compare__col')).toHaveCount(3);
  // Every visible figure carries a tier; the latest figure links to its source.
  for (const col of await compare.locator('.compare__col').all()) {
    const shown = col.locator('.compare__metric:visible');
    const n = await shown.count();
    expect(n).toBeGreaterThanOrEqual(4);
    await expect(shown.locator('.tier')).toHaveCount(n);
    await expect(col.locator('.compare__latest a')).toHaveAttribute('href', /^https:\/\//);
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `screenshots/m6-${info.project.name}-compare.png` });

  // Removing one leaves two; Escape closes and focus returns to the toggle.
  await compare.locator('.compare__remove').first().click();
  await expect(compare.locator('.compare__col')).toHaveCount(2);
  await compare.locator('.compare__close').focus();
  await page.keyboard.press('Escape');
  await expect(compare).toBeHidden();
  await expect(toggle).toBeFocused();
  expect(problems).toEqual([]);
});

test('since you arrived, in other words', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  const equiv = page.locator('.stat__equiv');
  await expect(equiv).toContainText('≈');
  await expect(equiv.locator('.tier')).toHaveCount(1);
  await expect(equiv).toContainText('range');
  expect(problems).toEqual([]);
});
