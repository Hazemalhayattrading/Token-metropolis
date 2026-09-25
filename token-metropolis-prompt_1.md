# TOKEN METROPOLIS — Master Build Prompt

> Paste everything below into a fresh Claude Code session (Max effort) in a new empty repo named `token-metropolis`.

---

## 0. Who you are and how you work

You are a world-class product team compressed into one agent: creative director, 3D/WebGL engineer, data journalist, systems architect, motion designer, sound designer, accessibility specialist, QA lead. The bar is "an award-winning interactive piece from a top newsroom's graphics desk crossed with a AAA game menu." Nothing ships that looks like a template.

Working rules:

1. **Plan first.** Before writing code, produce `PLAN.md`: architecture, file tree, data schema, estimation methodology, visual concept, milestone list. Then build milestone by milestone.
2. **Every milestone ends green:** type-check passes, tests pass, production build succeeds, zero console errors/warnings, Playwright screenshot check at desktop (1440×900) and mobile (390×844), then commit and push. The site deploys to GitHub Pages on push to `main`.
3. **Never ask me to do something you can do yourself.** If blocked on a real decision, pick the best option, write it in `DECISIONS.md`, and continue.
4. **Look at your own output.** After each visual milestone, take screenshots, inspect them critically as a demanding art director, list what's weak, fix it, re-screenshot. Minimum two polish passes per visual milestone.
5. **Do the research yourself** with web search. Record every source URL and the date you accessed it.

---

## 1. The concept

A living 3D city where each of the world's 15 biggest AI platforms is a **company headquarters**. The size and intensity of each HQ is driven by how many tokens that platform processes per day. More tokens → more employees at desks, more advanced hardware, bigger server halls, more power, more cooling, more trucks, more lights, more noise.

Visitors should land, gasp, and then stay 20+ minutes exploring, comparing, scrubbing through time, and discovering details.

Working title: **Token Metropolis**. (You may propose a better name in `DECISIONS.md`.)

---

## 2. Data honesty — THE most important section

Most AI companies do **not** publish daily token volumes. The site's credibility depends on handling this perfectly. Violating this section is the single worst possible flaw.

### 2.1 Three tiers of data, always visibly labeled

| Tier | Meaning | UI badge |
|---|---|---|
| **Reported** | The company (or a primary source like OpenRouter's public stats) published the figure. | Solid green "Reported" + source link + date |
| **Derived** | Calculated from reported inputs (e.g., reported weekly active users × published/benchmarked tokens-per-user). | Amber "Estimated" + formula shown |
| **Modeled** | Illustrative assumption where no public data exists. | Grey "Modeled" + explanation of the assumption |

### 2.2 Rules

- Never display a number as fact that isn't reported. Every number on screen is one click/tap from its source and method.
- Show ranges (low / central / high), not false precision. The live counter uses the central value; the info panel shows the range.
- A permanent **"How we estimate"** page explains the whole methodology in plain language, with every assumption, every formula, and every source.
- Visible footer: "Independent project. Not affiliated with, endorsed by, or sponsored by any company shown. Figures are estimates unless marked Reported."
- **No company logos, wordmarks, or brand mascots.** Use the platform's name in plain text plus an original color and architectural identity you design. (Trademark safety.)
- The "live" counters are **deterministic interpolation**: `total(t) = total_at_snapshot + ∫ rate(t) dt`, where `rate` follows a daily traffic curve. Every visitor at the same moment sees the same number. Never use random jitter presented as real data (cosmetic particle effects are fine).

### 2.3 Estimation model (implement in `src/model/` as pure, unit-tested functions)

For each platform, from the best available inputs:

- `tokensPerDay` — from reported figures, or derived from users × sessions × tokens-per-session, with sources for each factor.
- `cumulativeTokens` — integrated from the platform's public launch date using a documented growth curve fitted to known data points (reported milestones anchor the curve).
- `tokensPerSecond = tokensPerDay / 86400`, modulated by a 24h global traffic curve weighted by the platform's regional user mix.
- `gpuEquivalents` — tokens/sec ÷ assumed throughput per accelerator (cite benchmark sources; state the assumption clearly, it's the biggest uncertainty).
- `powerMW = gpuEquivalents × kW_per_accelerator × PUE` (cite PUE sources).
- `waterLitersPerDay` via published WUE figures.
- `homesPowered`, `equivalents` (e.g., "tokens today = N× every book in the Library of Congress") — each equivalence cites its constant.

All constants live in one file, `src/model/constants.ts`, each with `{ value, low, high, source, accessed }`.

---

## 3. The 15 platforms

Research the current top 15 by usage **as of today** and justify the list in `DECISIONS.md`. Starting candidates to verify (replace any that no longer belong):

ChatGPT, Gemini, Claude, Meta AI, Microsoft Copilot, Grok, DeepSeek, Perplexity, Qwen, Doubao, Mistral Le Chat, Kimi, Character.AI, GitHub Copilot, Cursor.

For each platform store: name, parent company, HQ city + coordinates + timezone, launch date, current flagship models (with release dates), model history timeline, reported metrics with sources, regional user mix, an original color palette, an architectural style for its HQ.

---

## 4. Keeping it current (automated, no backend)

Static site on GitHub Pages. Freshness comes from a **GitHub Actions scheduled workflow** (daily) that:

1. Pulls public, key-free sources (e.g., OpenRouter's public models endpoint for new model releases; official status-page JSON feeds for incidents; official changelog/news RSS where available).
2. Normalizes into `public/data/*.json` (`platforms.json`, `models.json`, `events.json`, `incidents.json`, `meta.json` with `lastUpdated`).
3. Validates against a JSON schema (Zod). **If validation fails or a source is unreachable, keep the previous data and log it — never publish broken or empty data.**
4. Commits only when something changed → Pages redeploys.

Manual metrics (reported figures that need human judgment) live in `data/manual/*.yaml`, each entry with source + date. Document the "how to update" steps in `UPDATING.md` so I can refresh a figure in 2 minutes from my phone.

No API keys in the client. No secrets required for the default pipeline. The site shows "Data updated X hours ago" and a "What's new" feed of model launches.

---

## 5. The world — visual and interaction design

### 5.1 City overview
- A night-time 3D city (Three.js + TypeScript, Vite). 15 HQ campuses arranged on a stylized island/grid. Building scale uses a **log scale** so small platforms are still visible, with a toggle to "true scale" that makes the giants brutally obvious.
- Each campus reflects its load: tower height, window lights, rooftop antennas, server hall count, cooling towers with steam, power substation with glowing lines, delivery trucks bringing GPUs, data "light streams" flowing in from the edges of the world map.
- Real-time day/night per HQ timezone; traffic intensity follows the global usage curve (you can watch Asia wake up and the Asian platforms light up).

### 5.2 Zoom into a company (seamless camera flight, no page loads)
- **Office floors:** instanced employees at desks. Headcount scales with load. Desk hardware tiers visibly upgrade (old monitors → sleek multi-screen rigs → holographic displays). Employees type faster at peak hours.
- **Server hall:** rows of racks, blinking LEDs synced to tokens/sec, liquid-cooling pipes with flowing shaders, rack generation reflects the platform's likely accelerator class.
- **Power & cooling:** substation, transformer hum, cooling towers, a live MW gauge and water gauge.
- **Model lab:** a trophy wall / display case of the platform's model lineup; the newest model glows. Click one → release date, context window, modalities, source.
- **Info panel:** tokens today, tokens since launch, tokens/sec, GPU equivalents, MW, water, all with tier badges and ranges.

### 5.3 The features that make people stay
1. **Time machine:** a scrubber from Nov 2022 to today. Watch the city grow from one small building (ChatGPT) into a metropolis. Model launches fire as events. Play button with cinematic speed.
2. **Launch events:** when a new model appears in the data, the HQ gets a launch-day animation (spotlights, drones, crowd) for 72h, and it's pinned in the "What's new" feed.
3. **Race mode:** animated bar-chart race of daily tokens over time, synced with the time machine.
4. **Your prompt, visualized:** type or paste text → real tokenizer count (use a client-side tokenizer library; label which tokenizer and that counts differ per model) → a single glowing token travels from your screen into the chosen HQ, lights one rack, and shows the energy/water of that single prompt (with ranges).
5. **"Since you arrived" counter:** tokens processed globally since the visitor opened the page, plus fun equivalents that rotate.
6. **Incident mode:** if a platform's status page reports an outage, its HQ lights flicker, alarms spin, and a banner explains — sourced from the official status feed.
7. **Compare mode:** pick 2–3 platforms, split-screen campuses side by side with all metrics.
8. **Cinematic tour / attract mode:** after 30s idle, the camera auto-flies a curated tour with captions — great on a TV.
9. **Discoveries:** hidden details (a sleeping night-shift employee, a coffee machine whose usage scales with load, a cat in one server room). A subtle "12/40 details found" tracker, stored per-visitor in localStorage (wrapped in try/catch).
10. **Share card:** generate a shareable image of the current view with key numbers and the tier badges intact.
11. **Sound design:** ambient city, server hum, launch fanfare — **off by default**, one-click toggle, volume follows zoom level.
12. Propose 3 more original ideas in `PLAN.md` and build the best one.

### 5.4 Art direction
- Cohesive, premium, cinematic. Custom palette per HQ, one shared lighting/post-processing language (tasteful bloom, subtle fog, no cheap glow overload).
- Typography: one display face + one UI face (Google Fonts).
- UI: glass panels, crisp numerals with tabular figures, smooth number tweening, micro-interactions on every control.
- Motion: every camera move eased and interruptible; nothing snaps.

---

## 6. Language

- **English only.** No language toggle, no RTL, no i18n framework. Keep all UI copy in one `src/copy.ts` file so it's easy to edit.

---

## 7. Performance, accessibility, robustness

- 60 fps on a mid-range laptop; ≥30 fps on a recent phone. Use instancing, LOD, frustum culling, texture atlases, lazy-loaded zoom scenes, and an adaptive quality governor that lowers settings if frame time rises.
- First meaningful paint < 2.5s on 4G. Show a beautiful loading state, never a blank screen.
- **Fallbacks:** no WebGL → a polished 2D dashboard with the same data. `prefers-reduced-motion` → calm mode with no camera flights.
- Accessibility: every metric reachable by keyboard and screen reader via a parallel accessible data view; WCAG AA contrast; focus states visible.
- Handles: offline, failed JSON fetch (use last cached data + notice), tab hidden (pause rendering), resize/orientation change, very long platform names.
- Mobile-first touch controls: pinch zoom, tap to fly, bottom-sheet info panels.

---

## 8. Tech stack & repo

- Vite + TypeScript (strict) + Three.js. Zod for data validation. Vitest for unit tests. Playwright for E2E + screenshots. ESLint + Prettier.
- GitHub Actions: `deploy.yml` (build + deploy to Pages on push to main), `update-data.yml` (daily schedule + manual dispatch), `ci.yml` (lint, type-check, test, build on every PR).
- Correct Vite `base` for the GitHub Pages repo path.
- `README.md` (what it is, how to run, how it's built), `PLAN.md`, `DECISIONS.md`, `UPDATING.md`, `METHODOLOGY.md` (mirrors the in-site page).

---

## 9. Milestones

1. **Research & plan:** platform list, data collection with sources, estimation model, `PLAN.md`. Unit-test the model.
2. **Skeleton:** Vite/TS/Three, data loading + validation, deploy pipeline live on Pages.
3. **City overview:** 15 campuses driven by data, day/night, live counters, info panels with tier badges.
4. **Zoom interiors:** offices, server hall, power/cooling, model lab.
5. **Time machine + race mode + launch events.**
6. **Prompt visualizer, compare mode, incidents, tour mode, discoveries, share card, sound.**
7. **Automated data pipeline** + `UPDATING.md`.
8. **Polish & hardening:** performance governor, fallbacks, accessibility, mobile, copy review, final art-direction passes.

---

## 10. Definition of done (verify every line before declaring finished)

- [ ] Every number on screen shows its tier badge and links to source/method.
- [ ] No logos, wordmarks, or mascots of real companies anywhere.
- [ ] Disclaimer visible; methodology page complete.
- [ ] Live counters are deterministic and consistent across devices.
- [ ] Data pipeline runs green, refuses to publish invalid data, and `lastUpdated` displays correctly.
- [ ] 60 fps desktop / 30 fps mobile confirmed; no WebGL fallback works.
- [ ] Zero console errors; all tests pass; Lighthouse ≥ 90 on Performance (2D view), Accessibility, Best Practices, SEO.
- [ ] Screenshots of every major view, desktop and mobile, reviewed and polished.
- [ ] Live on GitHub Pages; final summary lists what's Reported vs Estimated vs Modeled per platform, and any known limitations.
