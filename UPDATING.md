# UPDATING.md — refresh a figure in two minutes

All human-curated figures live in `data/manual/`. You can edit them in the GitHub web editor from your
phone; the CI build validates every change and refuses to publish anything invalid.

Two kinds of data keep the site current:

- **Curated** (`data/manual/*.yaml`): reported usage figures, models and platforms, each with its
  source and date. You update these by hand (below).
- **Automated** (a daily GitHub Actions run): status-page notices and newly seen models. See
  [The daily update](#the-daily-update) at the end; normally there is nothing to do.

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

## The daily update

`.github/workflows/update-data.yml` runs every day at 05:17 UTC (and on demand: **Actions → Update
data → Run workflow**). It uses only public, key-free sources and needs no secrets:

| Source                                                               | Becomes                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Each HQ's status page `summary.json` (`statusPage.json` in the YAML) | `public/data/incidents.json`: open incidents and maintenance under way, as the page reports them |
| OpenRouter's public model list (`openrouter.ai/api/v1/models`)       | `data/auto/sightings.json`: "first seen on OpenRouter" events for the HQs' own model families    |

Then it runs the data build (which validates everything again), type-checks, tests and builds the
site, and **commits to `main` only if a file changed**, which redeploys the site.

What it will never do:

- **Publish broken or empty data.** A status page or the model list that cannot be reached, or
  that returns something unexpected, keeps its previous data and is listed as a warning on the run
  (open the run and read "Data update" in its summary). If anything to be published does not
  validate, the run fails and nothing is committed.
- **Guess.** Notices come only from a page's JSON feed; pages that publish only RSS (e.g. xAI's)
  are skipped. An unknown impact is recorded as "none", which the site does not show. The site
  itself hides an open notice after three days, in case a page stops updating.
- **Call a sighting a launch.** "First seen" events are listed in What's new and on the timeline,
  but never celebrated as launches.

Common tasks:

- **Run it now:** Actions → Update data → Run workflow.
- **Locally:** `npm run update:data -- --dry-run` fetches and reports without writing;
  `npm run update:data` then `npm run build:data` does what the workflow does.
- **Add or fix a status page:** edit that platform's `statusPage` in `data/manual/platforms.yaml`
  (`json` is the page's `/api/v2/summary.json`; statuspage.io and incident.io pages both publish
  one).
- **A sighting is really a launch:** add the model to `data/manual/models.yaml` with its source.
  The data build then drops the sighting (same HQ, matching name, within 120 days).
- **A sighting is wrong:** delete its entry from `data/auto/sightings.json`, or add the model to
  `models.yaml`. Which OpenRouter authors map to which HQ is set in `OPENROUTER_AUTHORS`
  (`src/data/feeds.ts`).
- **"Data updated" looks old:** it shows when the published data last _changed_. Days without news
  make no commit, so the date only moves when there is something new.

If the run fails with a permissions error on `git push`, the repository's settings must let
workflows write (Settings → Actions → General → Workflow permissions → "Read and write"), and a
branch rule on `main` must allow the `github-actions[bot]` push.
