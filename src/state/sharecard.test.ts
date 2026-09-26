import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../copy';
import { validateDataset } from '../data/validate';
import {
  cumulativeTier,
  dailyRate,
  globalDailyRate,
  instantTier,
  rateTier,
} from '../model/estimate';
import { isoToDays } from '../model/time';
import { humanNumber } from '../ui/format';
import { buildCity } from './city';
import { shareCardText } from './sharecard';

const read = (f: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'data', f), 'utf8')) as unknown;
const result = validateDataset(
  {
    platforms: read('platforms.json'),
    metrics: read('metrics.json'),
    models: read('models.json'),
  },
  { expectedPlatforms: 15 },
);
if (!result.ok) throw new Error(result.errors.join('\n'));
const city = buildCity(result.data);
const now = isoToDays('2026-09-25T14:30:00Z');

describe('shareCardText', () => {
  it('describes the whole city with the HUD’s figures, each with a range and a tier', () => {
    const card = shareCardText(city, { t: now, liveNow: now, history: false, platformId: null });
    expect(card.title).toBe(COPY.share.cityTitle(15));
    expect(card.subtitle).toBe(COPY.share.subtitle('2026-09-25', '14:30', false));
    expect(card.stats.map((s) => s.label)).toEqual([
      COPY.hud.todayLabel,
      COPY.hud.rateLabel,
      COPY.panel.perDay,
    ]);
    for (const s of card.stats) {
      expect(s.value).toMatch(/\d/);
      expect(s.range).toMatch(/^range .+ – .+/);
      // Sums of estimates are calculations: never Reported.
      expect(s.tier).not.toBe('reported');
    }
    const day = globalDailyRate(city.platforms, now);
    expect(card.stats[2]!.value).toBe(`${humanNumber(day.central)} ${COPY.share.perDay}`);
  });

  it('describes one HQ with the panel’s figures and tiers', () => {
    const pm = city.byId.get('chatgpt')!;
    const card = shareCardText(city, {
      t: now,
      liveNow: now,
      history: false,
      platformId: 'chatgpt',
      view: 'hall',
    });
    expect(card.title).toBe(`${pm.platform.name} · ${COPY.views.hall}`);
    expect(card.stats.map((s) => s.label)).toEqual([
      COPY.panel.today,
      COPY.panel.now,
      COPY.panel.perDay,
      COPY.panel.sinceLaunch,
    ]);
    expect(card.stats.map((s) => s.tier)).toEqual([
      instantTier(pm, now),
      instantTier(pm, now),
      rateTier(pm, now),
      cumulativeTier(pm, now),
    ]);
    expect(card.stats[2]!.value).toBe(
      `${humanNumber(dailyRate(pm, now).central)} ${COPY.share.perDay}`,
    );
  });

  it('uses the time machine’s labels in history, and says when an HQ had not launched', () => {
    const t = isoToDays('2023-03-01T12:00:00Z');
    const card = shareCardText(city, { t, liveNow: now, history: true, platformId: null });
    expect(card.subtitle).toBe(COPY.share.subtitle('2023-03-01', '12:00', true));
    expect(card.stats[0]!.label).toBe(COPY.time.todayLabelHistory('2023-03-01'));
    expect(card.stats[1]!.label).toBe(COPY.time.rateLabelHistory);

    // Pick an HQ with no traffic yet on that date: no numbers, so no tiers.
    const unlaunched = city.platforms.find((p) => !(dailyRate(p, t).central > 0))!;
    expect(unlaunched).toBeDefined();
    const hq = shareCardText(city, {
      t,
      liveNow: now,
      history: true,
      platformId: unlaunched.platform.id,
    });
    expect(hq.stats).toEqual([]);
    expect(hq.subtitle).toContain(COPY.time.notLaunched);
  });

  it('labels a history day that is still under way as “so far”', () => {
    const t = now - 0.1; // earlier today, in the time machine
    const card = shareCardText(city, { t, liveNow: now, history: true, platformId: 'claude' });
    expect(card.stats[0]!.label).toBe(COPY.time.panelDaySoFar('2026-09-25'));
    const whole = shareCardText(city, { t, liveNow: now, history: true, platformId: null });
    expect(whole.stats[0]!.label).toBe(COPY.time.todayLabelHistorySoFar('2026-09-25'));
  });
});
