# Token Metropolis

A living 3D night city where each of the world's 15 biggest AI platforms is a company headquarters,
sized and lit by how many tokens it processes — with every number one click from its source, its
formula and its uncertainty range.

> **Independent project.** Not affiliated with, endorsed by, or sponsored by any company shown.
> Figures are estimates unless marked **Reported**.

**Live site:** https://hazemalhayattrading.github.io/Token-metropolis/ (deployed by GitHub Actions on
every push to `main`).

**Status:** Milestones 1–7 of 8 complete: sourced data and estimation model; the 3D city with its
zoom interiors (offices, server hall, power and cooling, model lab); the time machine, race mode and
launch days; your prompt visualized, compare mode, incident mode, the cinematic tour, hidden
details, the share card, sound and the uncertainty glass; and the automated data pipeline. Next:
Milestone 8, polish and hardening. See [PLAN.md](PLAN.md) and [TASKS.md](TASKS.md).

## How the numbers work (short version)

- Every published figure (tokens, requests, users or revenue) is stored with its exact quote, source URL,
  date and verification level in [`data/manual/metrics.yaml`](data/manual/metrics.yaml).
- Each figure becomes a tokens-per-day **anchor**; a piecewise-exponential curve runs through the
  anchors and extrapolates, with a widening range, after the latest one.
- Every value carries a tier: **Reported** (published), **Estimated** (calculated from published inputs)
  or **Modeled** (relies on a judgement call). The weakest input decides.
- Live counters are exact integrals of that curve times a 24-hour traffic shape — deterministic, so every
  visitor sees the same number at the same moment.
- Full method: [METHODOLOGY.md](METHODOLOGY.md). Every assumption: [`src/model/constants.ts`](src/model/constants.ts).
- An hourly GitHub Actions run adds official status-page notices and newly listed models from public,
  key-free feeds; a failing source keeps its previous data. How to update figures by hand, and how
  the automatic update works: [UPDATING.md](UPDATING.md).

## Run it

Requires Node 22.12+.

```bash
npm install
npm run dev               # local site at http://localhost:5173/Token-metropolis/
npm test                  # unit + dataset integration tests
npm run build             # validate data, write public/data/*.json, type-check, Vite production build
npm run test:e2e          # Playwright smoke tests + screenshots (desktop 1440×900, mobile 390×844)
npx tsx scripts/report.ts # print today's estimates per platform
npm run update:data -- --dry-run # fetch the public feeds and report, writing nothing
npm run check             # type-check, lint, format check, tests, build
```

## Repository map

| Path                                                       | What                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `data/manual/`                                             | Curated, sourced figures: platforms, metrics, models ([UPDATING.md](UPDATING.md)) |
| `data/auto/`                                               | Written by the hourly pipeline only (model sightings)                             |
| `src/model/`                                               | Pure, deterministic estimation model (unit-tested)                                |
| `src/world/` · `src/ui/` · `src/state/`                    | Three.js scene, DOM interface, clock and city state                               |
| `src/data/`                                                | Zod schemas and whole-dataset validation                                          |
| `scripts/`                                                 | Data build (refuses invalid data), the data pipeline, the estimates report        |
| `.github/workflows/`                                       | CI (pull requests), deploy to Pages (`main`), hourly data update                  |
| `public/data/`                                             | Published JSON consumed by the site                                               |
| `PLAN.md` · `DECISIONS.md` · `METHODOLOGY.md` · `TASKS.md` | Plan, decisions log, method, status                                               |
| `UPDATING.md`                                              | Refresh a figure from your phone; how the automatic update works                  |

## Built with

TypeScript (strict), Vite, Three.js, Zod, Vitest, Playwright, ESLint, Prettier; GitHub Actions and
GitHub Pages.
