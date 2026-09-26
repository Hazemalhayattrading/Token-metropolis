# TASKS.md — Token Metropolis

Resume point for any fresh session. Source brief: `token-metropolis-prompt_1.md`.
Working agreement: `CLAUDE.md`. Decisions log: `DECISIONS.md`. Plan: `PLAN.md`.

Development branch: `claude/pensive-ptolemy-0qc6e6` (pushing to `main` deploys — not done without approval).

Quick orientation: `npm install && npm run check` (type-check, lint, format, tests, data + app build),
`npm run test:e2e` (Playwright, writes `screenshots/`), `npm run dev` (local site),
`npx tsx scripts/report.ts` (today's estimates per platform).

## Milestone 1 — Research & plan ✅

### Definition of Done

- [x] Top-15 platform list researched as of 2026-09-25 and justified in `DECISIONS.md` (D-030).
- [x] Every reported figure stored in `data/manual/*.yaml` with source URL, as-of date, access date and
      verification level (98 metrics, 83 models, 15 platforms).
- [x] Estimation model in `src/model/` as pure functions: tokens/day curve from anchors, cumulative
      tokens, diurnal/weekly traffic curve by regional mix, tokens/sec, GPU equivalents, MW, water,
      homes, equivalences, per-prompt energy/water — all with low/central/high ranges and a tier.
- [x] All constants in `src/model/constants.ts`, each with `{ value, low, high, source, accessed }`
      (plus unit, basis, verification, note).
- [x] Zod schemas validate the manual data; `scripts/build-data.ts` compiles YAML → `public/data/*.json`
      and refuses invalid data (exit 1, output untouched).
- [x] Unit tests cover determinism, monotonic counters, range ordering, tier logic, exact integration,
      data validation, and the real dataset (87 tests, all passing).
- [x] `PLAN.md`: architecture, file tree, data schema, methodology, visual concept, milestones, 3 extra
      ideas (Uncertainty glass chosen).
- [x] `METHODOLOGY.md` first draft; `UPDATING.md` first draft (manual figures).
- [x] Type-check, lint, format check, tests and data build green; committed and pushed.

## Milestone 2 — Skeleton ✅ (except going live, which needs the owner)

- [x] Vite + Three.js + TypeScript app shell; `index.html` with an inline-styled loader; `src/copy.ts`.
- [x] `src/data/load.ts`: fetch `public/data/*.json`, validate with the same Zod schemas as the build,
      cache the last good copy (localStorage, try/catch), fall back to it with a visible notice.
- [x] Clock + city model (`src/state/`); HUD with live global counters (today UTC, since you arrived,
      tokens/s, range, "data updated X ago"), tier badge, always-visible disclaimer footer.
- [x] Placeholder 3D scene (log-scaled tower per platform), render loop pauses when the tab is hidden,
      resize-aware framing for portrait screens; accessible data table doubles as the no-WebGL dashboard.
- [x] Fonts self-hosted from the Google Fonts files via `@fontsource` (D-004).
- [x] GitHub Actions: `ci.yml` (type-check, lint, format, unit tests, build, data-committed check, E2E +
      screenshots artifact) and `deploy.yml` (Pages on push to `main`). Vite `base` = `/Token-metropolis/`.
- [x] Playwright (1.56.1, matches the preinstalled Chromium): smoke + zero console errors/warnings,
      no-WebGL fallback, cached-data fallback; screenshots at 1440×900 and 390×844 in `screenshots/`.
- [ ] **Live on Pages** — blocked: needs merge to `main` and Pages source set to "GitHub Actions".

## Milestone 3 — City overview ✅

- [x] Fixed island layout (plots never move when data changes); 15 original campus typologies
      (`src/world/campus/typologies.ts`) with world-space procedural windows (`materials.ts`).
- [x] Load-driven campuses: log/true-scale height toggle, server halls with LED rows blinking with the
      live traffic curve, cooling towers with steam, substation feeder, trucks on a service loop.
- [x] Light streams from each region's horizon direction, weighted by regional user mix.
- [x] Day/night per HQ time zone (facade daylight + subtle local light pool); office occupancy drives
      lit windows; night sky with stars and moon; bloom; fog.
- [x] Keyboard-accessible labels with tier dots and collision handling (lift, compact, dot; avoid UI).
- [x] Picking + camera director (eased, interruptible flights; reduced motion = cuts); scene recentres
      beside the side panel / above the bottom sheet.
- [x] HQ info panel: tokens today, tokens/s, daily rate, since launch, GPU-eq, MW, water — each with
      tier badge and range; latest published figure with quote, date, source link and verification.
- [x] Two art-direction passes (see git history); E2E covers panel open/close and true scale.

### Known gaps carried forward

- Draw calls are not yet optimized (per-campus meshes, ~45 stream tubes) → quality governor in M8.
- "Homes powered" stays hidden until the EIA constant is verified.
- "How we estimate" links to METHODOLOGY.md on GitHub until the in-site page (M8).

## Milestone 4 — Zoom interiors ✅ (reviewed by a 4-dimension multi-agent workflow; 24 findings fixed)

- [x] Panel tabs (Overview · Offices · Server hall · Power & cooling · Model lab), ARIA tablist with
      arrow/Home/End keys; each tab flies the camera to a diorama anchored in the campus.
- [x] Interiors are a separate lazy chunk (`src/world/interiors/`), built for the selected campus only
      and disposed when it is deselected.
- [x] Offices: floors cut to the tower body (tower turns to glass); instanced desks and people; people
      follow load × local office hours; desk hardware bands (boxy → flat → holographic) from the daily
      rate; screens flicker with traffic. Copy: "Desks and people are a visual scale of load, not a
      staff count."
- [x] Server hall: rack rows grow with load, LEDs blink with the live traffic curve, LED colours and
      liquid-cooling pipes (flowing shader) follow the platform's likely accelerator class
      (`src/world/hardware.ts`); panel shows the class, note and sources.
- [x] Power & cooling: substation (moved beside the cooling towers) with a pulsing feeder, lit cooling
      tower lips and steam; live MW and water gauges on one shared log scale with tier + range; the
      formula; PUE/WUE/kW-per-GPU/throughput constants with tier, range, note, sources, checking level.
- [x] Model lab: display case of up to 12 most recent models (own = faceted gem in accent colour,
      offered = pale stone, flagship taller, newest glows); click a crystal or the accessible list →
      release date, context window, inputs, maker, source link, checking level.
- [x] Every pane is filled on open so no number ever sits without its badge.
- [x] E2E `tests/e2e/interiors.spec.ts` (desktop + mobile) + screenshots `m4-*`; two art passes.

### Multi-agent review (Ultracode) — 24 confirmed findings, all addressed

Interior cameras inside neighbouring HQs (others now step aside, D-046); office floors outside most
towers (per-seat fit, D-047); hall diorama buried in base buildings (base hides); true-scale stub
towers (interiors force log scale); Model-lab badges hard-coded Reported (D-043); Copilot's OpenAI
models credited to Microsoft; tokens/s tier (D-045); liquid-cooling claim for undisclosed fleets
(D-041); gauge scale changing with the time of day (D-042); traffic multiplier range + method; copy
("feeds the campus"); mobile sheet transform bug; focus lost on close; model detail scroll; clipped
tab focus ring; `--faint` contrast (now #8490a8); gauge tick size; interior load failure not reported
to the panel; shader compile stall (pre-compile); InstancedMesh buffers not disposed; stale bounding
spheres; `decadeScale` guard. 6 findings were rejected by the skeptics (see git history).

### Polish carried to M8

- Steam is faint at night; neighbouring light streams cross some interior views.
- Offices at night show few people (honest: local office hours) — consider a "working hours" hint.

## Milestone 5 — Time machine, race mode, launch events ✅

Built as a multi-agent workflow (Ultracode): three builders in isolated worktrees with strict file
ownership (time machine / launch effects / overlays), each branch reviewed by an adversarial skeptic;
integrated and art-directed in the main checkout.

- [x] Time machine (`src/state/timemachine.ts`, `src/ui/timeline.ts`): scrub 2022-11-01 → today, play
      at 1 week / 1 month / 1 quarter per second, Live button, History badge with the modeled-history
      note; the whole UI (world, panel, HUD, race, feed) reads the time machine; "since you arrived"
      stays on real time. In history the HUD shows the whole UTC day's total.
- [x] Launch events (`src/state/events.ts`, `src/world/launch.ts`): 72-hour launch day with soft beams,
      orbiting drones and a crowd on the front plaza (avoiding base buildings); a short pulse when
      playback crosses a launch; toasts; month-precision launches show as YYYY-MM and get no launch day.
- [x] "What's new" feed: latest 8 launches up to the time shown, "New" chips pinned first, sources.
- [x] Race mode (`src/state/race.ts`, `src/ui/race.ts`): 15 rows on one linear scale with range
      whiskers and tier chips, FLIP reordering with DOM order = rank, names open the HQ panel, method
      link; desktop fits all 15 rows; mobile bottom sheet.
- [x] Review findings fixed at integration: subscriber-notification race (generation guard), copy moved
      into `src/copy.ts`, event date precision, race → source path, feed Escape/focus/z-index/dot jitter,
      launch lamps/crowd inside base geometry, reduced-motion growth, frustum culling.
- [x] E2E `tests/e2e/time.spec.ts` (scrub to 2022, play/pause, live; race 15 rows with tiers; feed
      sources); screenshots `m5-*`; two art passes (race density, HUD daily totals, mobile layering).
- [x] Integration review (correctness, honesty, accessibility reviewers; cut short per D-051): the
      panel, labels and model lab now follow the time machine (D-052); launch pulses keyed to real
      playback; event kinds labelled and celebrated consistently (D-049); tier freshness only after a
      publication; race keeps keyboard focus while reordering; focus fallbacks when overlays close;
      no-WebGL layout; toasts never cover panels; race usable on short screens and above the
      timeline on phones; HUD "so far" wording and accessible name; data table says it is live.

## Milestone 6 — in progress

Wave 1 builders (isolated worktrees, disjoint files, own `copy.ts` sections; branched from 56f713b):
`m6-prompt` (prompt visualizer + token flight), `m6-glass-sound` (uncertainty glass + procedural
sound), `m6-incidents-tour` (incident banner/alarm + cinematic tour), `m6-discoveries-share` (40
discoveries + tracker + share card). Integration hooks already on the branch: `campus.pulseHall`,
`campus.setFlicker`, `campus.setGlassMode`, `world.captureFrame`, `world.tourTo`, page roots
`#prompt`, `#incidents`, `#tour`. Full multi-agent review after integration (D-051).

- [x] Compare mode (built directly): split-screen viewports with one camera + bloom pipeline each,
      metrics card per column with ranges, tiers and the latest source; phones use half-height columns.
- [x] "Since you arrived" equivalences: words, electricity, cooling water (range + tier each).
- [x] Uncertainty glass + sound merged and wired (control-row toggles, legend, status line) — D-053/54.
- [x] Incident banner + alarm beacons/flicker (live clock only, 3-day staleness) — D-055.
- [x] Cinematic tour after 30 s idle (captions with tiers; any input stops it) — D-056.
- [x] Prompt visualizer: lazy o200k tokenizer, "Exact" count chip, Modeled energy/water, token
      flight framed on the hall; beside the HQ panel on wide screens, shared slot otherwise — D-057.
- [x] Hidden details: island props (deferred ~0.5 s after start), interior props via the interiors'
      `decorate` hook, picking (campus box wins when nearer), tracker + chip, "Found" toast — D-060.
- [x] Share card from the control row (city) and the HQ panel header (that HQ, cropped to the free
      area); `state/sharecard.ts` builds title/subtitle/figures with tiers and ranges — D-061.
- [x] Fixed on the way: builds dropped the standard `backdrop-filter` (no blur in Chrome) — D-062;
      phone popovers were clipped by the scrolling control strip — D-063; hovering a hidden detail
      left the last HQ highlighted.
- [x] E2E: glass, incidents, sound, tour, prompt (count, tiers, send + landing), hidden details
      (stored progress, list, reset), share (city + HQ).
- [x] Final M6 screenshots (desktop + mobile) and second art pass over every M6 feature.
- [x] Full multi-agent review (4 dimensions + adversarial verify, D-051): 40 findings, 34 survived
      verification, all fixed (D-067): compare framing/min-two/Add button/scope/figure, overlay
      layering at 390/1024/1440, tour etiquette, prompt worker tokenizer and send guards, glass
      floor, alarm rule, keyboard "Show me" path for hidden details, idle-built props, shader
      pre-compilation, focus fallbacks.

## Milestone 7 — data pipeline (done; review fixes applied)

Definition of done: scheduled workflow (daily or better) + manual run; public key-free sources;
normalized into `public/data`; validated with Zod; a failing source keeps its previous data and is
logged; commits only on change → Pages redeploys; no secrets; `UPDATING.md` covers it; tests.

- [x] `scripts/update-data.ts` (CLI) + `scripts/pipeline.ts` (core) + `src/data/feeds.ts`
      (normalizers): status `summary.json` → `incidents.json` (with `checked` time, component
      filter for shared pages); OpenRouter models → `data/auto/sightings.json` — D-064/65.
- [x] `build-data` validates pipeline files, merges sightings (minus curated and hidden ones),
      keeps notices out of "Data updated" — D-066.
- [x] `update-data.yml` hourly + manual (force-deploy option), early exit, retry when `main` moved,
      calls `deploy.yml` (now `workflow_call`).
- [x] Site: notices show "Status as of HH:MM UTC", hide after 3 h without a read, say when a fix
      is in place.
- [x] Light review (correctness + data honesty, D-051): 21 findings, all addressed (variant dates,
      Copilot component filter, whole-version name matching, freshness, hidden list, JSON errors,
      push race, maintenance start/impact, synthetic test fixtures, deploy retry).
- [ ] Not verifiable here: live fetches (the sandbox proxy answers 403 to every feed). First real
      run happens on GitHub after merge to `main`; check its "Data update" summary.

## Milestone 8 — polish & hardening (next)

Definition of done (brief §7, §10): adaptive quality governor (frame-time driven: pixel ratio,
bloom, effects); 60 fps desktop / 30 fps phone targets (measure what can be measured here);
fallbacks (no WebGL, reduced motion = calm mode, offline/failed fetch, tab hidden, resize,
long names); accessibility pass (keyboard + screen reader through the data view, AA contrast,
visible focus); in-site methodology page mirroring METHODOLOGY.md, with every "How we estimate"
link pointing to it; Lighthouse ≥ 90 on Performance (2D view), Accessibility, Best Practices, SEO;
copy review; final art passes; README; full multi-agent review (D-051).

Known items to fold in:

- Mobile HUD hides `.counter__range` (plausible range under the big counter) — show it.
- `src/ui/links.ts` METHODOLOGY_URL → the in-site page.
- Final summary per platform: what is Reported vs Estimated vs Modeled; known limitations.

## Blocked (needs the owner)

- **Deploys:** GitHub Pages needs a push to `main` and Pages enabled in the repo settings.
- **Research capacity:** this session's web-search budget (200) is spent and most primary domains are
  blocked by the environment's network policy (e.g. eia.gov, loc.gov, wikipedia.org, openai.com,
  blog.google, about.fb.com, similarweb.com). To finish verification: raise the session search budget
  and/or allow those domains in the environment's network settings, then work through the list below.

## Verification backlog (items not checked on the source page)

### Constants pending (hidden from the UI by code until verified)

- `EQUIV.householdKw` — EIA FAQ id=97 (annual kWh per US residential customer) → "homes powered"
- `EQUIV.locBooks` — Library of Congress general information (cataloged books)
- `EQUIV.enWikipediaWords` — Wikipedia: Size of Wikipedia
- `EQUIV.wordsSpokenPerDay` — Mehl et al. 2007, Science 317:82
- `EQUIV.lifeExpectancyYears` — UN World Population Prospects 2024

### Pending launch dates / HQ locations / models / status pages

- Launch dates: Gemini (Bard 2023-03-21), Meta AI (2023-09-27), Tencent Yuanbao (2024-05-30), Cursor
  (2023, year only), Character.AI (2022-09-16 — year verified), Kimi (2023-10-09).
- HQ locations (city-level, coordinates approximate): ChatGPT, Gemini, Doubao, Qwen, GitHub Copilot,
  Yuanbao, Cursor, Character.AI, Kimi.
- Models: GPT-3.5, GPT-4, GPT-4o, GPT-5 (OpenAI pages), Bard, Llama 3 / 3.1 / 4, GPT-4 in Bing Chat,
  GPT-5 in Copilot, DeepSeek-V3 (day), DeepSeek-R1.
- Status pages: status.claude.com, status.deepseek.com (the pipeline must treat them as optional).

### Model data to re-check (flagged during the provenance curation)

- `grok-1`: marked page-verified, but its source (the open-weights README) does not state 2023-11-04.
- `bing-chat-gpt-4`: the 2023-02-07 source says "a next-generation OpenAI model", not GPT-4 (confirmed
  2023-03-14).
- `qwen3-5`: sourced from the QwenLM/Qwen3.8 README rather than a Qwen3.5 page.
- `copilot-gpt-5`: only the quarter (Jul–Sep 2025) is confirmed; stored at month precision.

### Snippet-only metrics

About 70 metrics were verified from search-result summaries only (`verified: snippet`); the data build
prints them as warnings. Priority re-checks: ChatGPT WAU series, OpenAI API tokens/minute, Gemini app
MAU, Doubao token series, Grok S-1 figures, Perplexity queries, Cursor ARR.

## Data gaps worth closing (would change the city)

1. **Google's all-surface monthly token totals** (reported at I/O 2025 and on earnings calls, incl.
   Search). Not verifiable during research, so Gemini currently counts only the app + customer API and
   is a large underestimate. Add as a Gemini component once verified.
2. Alibaba Cloud / Qwen API token volumes; Qwen inside Quark and other Alibaba apps.
3. xAI API usage (Grok is consumer-only today); Moonshot API usage.
4. Meta AI absolute users in 2026 (only relative growth found).
5. Character.AI 2025–26 usage (after the under-18 changes) and its model lineup.
6. Cursor usage (tokens, requests or DAU from a primary source) and its own models.
7. Regional splits (Similarweb) for most platforms; China's national daily token totals.
8. Anything newer than: OpenAI API (Mar 2026), Google API (Apr 2026), Doubao (Jun 2026).

## Newly found

- Shell network egress is restricted to package registries; live source endpoints (OpenRouter, status
  pages) are unreachable from this container. The daily pipeline will run on GitHub Actions.
- `typescript-eslint` does not yet support TypeScript 7 → pinned TS 6.0 (D-011).
