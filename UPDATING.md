# UPDATING.md — refresh a figure in two minutes

All human-curated figures live in `data/manual/`. You can edit them in the GitHub web editor from your
phone; the CI build validates every change and refuses to publish anything invalid.

> Milestone 7 adds the automated daily pipeline (model releases, status incidents). This page covers
> the manual part: reported usage figures.

## Add a new reported figure (e.g. a company announces new daily tokens)

1. Open `data/manual/metrics.yaml` on GitHub and tap the pencil (edit).
2. Copy the most recent entry for that platform and paste it at the end of that platform's section.
3. Change:
   - `id` — unique, e.g. `doubao-tpd-2026-09`
   - `value` — plain number, no commas (`250000000000000` for 250 trillion)
   - `asOf` — the date the figure describes, `YYYY-MM-DD`
   - `quote` — the exact words from the source
   - `source` — `title`, `publisher`, `url` (https), `published`
   - `accessed` — today's date
   - `qualifier` — `exact`, `about`, `over` ("more than"), `under`, or `range` (then add `low`/`high`)
   - `sourceKind` — `primary` if the company said it, `third-party` if it is someone else's estimate
   - `verified` — `page` if you read it on the page
4. Keep `component` the same as the entry you copied if the figure measures the same thing; remove the
   `component` line to show it as context only.
5. Commit to a branch and open a pull request. CI runs the data build; if anything is wrong it tells you
   the file, the entry and the field.

## Units cheat sheet

| Field  | Tokens                                                                 | Requests       | Users                              | Revenue                         |
| ------ | ---------------------------------------------------------------------- | -------------- | ---------------------------------- | ------------------------------- |
| `kind` | `tokens`                                                               | `requests`     | `users`                            | `revenue`                       |
| needs  | `period`: second · minute · hour · day · week · month · quarter · year | same as tokens | `window`: daily · weekly · monthly | `period: year` (annualized USD) |

## Change an assumption

Every constant is in `src/model/constants.ts` with its value, range, source and a note. Change the
number, keep `low <= value <= high`, and update the note and source. Run `npm test` locally if you can.

## Check locally

```bash
npm install
npm run build:data -- --check   # validate without writing
npm run build:data              # write public/data/*.json
npx tsx scripts/report.ts       # print today's estimates per platform
```
