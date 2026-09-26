# PLAN.md — Token Metropolis

A living 3D night city where each of the world's 15 biggest AI platforms is a company headquarters,
sized and lit by how many tokens it processes. Built to be honest first and beautiful second — and to
make those two things the same thing.

- Brief: `token-metropolis-prompt_1.md` · Working agreement: `CLAUDE.md`
- Status & resume point: `TASKS.md` · Decisions: `DECISIONS.md` · Method: `METHODOLOGY.md`

---

## 1. Architecture

```
            ┌──────────────── build time ────────────────┐        ┌──────────── browser ────────────┐
 data/manual/*.yaml ──► scripts/build-data.ts ──► public/data/*.json ──► src/data/load.ts (Zod, cache)
 (human-curated,         (Zod + cross-refs +         (static, GitHub       │
  every figure sourced)   model smoke test;           Pages)                ▼
                          refuses invalid data)                       src/model/* (pure, deterministic)
 GitHub Actions (daily) ─► scripts/update-data.ts ───────┘                  │  curves, counters, ranges, tiers
  OpenRouter models, status feeds, RSS                                      ▼
  (keeps previous data on any failure)                          src/state (store + clock: live / time machine)
                                                                            │
                                     ┌──────────────────────────────────────┼─────────────────────────┐
                                     ▼                                      ▼                         ▼
                           src/world (Three.js)                     src/ui (DOM panels)       src/fallback (2D
                           city, campuses, interiors,               counters, badges, time     dashboard, no
                           camera director, effects,                machine, race, compare,    WebGL) + a11y
                           quality governor                         prompt, share card         data view
```

Principles:

- **The model is pure** (`src/model/`): no DOM, no Three.js, no randomness, no `Date.now()` inside.
  Every UI number comes from it with a range, a tier, a formula and refs to its sources.
- **Deterministic counters.** Live numbers are closed-form integrals of a piecewise-exponential growth
  curve times a Fourier traffic shape, computed with our own IEEE-754-only `exp/log/sin/cos`
  (`detmath.ts`), so every device shows the same digits at the same instant.
- **Static hosting only.** No backend, no keys in the client. Freshness comes from a daily GitHub Action
  that commits validated JSON; Pages redeploys.
- **Progressive loading.** The overview city ships first; interiors (offices, server hall, power, model
  lab), the tokenizer, audio and the share-card renderer are dynamic imports.
- **Graceful degradation.** No WebGL → 2D dashboard with identical data. `prefers-reduced-motion` →
  calm mode (cuts instead of flights). Offline / failed fetch → last cached data + notice.

## 2. File tree (target)

```
index.html
public/
  data/          platforms.json metrics.json models.json events.json incidents.json meta.json
  favicon.svg  robots.txt  og.png
data/manual/     platforms.yaml metrics.yaml models.yaml       ← edit these to update figures
scripts/         build-data.ts  update-data.ts  (fetchers/)     screenshots.ts
src/
  main.ts        boot: capability detection → 3D or 2D
  copy.ts        every UI string
  model/         detmath range tier time traffic growth integrate estimate derived equivalences constants
  data/          schema.ts validate.ts load.ts (fetch + validate + cache fallback)
  state/         store.ts clock.ts url.ts
  world/         renderer.ts post.ts city/ campus/ interiors/ effects/ camera/ governor.ts picking.ts
  ui/            hud/ panels/ badge.ts counter.ts timeline.ts race.ts compare.ts prompt.ts share.ts tour.ts
  audio/         procedural WebAudio ambience, hum, fanfare
  fallback/      dashboard.ts (SVG/DOM)
  styles/        tokens.css base.css components.css
tests/e2e/       Playwright: smoke, screenshots (1440×900, 390×844), a11y, no-WebGL, reduced motion
.github/workflows/ ci.yml deploy.yml update-data.yml
README.md PLAN.md DECISIONS.md UPDATING.md METHODOLOGY.md TASKS.md
```

## 3. Data schema (validated with Zod — `src/data/schema.ts`)

| File                                | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `platforms.yaml` → `platforms.json` | id, name, parent, **scope** (exactly which products/APIs the HQ counts), usage profile, HQ (city, lat/lon, IANA timezone), launch (date + source), regional user mix (5 regions, sourced or marked assumption), **components** (e.g. "consumer app", "API") each with a usage profile, optional start date, `routedShare` (tokens actually served by another listed platform — used to de-duplicate the global total) and constant overrides; hardware class; status page + feeds; original identity (palette, architecture, motif). |
| `metrics.yaml` → `metrics.json`     | Every published figure: kind (tokens / requests / users / revenue / other), value, period or user window, qualifier ("over", "about"…), as-of date, scope, **exact quote**, primary vs third-party, source (title, publisher, URL, published), accessed date, verification (page / snippet). A metric that names a component becomes an **anchor** on that component's curve; others are context.                                                                                                                                    |
| `models.yaml` → `models.json`       | Model lineup per platform: name, release date, context window, modalities, flagship flag, source. Feeds the model lab and launch events.                                                                                                                                                                                                                                                                                                                                                                                             |
| `events.json`                       | Derived: model launches (and later, manual milestones).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `incidents.json`                    | Written by the daily pipeline from official status feeds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `meta.json`                         | `lastUpdated` (changes only when content changes), content hash, counts, constants pending verification.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/model/constants.ts`            | Every assumption: `{ value, low, high, unit, basis, source, accessed, verified, note }`.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## 4. Estimation methodology (summary — full text in `METHODOLOGY.md`)

1. **Anchors.** Each sourced figure becomes tokens/day at its date:
   `tokens` ÷ days in period · `requests` × tokens/request · `users` × DAU share × requests/DAU ×
   tokens/request (or × tokens/user-day for agentic coding) · `revenue` × metered share ÷ price/token.
2. **Tier of an anchor** = weakest input: primary figure → Reported; third-party figure or published
   benchmark → Estimated; any judgement constant → Modeled.
3. **Curve.** Piecewise-exponential through anchors; seed ramp from launch; after the last anchor,
   damped extrapolation at the fitted recent growth, with a band that widens with time.
   "Reported" is shown only within 14 days of a reported figure; everything else says what it is.
4. **Live counter.** `total(t) = ∫ rate(s)·shape(s) ds` in closed form, where `shape` is the platform's
   24 h/7 d traffic curve (user-weighted by region, local time). Tokens today = since 00:00 UTC.
5. **Hardware.** GPU-equivalents = tokens/s ÷ throughput per GPU; MW = GPUs × kW × PUE; water =
   kWh × WUE; homes = kW ÷ household kW. Always Modeled (throughput transfer is the largest uncertainty).
6. **Ranges** propagate as log-normal 90% intervals (quadrature on log scale, asymmetric sides kept).
7. **Global total** de-duplicates tokens that one listed product routes to another's models.
8. **Cross-checks.** Published per-prompt energy (Google 0.24 Wh, OpenAI 0.34 Wh) must fall inside our
   per-prompt range — enforced by a unit test.

## 5. Visual concept — "Night Shift"

A stylized island city at night, seen from a slow-orbiting aerial camera. The sea is dark ink; data
arrives as thin light streams from the horizon in the directions of the world's regions. Each HQ is an
original architectural typology with its own palette — no logos, wordmarks, mascots or brand colours.

- **Lighting language:** cool moonlit ambient, warm window light, one accent colour per campus used
  sparingly (crown, beacons, stream). Selective bloom on emissives only; light exponential fog for
  depth; no glow soup.
- **Load drives everything:** tower height (log scale; "true scale" toggle), lit-window fraction
  follows the platform's local traffic curve, server-hall count, cooling-tower steam, substation line
  pulses, truck frequency, stream density.
- **Day/night per HQ timezone:** each campus has its own sky tint and window schedule; Asia lights up
  while the Americas sleep.
- **Typography:** display — _Fraunces_ (editorial, variable optical size); UI — _IBM Plex Sans_ with
  tabular numerals. **UI:** dark glass panels, hairline borders, tier badges as small solid chips
  (green Reported / amber Estimated / grey Modeled) that always open the source and formula.
- **Motion:** every camera move is an eased, interruptible spring; UI numbers tween; nothing snaps.

Campus typologies (original designs, see `platforms.yaml` for palettes): ring-plaza monolith,
twin helical spires, terraced garden library, low lattice-canopy campus, cantilevered slab stack,
brutalist forge with power plant, sunken-atrium well tower, domed observatory, tiered eave tower,
honeycomb megastructure, crescent tower, marquee amphitheatre, sawtooth workshop halls, blade wedge,
lantern tower.

## 6. The features that make people stay

Time machine (Nov 2022 → today, cinematic play), launch events (72 h spotlight + "What's new"), race
mode (bar-chart race synced to time), your prompt visualized (client tokenizer, token flight into a
rack, per-prompt energy/water ranges), "since you arrived" counter with rotating equivalences, incident
mode from official status feeds, compare mode (2–3 split-screen campuses), cinematic tour after 30 s
idle, 40 hidden discoveries with a local tracker, share card with tier badges intact, procedural sound
(off by default, volume follows zoom).

### Three more original ideas

1. **Uncertainty glass (build this one).** Toggle "show uncertainty": every tower becomes a solid core
   at the _low_ estimate wrapped in a frosted glass shell up to the _high_ estimate, with a thin light
   ring at the central value. Modeled platforms look visibly foggier than Reported ones. The city
   literally shows its error bars — the most honest possible data-viz gesture, and it looks stunning at
   night. Cheap to build (a second instanced shell per tower), reinforces the site's credibility.
2. **Token weather.** A forecast-style overlay: isobars of tokens/s over the island, "high pressure
   over Hangzhou at 14:00 UTC", and a 24 h forecast strip. Honest because the traffic model is
   deterministic — a forecast is just the model evaluated ahead.
3. **Shift change.** A day/night terminator sweeps across a world-ring around the island; as each
   region wakes, a wave of commuter light-streams flows into the HQs whose users live there, showing
   each platform's regional mix as motion.

**Choice:** Uncertainty glass — it turns the project's core principle (ranges, not false precision)
into its most memorable visual.

## 7. Performance, accessibility, robustness plan

- Instanced meshes for windows, desks, racks, people, trucks; merged static geometry per campus;
  LOD (interiors only when zoomed); frustum culling; texture atlas for window/emissive patterns.
- Adaptive quality governor: rolling frame-time average → steps pixel ratio, bloom, shadow, particle
  and instance budgets down/up with hysteresis.
- Render loop pauses when the tab is hidden; counters are computed from the clock, not accumulated,
  so they are correct after resuming.
- A parallel accessible data view (table of every metric with tier, range, formula, source link),
  keyboard navigation across HQs, visible focus rings, WCAG AA contrast checked in CI.
- Loading: inline critical CSS + a designed skyline loader; data JSON is small; Three.js chunk split.

## 8. Milestones

1. **Research & plan** — platform list, sourced data, estimation model with unit tests, this plan. ✅ (see TASKS.md)
2. **Skeleton** — Vite/TS/Three, data loading + validation + cache fallback, CI + Pages deploy pipeline.
3. **City overview** — 15 campuses driven by data, day/night per timezone, live counters, info panels with tier badges.
4. **Zoom interiors** — offices, server hall, power/cooling, model lab.
5. **Time machine + race mode + launch events.**
6. **Prompt visualizer, compare, incidents, tour, discoveries, share card, sound, uncertainty glass.**
7. **Automated data pipeline** + `UPDATING.md`.
8. **Polish & hardening** — governor, fallbacks, accessibility, mobile, copy review, art-direction passes, Lighthouse.
