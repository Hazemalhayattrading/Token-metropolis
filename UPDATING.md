# UPDATING.md — refresh a figure in two minutes

All human-curated figures live in `data/manual/`. You can edit them in the GitHub web editor from your
phone; the CI build validates every change and refuses to publish anything invalid.

Two kinds of data keep the site current:

- **Curated** (`data/manual/*.yaml`): reported usage figures, models and platforms, each with its
  source and date. You update these by hand (below).
- **Automated** (an hourly GitHub Actions run): status-page notices and newly seen models. See
  [The automatic update](#the-automatic-update) at the end; normally there is nothing to do.
- **Always edit `data/manual/` on a branch and open a pull request** (step 5 below): the checks run
  on pull requests. A broken edit committed straight to `main` publishes nothing, but it makes every
  hourly update fail until it is fixed.

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

## The automatic update

`.github/workflows/update-data.yml` runs every hour at :17 (and on demand: **Actions → Update data
→ Run workflow**). It uses only public, key-free sources and needs no secrets:

| Source                                                               | Becomes                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Each HQ's status page `summary.json` (`statusPage.json` in the YAML) | `public/data/incidents.json`: open incidents and maintenance under way, as the page reports them, with the time they were read |
| OpenRouter's public model list (`openrouter.ai/api/v1/models`)       | `data/auto/sightings.json`: "first seen on OpenRouter" events for the HQs' own model families                                  |

If nothing changed, the run stops there. Otherwise it runs the data build (which validates
everything again), type-checks, tests and builds the site, **commits to `main`** and redeploys.

What it will never do:

- **Publish broken or empty data.** A status page or the model list that cannot be reached, or
  that returns something unexpected, keeps its previous data and shows as a warning on the run
  (open the run and read "Data update" in its summary). If anything to be published does not
  validate, the run fails and nothing is committed.
- **Guess.** Notices come only from a page's JSON feed; pages that publish only RSS (e.g. xAI's)
  are skipped. On a page shared with other services (githubstatus.com), only notices naming the
  HQ's component are kept (`statusPage.components`). An unknown impact is recorded as "none",
  which the site does not show.
- **Show stale notices.** Each notice carries the time it was read. The site shows it with "as of
  HH:MM UTC" and hides it once its page has not been read for three hours.
- **Call a sighting a launch.** "First seen" events appear in What's new and on the timeline, dated
  when OpenRouter first listed the model (its earliest variant), but are never celebrated.

Common tasks:

- **Run it now:** Actions → Update data → Run workflow (on `main`). Tick "Deploy the site even if
  the data did not change" to redeploy after a failed deploy.
- **Locally:** `npm run update:data -- --dry-run` fetches and reports without writing;
  `npm run update:data` then `npm run build:data` does what the workflow does.
- **Add or fix a status page:** edit that platform's `statusPage` in `data/manual/platforms.yaml`
  (`json` is the page's `/api/v2/summary.json`; statuspage.io and incident.io pages both publish
  one; add `components: ["Name"]` if the page covers other services too).
- **A sighting is really a launch:** add the model to `data/manual/models.yaml` with its source.
  The data build then drops the sighting (same HQ, same name, within 120 days).
- **A sighting is wrong:** add its id (e.g. `seen-qwen-qwen3-foo`) to
  `data/manual/hidden-sightings.yaml`. Do not edit `data/auto/` by hand: the pipeline owns it and
  would stop (safely, publishing nothing) if it could not read it. Which OpenRouter authors map to
  which HQ is set in `OPENROUTER_AUTHORS` (`src/data/feeds.ts`).
- **"Data updated" looks old:** it shows when the figures, models or events last _changed_ (status
  notices, which come and go by the hour, do not move it).
- **A branch conflicts with `main` in `public/data/`:** the bot commits generated files to `main`.
  Merge `main`, take either side of the conflict, then run `npm run build:data` and commit: the
  files are regenerated from the sources.

If a run fails to push to `main`, no settings change is needed for the token (each workflow asks
for the permissions it needs): check **Settings → Rules** and **Settings → Branches** for a rule on
`main` that requires pull requests or status checks, and remove it or let GitHub Actions bypass it.
While a status notice is open on some page, each hourly run commits (the notice's "as of" time
moves) and the site redeploys; that is expected.
