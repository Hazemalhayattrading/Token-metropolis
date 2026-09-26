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
  // Two is the minimum: no column can be removed yet.
  await expect(compare.locator('.compare__remove:enabled')).toHaveCount(0);
  // Choosing in the list does not add a column; the Add button does.
  const picker = compare.getByRole('combobox', { name: 'Add a platform to compare' });
  await picker.selectOption('gemini');
  await expect(compare.locator('.compare__col')).toHaveCount(2);
  await compare.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(compare.locator('.compare__col')).toHaveCount(3);
  // At three the list disables itself; focus moved to the new column, not to <body>.
  await expect(picker).toBeDisabled();
  await expect(compare.locator('[data-open="gemini"]')).toBeFocused();
  // Every visible figure carries a tier; each column states the HQ's scope, what the latest
  // published figure is, and links to its source; the method is one click away.
  await expect(compare.getByRole('link', { name: 'How we estimate' })).toBeVisible();
  for (const col of await compare.locator('.compare__col').all()) {
    const shown = col.locator('.compare__metric:visible');
    const n = await shown.count();
    expect(n).toBeGreaterThanOrEqual(4);
    await expect(shown.locator('.tier')).toHaveCount(n);
    await expect(col.locator('.compare__scope')).not.toBeEmpty();
    await expect(col.locator('.compare__figure')).toHaveText(/\d/);
    await expect(col.locator('.compare__latest a')).toHaveAttribute('href', /^https:\/\//);
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `screenshots/m6-${info.project.name}-compare.png` });

  // Removing one leaves two (focus stays in the overlay); Escape closes and focus returns.
  await compare.locator('.compare__remove').first().click();
  await expect(compare.locator('.compare__col')).toHaveCount(2);
  await expect(compare.locator('.compare__remove:enabled')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.closest('#compare') !== null)).toBe(
    true,
  );
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
