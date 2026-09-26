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

async function openHq(page: Page, id: string): Promise<void> {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#loader')).toBeHidden();
  const label = page.locator(`.label[data-id="${id}"]`);
  await label.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#panel')).toBeVisible();
}

test('zoom interiors: every tab explains itself and every number carries a tier', async ({
  page,
}, info) => {
  const problems = watchConsole(page);
  await openHq(page, 'chatgpt');
  const panel = page.locator('#panel');
  const tabs = panel.getByRole('tab');
  await expect(tabs).toHaveCount(5);
  await expect(panel.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Keyboard: arrow keys move between tabs.
  await panel.getByRole('tab', { name: 'Overview' }).focus();
  await page.keyboard.press('ArrowRight');
  const offices = panel.getByRole('tab', { name: 'Offices' });
  await expect(offices).toHaveAttribute('aria-selected', 'true');
  await expect(offices).toBeFocused();
  const officesPane = panel.getByRole('tabpanel', { name: 'Offices' });
  await expect(officesPane).toBeVisible();
  await expect(officesPane).toContainText('not a staff count');
  await expect(officesPane.locator('.metric .tier')).toHaveCount(2);
  await expect(panel.locator('#offices-hardware')).not.toBeEmpty();
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `screenshots/m4-${info.project.name}-offices.png` });

  await panel.getByRole('tab', { name: 'Server hall' }).click();
  const hallPane = panel.getByRole('tabpanel', { name: 'Server hall' });
  await expect(hallPane).toContainText('not a count of real machines');
  await expect(hallPane).toContainText('Blackwell');
  await expect(hallPane.locator('.metric .tier')).toHaveCount(2);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `screenshots/m4-${info.project.name}-hall.png` });

  await panel.getByRole('tab', { name: 'Power & cooling' }).click();
  const powerPane = panel.getByRole('tabpanel', { name: 'Power & cooling' });
  const gauges = powerPane.locator('.gauge');
  await expect(gauges).toHaveCount(2);
  await expect(gauges.locator('.tier')).toHaveCount(2);
  await expect(gauges.first().locator('.metric__value')).toHaveText(/\d/);
  await expect(gauges.first().locator('.metric__range')).toContainText('range');
  // PUE and WUE come with their sources.
  await expect(powerPane.locator('.constant')).toHaveCount(4);
  await expect(powerPane.locator('.constant .tier')).toHaveCount(4);
  await expect(powerPane.locator('.constant__sources a').first()).toHaveAttribute(
    'href',
    /^https:\/\//,
  );
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `screenshots/m4-${info.project.name}-power.png` });

  await panel.getByRole('tab', { name: 'Model lab' }).click();
  const labPane = panel.getByRole('tabpanel', { name: 'Model lab' });
  const items = labPane.locator('.lab-list__item');
  expect(await items.count()).toBeGreaterThanOrEqual(3);
  await items.first().click();
  await expect(items.first()).toHaveAttribute('aria-pressed', 'true');
  const detail = labPane.locator('.lab-detail');
  await expect(detail).toContainText('Released');
  await expect(detail).toContainText('Context window');
  await expect(detail.locator('a')).toHaveAttribute('href', /^https:\/\//);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `screenshots/m4-${info.project.name}-lab.png` });

  // Back to the overview, then close.
  await panel.getByRole('tab', { name: 'Overview' }).click();
  await expect(panel.getByRole('tabpanel', { name: 'Overview' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('#labels')).not.toHaveClass(/labels--interior/);
  expect(problems).toEqual([]);
});

test('a platform without listed models says so in the lab', async ({ page }) => {
  const problems = watchConsole(page);
  await openHq(page, 'characterai');
  await page.locator('#panel').getByRole('tab', { name: 'Model lab' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Model lab' })).toContainText(
    'No models are listed',
  );
  expect(problems).toEqual([]);
});
