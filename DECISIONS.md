# DECISIONS.md

Non-blocking choices made while building, with the reasoning. Newest decisions at the bottom of each
section. Research for Milestone 1 was done on 2026-09-25.

---

## Product

### D-001 — Name

**Keep "Token Metropolis."** It says what the piece is (tokens, a city), is easy to search and share,
and the brief already uses it. Alternatives considered: _Inference City_ (too technical),
_Tokenopolis_ (gimmicky), _Night Shift_ (lovely but vague — used instead as the name of the visual
concept, see PLAN.md §5).

### D-002 — The extra original feature to build

Of the three ideas in PLAN.md §6, build **Uncertainty glass** (towers show a solid core at the low
estimate and a glass shell up to the high estimate). It turns the project's core principle — ranges,
not false precision — into its most memorable visual, and is cheap to build.

### D-003 — Typography (provisional)

Display _Fraunces_, UI _IBM Plex Sans_ (tabular numerals). To be confirmed against screenshots in M3.

---

## Engineering

### D-010 — Branch and deploys

Work happens on `claude/pensive-ptolemy-0qc6e6`. Pushing to `main` deploys to Pages, so nothing is
pushed to `main` without the owner's approval (CLAUDE.md).

### D-011 — TypeScript 6.0, not 7.0

TypeScript 7 (the native port) is out, but `typescript-eslint` supports only `<6.1`. Pinned
`typescript@6.0.3` so lint, type-check and editor tooling agree. Revisit when typescript-eslint
supports 7.

### D-012 — Deterministic math for counters

`Math.exp/log/sin/cos` may differ in the last bit between browser engines. Counters are computed with
our own implementations built only from IEEE-754 basic arithmetic (`src/model/detmath.ts`), and
phases are handled in "turns" so range reduction is exact. Result: identical digits on every device.

### D-013 — Exact integration instead of frame accumulation

The live total is the closed-form integral of (piecewise-exponential growth × Fourier traffic shape).
Counters never drift, survive a hidden tab or a sleeping laptop, and their derivative equals the
displayed tokens/second exactly. A first version used `G(t) + r(t)·W(t)` as an approximation; replaced
because the exact form is just as cheap and provably monotonic.

### D-014 — "Tokens today" means since 00:00 UTC

A visitor-local day would make the "same moment, same number" promise depend on the viewer's time
zone. The UI will label it "today (UTC)".

### D-015 — Uncertainty propagation

Input ranges are read as 90% intervals; products combine in quadrature on a log scale with separate
low/high sides (log-normal propagation). Sums across platforms add lows and highs (conservative,
because platforms share assumptions).

### D-016 — Growth extrapolation

Growth after the last figure is fitted from the most recent figure at least 60 days older (so recent
slow-downs show), clamped to [½×, 10×] per year, and damped with a one-year e-folding time. The band
widens by a further ×2 each way per year of extrapolation. Initially the fit used the oldest figure in
the past year; changed after review because it ignored Doubao's visible slow-down in 2026 Q2.

### D-017 — "Reported" expires after 14 days

A value is labeled Reported only within 14 days of a reported figure; interpolated or extrapolated
values are at best Estimated. Cumulative totals are never Reported, and are Modeled if more than 5% of
the total comes from modeled segments (e.g. the launch ramp).

### D-018 — One throughput figure for every platform

We cannot know each platform's hardware efficiency, so every HQ uses one H100-equivalent throughput
(5,000 tokens/s per GPU, range 1,500–15,000, anchored on DeepSeek's production disclosure). All GPU,
power and water numbers are therefore labeled Modeled.

### D-019 — Regions and time zones

Five regions with fixed representative UTC offsets (−6, −4, +1, +5, +8); daylight saving time is
ignored. Simple, deterministic and accurate to within an hour.

### D-020 — Published data is committed

`public/data/*.json` is committed so Pages serves it and the daily workflow can diff it.
`meta.json.lastUpdated` changes only when the content hash changes.

### D-021 — Prettier leaves `data/manual/*.yaml` alone

The curated YAML is hand-formatted for quick edits on a phone (UPDATING.md); Zod validation guards it.

### D-023 — Playwright pinned to the preinstalled Chromium

`@playwright/test@1.56.1` matches the Chromium build preinstalled in the development container
(revision 1194), so no browser download is needed locally; CI installs its own. Headless WebGL runs on
SwiftShader (`--use-angle=swiftshader`).

### D-024 — Loader and fallbacks

The loader is styled inline in `index.html` so it paints before any script. The accessible data table
is always rendered: it is the whole page when WebGL is missing and a skip-link target otherwise.
Static HTML text (title, disclaimer) duplicates `src/copy.ts` only as a no-JS/SEO fallback; the script
overwrites it from `copy.ts` on boot.

### D-025 — World-space windows

Facade windows are computed in the shader from world position, so towers can grow (time machine,
scale toggle) without stretching windows, and a whole campus shares one material program.

### D-026 — Light streams show only the final approach

Full horizon-to-campus arcs swept past the camera as giant ribbons. Only the last ~40% of each arc is
drawn, regions under 15% of a platform's users get no arc, and the glow is kept low.

### D-027 — No permanent spotlights

Sweeping spotlight cones read as artifacts at overview distance; spotlights are reserved for launch
events (M5), where they carry meaning.

### D-028 — Day/night approximation

Daylight follows a smooth sunrise ~06:30 / sunset ~19:00 curve at each HQ's local time (latitude and
season ignored). Office occupancy (lit windows) follows local working hours; server activity follows
the platform's user-weighted traffic curve — the two are deliberately independent.

### D-029 — Label collisions

Labels are placed in order of platform size: full label, then lifted on a longer leader, then
name-only, then a dot. UI chrome marked `data-reserve` is off-limits. Selected/hovered labels win.

### D-022 — No CO₂ figures

No sourced central value for the carbon intensity of AI data centres was found (only a regional range),
and the brief does not ask for CO₂. Removed rather than shown with an invented central value.

---

## Data

### D-030 — The 15 platforms (as of 2026-09-25)

"Biggest by usage" has no single metric: consumer apps publish users, coding tools and labs publish
revenue or tokens. We ranked on the best available usage evidence (reported users, token volumes,
revenue as a proxy for tokens) and checked it against third-party traffic data.

| #   | Platform                                   | Key evidence                                                                    | Verdict                                                      |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | ChatGPT                                    | 900M+ weekly users (Feb 2026); OpenAI API >15B tokens/min (Mar 2026)            | Include                                                      |
| 2   | Gemini                                     | App 1B monthly users (Aug 2026); customer API >16B tokens/min (Apr 2026)        | Include                                                      |
| 3   | Meta AI                                    | 1B+ monthly users across Meta's apps (May 2025)                                 | Include                                                      |
| 4   | Doubao                                     | 180T tokens/day (Jun 2026); 382M China MAU                                      | Include                                                      |
| 5   | Claude                                     | $47B run-rate revenue (May 2026, Anthropic); #3 in web traffic (9.3%, Aug 2026) | Include                                                      |
| 6   | Microsoft Copilot                          | 150M MAU across the Copilot family (Oct 2025); 30M paid M365 seats (Jul 2026)   | Include                                                      |
| 7   | Qwen                                       | 167M China MAU (Jun 2026)                                                       | Include                                                      |
| 8   | DeepSeek                                   | 130M China MAU (Jun 2026); 776B tokens/day disclosed (Feb 2025)                 | Include                                                      |
| 9   | GitHub Copilot                             | 50M users (Jul 2026)                                                            | Include (separate from Microsoft Copilot; see D-033)         |
| 10  | Grok                                       | 117M monthly users of Grok features (Mar 2026, SpaceX S-1)                      | Include                                                      |
| 11  | Cursor                                     | ~$4B annualized revenue (Jun 2026), mostly spent on tokens                      | Include (a top token consumer)                               |
| 12  | Perplexity                                 | 780M queries/month (May 2025); 100M+ MAU incl. agents (Mar 2026)                | Include                                                      |
| 13  | Character.AI                               | ~20,000 queries/second (Jun 2024); ~20M MAU                                     | Include (very token-heavy per user)                          |
| 14  | Tencent Yuanbao                            | 49.8M China MAU (Jun 2026), China's #4 AI-native app                            | **Added**                                                    |
| 15  | Kimi                                       | 19.4M (Jan 2025) → ~9M China MAU (end 2025)                                     | Include (see below)                                          |
| —   | Mistral Le Chat                            | Renamed "Vibe" in May 2026; no usage figure found                               | **Dropped**                                                  |
| —   | Alibaba Quark                              | ~159M MAU claimed (AICPB) for an AI search super-app                            | Not separate: Alibaba, Qwen-powered, AI share of use unknown |
| —   | OpenAI Codex, Claude Code                  | 5M+ weekly users; $2.5B run-rate                                                | Counted inside OpenAI / Anthropic                            |
| —   | Manus                                      | ~22M visits/month; acquired by Meta                                             | Counted inside Meta                                          |
| —   | Replit, Lovable, Genspark, Janitor AI, Poe | $0.2–0.6B revenue or <10M MAU                                                   | Below the cut                                                |

**Slot 15:** Kimi and Mistral are both weak on consumer usage. Kimi wins because it has sourced usage
figures (so it can be estimated honestly), while no usage number at all could be found for Mistral's
assistant — it could not even be modeled without inventing an input. Europe therefore has no HQ;
that is what the data supports today.

### D-031 — What each HQ counts ("scope")

Every platform states its scope in one sentence and the UI shows it. Choices worth noting:

- **ChatGPT** = OpenAI's ChatGPT **plus** the OpenAI API (incl. Codex). The API component starts at
  ChatGPT's launch (30 Nov 2022), not the API's 2020 launch, so "since launch" means since ChatGPT.
- **Gemini** = the Gemini app + Google's customer API. Google's all-surface monthly token totals
  (including Search) could not be verified during research, so they are **not used** — Gemini is
  therefore a known **underestimate** until those figures are verified (TASKS.md).
- **Claude, Cursor** are estimated from run-rate revenue ÷ price per token (Anthropic publishes a dense
  revenue series but no token totals; Cursor's ARR is third-party).
- **Grok** = consumer Grok only; **Qwen** = the Qwen app only; **Kimi** = the Kimi app only. Their APIs
  published no usage figures and are excluded (documented in each scope).
- **Microsoft Copilot** excludes GitHub Copilot via a scope factor derived from Microsoft's own numbers
  (100M family MAU with 20M GitHub Copilot users; 150M with 26M).

### D-032 — Platform-calibrated conversions

Where tokens and users were published for the same moment, we derive a platform-specific constant
instead of using generic judgement calls: DeepSeek (776B tokens ÷ 194M China MAU, Feb 2025 →
4,000 tokens per MAU per day) and Character.AI (20,000 queries/s ÷ ~28M MAU, mid-2024 → 62 requests per
MAU per day). DeepSeek's current estimate is therefore Estimated rather than Modeled.

### D-033 — Double counting

Coding tools and answer engines call other listed labs' models. Each HQ shows everything its product
handles, and the global total removes a documented, ranged `routedShare` for Cursor (70%), GitHub
Copilot (60%), Perplexity (40%) and Microsoft Copilot (10%).

### D-034 — Primary vs third-party

A figure is "primary" when the company (or a primary source) originated it, even if we link to press
coverage of the statement (e.g. Volcano Engine's token figures reported by Chinese media; Microsoft
figures from its investor site). Estimates by analytics firms, aggregators or journalists are
"third-party" and get wider ranges.

### D-035 — Dates with month or quarter precision

Month-only figures are dated the 15th, "end of month" the last day, quarter-only the last day of the
quarter, "late 2025" mid-November — each noted in `metrics.yaml`. Launch dates carry a `precision`
field (Cursor: year).

### D-036 — Research limits and verification labels

During research the session's web-search budget (200 searches) ran out and most primary domains were
blocked by the environment's network policy. We therefore record, for every figure, whether it was
read on the page (`page`) or only seen in a search-result summary of that page (`snippet`), and mark
items taken from reference knowledge as `pending`. Constants still pending verification are hidden
from the UI by code (`isDisplayable`), not by convention. Everything pending is listed in TASKS.md.

### D-037 — Time machine start

The brief asks for a scrubber from Nov 2022 and describes the city growing from one building. The data
says GitHub Copilot (GA June 2022) and Character.AI (beta Sept 2022) already existed, so the city
starts with three small buildings, and ChatGPT's growth is the story from there.

### D-038 — Growth where the only figures are relative

Meta AI (only "1B+ MAU", May 2025) and Microsoft Copilot (last absolute figure Oct 2025) have later
disclosures that are only relative ("60% more daily users", "3× daily users"). These are shown as
context, not converted into anchors; the curves extrapolate with the documented default/fitted growth
and widening ranges.

### D-039 — Engagement constants calibrated to ChatGPT

The assistant defaults (45% of weekly users active on a day × 8 messages each = 3.6 messages per weekly
user per day) match OpenAI's published 18B messages/week from ~700M weekly users (3.7/day). Embedded
assistants (Meta AI) use 3 requests per active day instead of 8.

### D-040 — Interiors are dioramas inside the campus, not separate scenes

Each interior is built in the campus's local space at a fixed anchor (offices inside the tower, racks
inside the hall block, the lab in front of the tower, power beside the cooling towers). The camera
flies there with the same director as every other flight, so there is no scene switch or page load,
and the city stays visible around the interior. The tower turns to 16% glass for the offices view; the
hall roofs are hidden for the server hall. Interiors load as a separate chunk on first use and are
built only for the selected campus.

### D-041 — What interior visuals mean, stated in the panel

Desks, people and racks are a visual scale of load (log daily rate), not staff or machine counts, and
each tab says so. Desk-hardware bands follow the daily rate at 1.78T and 56.2T tokens/day (log-load
0.45 / 0.75). Liquid-cooling pipes are drawn only for accelerator classes usually deployed with
liquid cooling at scale (Blackwell rack systems, TPU pods, Trainium); "mixed" (varied or undisclosed
fleets) gets none, and the panel calls the pipes illustrative. The traffic multiplier ("× the daily
average") is shown with a range from the traffic-shape amplitude bounds and the note that the curve is
an assumption.

### D-042 — Power and water gauges span every HQ on a log scale

Each gauge spans whole decades covering every HQ's daily-average range widened by the largest possible
traffic swing, so the needle position compares across HQs and the decades do not change with the time
of day (a linear scale would pin every platform but the largest at zero). The shaded band is the
range, the needle the central value; the numbers and tier badge are in text beside the drawing.

### D-043 — Model facts are badged by who published them

As for metrics: a release date or context window is Reported only when it comes from the model maker's
own publication (`sourceKind: primary`) and was checked; figures from anyone else are Estimated; facts
not yet checked against their source show a dashed "Not yet checked" chip instead of a tier. Dates
carry a precision (`datePrecision: month` shows YYYY-MM) and a kind: `first-seen` dates (a repository's
first commit, another product adding the model, a first sighting) are labelled "First seen", never
"Released". Offered models must name their `maker`; `origin` has no default any more (Microsoft
Copilot's OpenAI models were wrongly credited to Microsoft through that default).

### D-044 — Multi-agent orchestration ("Ultracode")

The owner asked mid-session for Ultracode mode. From M4 onward each substantive step is followed by a
multi-agent workflow (parallel reviewers across correctness, data honesty, accessibility and
performance, with adversarial verification of every finding) before pushing, and independent modules
in later milestones may be built in parallel with strict file ownership. This supersedes the
CLAUDE.md default of avoiding subagents, at the owner's request.

### D-045 — Time-of-day figures are at best Modeled

Tokens per second and tokens so far today multiply the daily rate by the time-of-day traffic curve,
whose constants are assumptions, so by the weakest-input rule they are badged
`instantTier = weakest(rateTier, traffic tier)` — i.e. Modeled — even when the daily rate is Reported.
Full-day figures (the daily rate, tokens/day labels) do not depend on the curve (its terms average to
zero) and keep the rate's tier.

### D-046 — Inside an interior, the rest of the city steps aside

Fixed camera offsets put interior cameras inside or behind neighbouring HQs (the island is dense), and
a sight-line check alone still left neighbours filling the frame. While an interior is open the other
HQs sink away (their towers ease to zero and their campuses hide; streams and labels hide too), and
regrow when the visitor returns to the overview. The selected campus shows log scale meanwhile,
because the interiors are laid out for log-scale towers (true scale can leave a stub tower). Camera
directions are still searched so the campus's own tower never blocks the view, and taps inside an
interior never jump to another HQ.

### D-047 — Office floors are cut to each tower's real shape

Rectangular floors from a bounding box stuck out of round, hexagonal, triangular and twin towers. Desks
are now packed greedily on a fine grid and kept only where the desk and chair are inside the tower
body at that floor (a per-mesh ray-parity test, since towers are unions of overlapping solids); each
desk gets its own floor tile. Base parts (plazas, workshops, canopies) hide in the offices and hall
views so they never cut through a diorama.

### D-048 — History is read from the same curves, and says so

The time machine does not replay a separate history: every past moment is evaluated with the same
growth curves, ranges and tiers as today (tiers are time-aware: a figure is Reported only near a
reported anchor). A History badge carries the note that figures before a platform's first published
number are modeled and ranges are wider. In history the HUD shows the whole UTC day's total (scrubbing
by day would otherwise read as midnight zeros); "since you arrived" always counts real time.

### D-049 — Launch days, pulses and toasts

A launch day lasts 72 hours from 00:00 UTC on the launch date, and only an HQ's own model launches
with a known day are celebrated (models offered from another company, first sightings and month-only
dates are listed and announced, not celebrated). Playback that moves forward past an event fires a
toast labelled by kind ("Model launch", "Now available", "First seen") and, for celebrated launches, a
short pulse at the HQ. Seeks, play/pause and returning to live are reported by the time machine and
never fire; month-only dates never fire (their day is unknown). Beams are fake volumetric shafts (no real lights), and every part of the effect shares one
bounding sphere so off-screen HQs are culled.

### D-050 — Race mode uses one linear scale

Bars share a linear scale where the leader fills the width — the honest picture of how concentrated
tokens are — with thin whiskers for the plausible range and a tier chip on every row. Platform names
open the HQ panel, where each figure has its formula and source.

### D-051 — Review depth by milestone (owner's request)

Milestone 6 and the final milestone get the full multi-agent review (four dimensions, each finding
adversarially verified). Other milestones get a lighter review: two reviewers (correctness and data
honesty), no separate verify phase — findings are triaged while fixing. Tests, E2E and screenshot
checks always run in full. The M5 review was cut short under this policy after its reviewers had run;
their confirmed and unverified findings were all addressed.

### D-052 — The whole UI follows the date shown

In history, the HQ panel relabels its figures ("Tokens on <date>", "At the time shown", "Power at the
time shown"), shows a History chip and the HQ's local time at the date shown, rebuilds its "latest
published figure" block for that date (before the first figure it shows that figure and says values
are modeled back from it), lists only models released by then, and shows "not launched yet" with no
tier before launch (interior tabs disabled). Labels' tier dots and HQ local hours follow the date
shown. A published figure vouches for the 14 days after it, never for days before it, and the
pre-launch zero makes no Reported claim. The data table stays live and says so.

### D-053 — Uncertainty glass: every tower shows its error bars (original idea)

"Show uncertainty" turns each tower into its plausible range: a solid core up to the low estimate, a
frosted glass case up to the high estimate and a thin light ring at the central value, where the
tower itself ends. The frost follows the tier (clear for Reported, frosted for Estimated, fogged for
Modeled). The three heights come straight from the model's range on the towers' own scale (log or
true); the mottling is cosmetic. The facade dims while the glass is shown, and a legend explains the
four parts and that the range is roughly a 90% model interval, not a hard limit.

### D-054 — Sound: procedural, off by default, conservative

All sound is synthesized with Web Audio (no files, no network): a distant city bed, a server hum that
comes forward as the camera flies into an HQ, a launch chime and a soft incident tone. It starts only
from a click (browsers require a gesture), peaks around −10 dBFS behind a soft safety clipper, ramps
every change, and suspends while off or while the tab is hidden. Where Web Audio is missing the toggle
simply stays off and says so.

### D-055 — Incidents: official status pages, live only

Incident mode shows only notices from each platform's official status page, linked, with the
reported impact. `incidents.json` is a snapshot of current status, so notices follow the live clock
and never the time machine; a notice older than three days is treated as stale, and an unreadable
timestamp claims nothing. Alarm beacons pulse and the HQ's windows flicker at no more than three
flashes a second (photosensitivity guidance), and not at all with reduced motion.

### D-056 — Cinematic tour stops and captions

After 30 s without input (and with no panel, race, compare, prompt or share dialog open, and no
playback) the camera flies a loop: the city, the three largest HQs, the smallest, the fastest-growing
over 90 days, an HQ in daytime, and the city total. Every caption that states an estimate carries its
tier: a growth ratio of two estimates is at best Estimated; the city total is a sum, so at best
Estimated and Modeled when routing shares de-duplicate it; a clock time carries none. Captions hold
6–10 s depending on their length. Any key, pointer, wheel or touch stops the tour.

### D-057 — Your prompt, visualized

Tokens are counted with o200k_base (GPT-4o-class models), using gpt-tokenizer, which is fetched as
its own chunk (~1 MB gzipped) the first time the panel opens. The UI says that Claude, Gemini and
others split text differently. The count carries an "Exact" chip, not a tier: it is a computation on
the visitor's own text, not an estimate of a platform. Energy and on-site water are Modeled, with
ranges, the formula, the energy per token and the sourced inputs. The figures are the same for every
HQ (one H100-class efficiency figure, as elsewhere), and the panel says so. The text never leaves the
browser. Opening the panel returns to live. The flight frames the hall where the token lands, then
lights a rack. On wide screens the panel sits beside the HQ panel (picking an HQ in the city aims it
there); otherwise they share one slot.

### D-058 — Compare mode

Two or three HQs side by side, each column with its own camera and bloom pipeline, framed the same
way. Columns are used even on phones, because towers are vertical. Phones give the campuses the top
half and the metrics cards the bottom half. Each card shows the key figures with ranges and tiers and
the latest published figure with its source.

### D-059 — "Since you arrived", in other words

Under the arrival counter a line rotates through words, electricity and cooling water for the tokens
processed since the visitor arrived. Each shows a central value, a range and a tier, and any
equivalence whose constant is still pending verification is hidden by code rather than shown
unverified.

### D-060 — Hidden details

There are 40 decorative details: 16 around the island, 5 that appear in every HQ's interior of that
kind, and 19 that belong to one HQ each (every HQ has at least one). None is a logo or a mascot-like
pairing with a company, and the list says they are not data. Progress stays in this browser
(localStorage). Unknown ids and corrupt data are dropped, and finds made in another tab are merged. A
detail whose HQ leaves the dataset moves to another HQ. The night-shift nap appears only at the HQ's
local night (an unknown hour counts as night). Props are batched to keep draw calls low. When a
campus's invisible pick box is nearer than a detail, the campus wins: a detail hidden behind an HQ is
found from another angle, never through a building.

### D-061 — Share card

The card is a 1200×630 PNG drawn in the browser: the current render under a glass band with the site
name, a title, the date and time (live or time machine), up to four figures each with its value,
range and tier chip in the site's words and colours, the disclaimer (shortened only when it cannot
fit) and the URL. From the control row it describes the city (the HUD's figures); from the HQ
panel's header it describes that HQ (the panel's figures, and the interior's name when one is open),
with the image cropped to the area beside or above the panel. Without WebGL the card uses a night
backdrop. "Share…" appears only where the system share sheet accepts files; otherwise the card is
downloaded.

### D-062 — Builds keep the standard backdrop-filter

The CSS minifier kept only the `-webkit-backdrop-filter` of each pair, so no glass panel was blurred
in Chrome in production (dev builds were fine). The sources now declare only the standard property,
and the build adds the prefix for Safari.

### D-063 — Popovers on phones open as sheets under the control strip

On phones the control row is a sideways-scrolling strip, which clipped the "What's new" and hidden
details popovers. On phones they open as fixed sheets just under the strip, full width.

### D-064 — The data pipeline: status pages hourly, model sightings from OpenRouter

The brief asks for a daily run; status notices last hours, so the pipeline runs hourly (the repo is
public, so Actions minutes are free) and stops early when nothing changed. It reads each HQ's
Statuspage-compatible `summary.json` (statuspage.io and incident.io both publish one) and keeps
only what the page reports as open: incidents that are investigating, identified or monitoring,
and maintenance in progress with an impact. Every notice carries the time it was read; the site
shows "Status as of HH:MM UTC" and hides a notice whose page has not been read for three hours. On
a page shared with other services (githubstatus.com) only notices naming the HQ's component count;
notices naming none are not guessed to be ours. Pages that publish only RSS are not read. A page
that fails, answers with something that is not a status summary, or lists open entries none of
which can be read keeps its previous notices (which then go stale on the site by themselves).
"Monitoring" notices say a fix is in place.

### D-065 — "First seen on OpenRouter" sightings

OpenRouter's public model list is the key-free source for new models. Only authors whose models are
unambiguously an HQ's own family are mapped (Gemma, gpt-oss and Seed-OSS are excluded). A model's
variants (`:free`, `:thinking`, …) are one model, dated by its earliest listing, and only models
first listed in the last 45 days become events. The data build drops a sighting once the curated
list has the same model (same HQ, the same name word for word with whole version numbers — Opus 5
is not Opus 5.1 — dates within 120 days). Sightings are timeline and What's new events of kind
"first seen": never celebrated, always linked to the model's OpenRouter page. The owner hides a
wrong one in `data/manual/hidden-sightings.yaml`; `data/auto/` is written by the pipeline only.

### D-066 — Publishing rules for generated data

`build-data` validates the pipeline's files too and refuses to publish (exiting non-zero, leaving
`public/data` untouched) if any is invalid, including files that are not valid JSON. "Data
updated" follows the figures, models and events only; status notices do not move it. The workflow
commits to `main` only when a file changed, regenerates and retries if `main` moved during the run,
and calls the Pages deploy itself (pushes made with the workflow token trigger no workflows); a
manual run can force a deploy.
