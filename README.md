# Token Metropolis

A living 3D night city where each of the world's 15 biggest AI platforms is a company headquarters,
sized and lit by how many tokens it processes — with every number one click from its source, its
formula and its uncertainty range.

> **Independent project.** Not affiliated with, endorsed by, or sponsored by any company shown.
> Figures are estimates unless marked **Reported**.

**Status:** Milestones 1–2 of 8 complete: research, sourced data, estimation model, and the app skeleton
(data loading, live counters, placeholder 3D scene, CI/deploy workflows). See [PLAN.md](PLAN.md) and
[TASKS.md](TASKS.md).

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

## Run it

Requires Node 22.12+.

```bash
npm install
npm run dev               # local site at http://localhost:5173/Token-metropolis/
npm test                  # unit + dataset integration tests
npm run build             # validate data, write public/data/*.json, type-check, Vite production build
npm run test:e2e          # Playwright smoke tests + screenshots (desktop 1440×900, mobile 390×844)
npx tsx scripts/report.ts # print today's estimates per platform
npm run check             # type-check, lint, format check, tests, build
```

## Repository map

| Path                                                       | What                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `data/manual/`                                             | Curated, sourced figures: platforms, metrics, models ([UPDATING.md](UPDATING.md)) |
| `src/model/`                                               | Pure, deterministic estimation model (unit-tested)                                |
| `src/world/` · `src/ui/` · `src/state/`                    | Three.js scene, DOM interface, clock and city state                               |
| `src/data/`                                                | Zod schemas and whole-dataset validation                                          |
| `scripts/`                                                 | Data build (refuses invalid data) and the estimates report                        |
| `public/data/`                                             | Published JSON consumed by the site                                               |
| `PLAN.md` · `DECISIONS.md` · `METHODOLOGY.md` · `TASKS.md` | Plan, decisions log, method, status                                               |

## Built with

TypeScript (strict), Vite, Three.js, Zod, Vitest, Playwright, ESLint, Prettier; GitHub Actions and
GitHub Pages.
