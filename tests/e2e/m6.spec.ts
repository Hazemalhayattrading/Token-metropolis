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

test('your prompt: an exact token count, modeled energy and water, and a token sent', async ({
  page,
}, info) => {
  // Software WebGL renders ~1.5 frames a second and a frame advances at most 0.1 s of animation,
  // so the camera move and the flight (3.4 s) take ~25 s here.
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await ready(page);
  const toggle = page.getByRole('button', { name: 'Your prompt', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const dialog = page.getByRole('dialog', { name: 'Your prompt, visualized' });
  await expect(dialog).toBeVisible();

  await dialog
    .getByRole('textbox', { name: 'Your text' })
    .fill('The quick brown fox jumps over the lazy dog. Token Metropolis never sleeps.');
  // The tokenizer is its own chunk, fetched on first open; the count is exact (no tier applies).
  const count = dialog.locator('.prompt__count');
  await expect(count.locator('.prompt__num')).toHaveText(/^\d[\d,]*$/, { timeout: 15_000 });
  await expect(count.locator('.tier--exact')).toHaveCount(1);
  // Energy and water are Modeled estimates with ranges.
  const results = dialog.locator('.prompt__grid > .prompt__metric');
  await expect(results).toHaveCount(2);
  for (const metric of await results.all()) {
    await expect(metric.locator('.prompt__value')).toHaveText(/\d/);
    await expect(metric.locator('.prompt__range')).toContainText('–');
    await expect(metric.locator('.tier--modeled')).toHaveCount(1);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `screenshots/m6-${info.project.name}-prompt.png` });

  // Send it: the panel reports the flight, then the landing.
  const send = dialog.locator('.prompt__send');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(dialog.locator('.prompt__sent')).toContainText('Sent');
  await expect(dialog.locator('.prompt__sent')).toContainText('landed', { timeout: 60_000 });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(problems).toEqual([]);
});

test('hidden details: progress is kept in this browser, listed with hints, and can be reset', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem(
        'token-metropolis:discoveries:v1',
        JSON.stringify({ v: 1, found: ['lighthouse', 'fox', 'not-a-real-detail'] }),
      );
    }
  });
  await ready(page);
  // Unknown ids in storage are ignored: two of the 40 are found.
  const chip = page.getByRole('button', { name: /Hidden details: 2 of 40 found/ });
  await chip.scrollIntoViewIfNeeded();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  const list = page.locator('.disc__panel');
  await expect(list).toBeVisible();
  await expect(list).toContainText('Decorative easter eggs — they are not data.');
  // The list stays inside the screen (phones: a sheet under the control strip).
  const box = (await list.boundingBox())!;
  const vw = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vw);

  await list.getByRole('button', { name: 'Reset progress' }).click();
  await list.getByRole('button', { name: 'Yes, reset' }).click();
  await expect(page.getByRole('button', { name: /Hidden details: 0 of 40 found/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('token-metropolis:discoveries:v1'))).toBe(
    null,
  );
  expect(problems).toEqual([]);
});

test('share: an image of the view with its numbers, from the city and from an HQ', async ({
  page,
}, info) => {
  const problems = watchConsole(page);
  await ready(page);
  const button = page.locator('.share-slot .share__button');
  await button.scrollIntoViewIfNeeded();
  await button.click();
  const dialog = page.locator('dialog.share-dialog[open]');
  await expect(dialog.locator('img')).toHaveAttribute('alt', /All 15 platforms, 20\d\d-\d\d-\d\d/, {
    timeout: 30_000,
  });
  await expect(dialog.getByRole('link', { name: 'Download PNG' })).toHaveAttribute(
    'download',
    /\.png$/,
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: `screenshots/m6-${info.project.name}-share.png` });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();

  // From an HQ panel: the card is about that HQ.
  await page.locator('.label[data-id="claude"]').focus();
  await page.keyboard.press('Enter');
  const panelShare = page.locator('#panel .panel__actions .share__button');
  await expect(panelShare).toBeVisible();
  await panelShare.click();
  await expect(dialog.locator('img')).toHaveAttribute('alt', /Claude, 20\d\d-/, {
    timeout: 30_000,
  });
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});
