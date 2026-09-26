# TASKS.md — Token Metropolis

Resume point for any fresh session. Source brief: `token-metropolis-prompt_1.md`.
Working agreement: `CLAUDE.md`. Decisions log: `DECISIONS.md`. Plan: `PLAN.md`.

Development branch: `claude/pensive-ptolemy-0qc6e6` (pushing to `main` deploys — not done without approval).

Quick orientation: `npm install && npm run check` (type-check, lint, format, tests, data build);
`npx tsx scripts/report.ts` prints today's estimates per platform.

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

No UI exists yet, so the Playwright screenshot check starts in M2.

## Next — Milestone 2: Skeleton

- [ ] Vite + Three.js + TypeScript app shell; `index.html`, loading state, `src/copy.ts`.
- [ ] `src/data/load.ts`: fetch `public/data/*.json`, validate with the same Zod schemas, cache last good
      data (Cache API/localStorage wrapped in try/catch), offline notice.
- [ ] Clock/store (`src/state/`), wire `src/model` counters to a minimal DOM readout.
- [ ] GitHub Actions: `ci.yml` (lint, type-check, test, build on PRs), `deploy.yml` (Pages on `main`),
      Vite `base` = `/Token-metropolis/`.
- [ ] Playwright smoke + screenshot harness (1440×900, 390×844) using `/opt/pw-browsers/chromium`.
- [ ] ESLint/Prettier cover the new app code; zero console errors.

Then M3–M8 per PLAN.md §8.

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
