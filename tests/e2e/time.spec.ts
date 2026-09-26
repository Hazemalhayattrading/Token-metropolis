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

test('the time machine scrubs back to 2022 and returns to live', async ({ page }, info) => {
  const problems = watchConsole(page);
  await ready(page);
  const slider = page.getByRole('slider', { name: 'Date shown' });
  await expect(slider).toBeVisible();

  // Jump to the first day of the history.
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#hud')).toContainText('Tokens processed on 2022-11');
  await expect(page.locator('#timeline')).toContainText('History');
  await page.waitForTimeout(2500); // towers ease to their 2022 heights
  await page.screenshot({ path: `screenshots/m5-${info.project.name}-2022.png` });

  // Mid-2024, then play for a moment: the date advances.
  await page.keyboard.press('End');
  const live = page.getByRole('button', { name: 'Live' });
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Home');
  const play = page.getByRole('button', { name: 'Play the history of the city' });
  await play.click();
  await page.waitForTimeout(1500);
  const playing = await page.locator('#hud').textContent();
  expect(playing).toMatch(/Tokens processed on 202[2-6]-/);
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `screenshots/m5-${info.project.name}-playback.png` });

  await live.click();
  await expect(live).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#hud')).toContainText('Tokens processed today');
  expect(problems).toEqual([]);
});

test('race mode ranks all 15 platforms with tiers', async ({ page }, info) => {
  const problems = watchConsole(page);
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Race', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const race = page.getByRole('region', { name: 'The race for tokens' });
  await expect(race).toBeVisible();
  await expect(race.locator('ol > li')).toHaveCount(15);
  await expect(race.locator('ol > li .tier')).toHaveCount(15);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `screenshots/m5-${info.project.name}-race.png` });

  // In 2022 most platforms had not launched yet.
  const slider = page.getByRole('slider', { name: 'Date shown' });
  if (await slider.isVisible()) {
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(race).toContainText('not launched yet');
  }

  await race.getByRole('button', { name: 'Close the race' }).click();
  await expect(race).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(problems).toEqual([]);
});

test("what's new lists sourced launches", async ({ page }) => {
  const problems = watchConsole(page);
  await ready(page);
  const toggle = page.getByRole('button', { name: /What’s new/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const links = page.locator('#controls a[href^="https://"]');
  expect(await links.count()).toBeGreaterThanOrEqual(3);
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  expect(problems).toEqual([]);
});

test('the HQ panel follows the time machine', async ({ page }) => {
  const problems = watchConsole(page);
  await ready(page);
  const slider = page.getByRole('slider', { name: 'Date shown' });
  await slider.focus();
  await page.keyboard.press('Home'); // 2022-11-01: ChatGPT not launched yet (2022-11-30)
  const label = page.locator('.label[data-id="chatgpt"]');
  // Labels of unlaunched HQs are hidden; open ChatGPT once it exists (Page Up moves 10% ahead).
  await slider.focus();
  await page.keyboard.press('PageUp');
  await expect(page.locator('#hud')).toContainText('Tokens processed on 2023-');
  await label.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('#panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.panel__history')).toContainText('History · 2023-');
  await expect(panel).toContainText('Tokens on 2023-');
  await expect(panel).toContainText('At the time shown');
  // Numbers in the overview still carry tiers.
  const overview = panel.getByRole('tabpanel', { name: 'Overview' });
  const n = await overview.locator('.metric').count();
  await expect(overview.locator('.metric .tier')).toHaveCount(n);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  expect(problems).toEqual([]);
});
