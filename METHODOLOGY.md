# How we estimate

Token Metropolis shows how many tokens the world's biggest AI platforms process. Almost none of these
companies publish that number regularly, so most of what you see is an estimate. This page explains,
in plain language, exactly how every number is made — every formula, every assumption, every source.
It mirrors the in-site "How we estimate" page.

> **Independent project.** Not affiliated with, endorsed by, or sponsored by any company shown.
> Figures are estimates unless marked **Reported**.

---

## 1. What is a token?

A token is the unit AI models read and write — roughly ¾ of an English word (about 4 characters).
"Tokens processed" counts both what goes **in** (your prompt, plus system instructions, conversation
history, documents and web pages the app adds) and what comes **out** (the answer, including hidden
"reasoning" tokens). Input is usually the larger share: in DeepSeek's published production day,
608 billion tokens went in and 168 billion came out.

## 2. Three tiers of data — always labeled

| Badge                 | Meaning                                                                                         | Example                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Reported** (green)  | The company, or a primary source, published the figure. Shown with the source and date.         | "ByteDance: Doubao models process 180 trillion tokens a day (June 2026)."        |
| **Estimated** (amber) | Calculated from reported or published inputs. The formula is shown.                             | Reported users × a published tokens-per-request benchmark.                       |
| **Modeled** (grey)    | Relies on at least one assumption for which no public data exists. The assumption is explained. | Converting users to tokens with a judgement about how many messages people send. |

**The weakest input decides the tier.** A calculation that uses one judgement call is Modeled, even if
every other input is Reported. Pure unit conversions (per month → per day) don't weaken a tier.

**"Reported" expires.** A reported figure describes one moment. A value is shown as Reported only
within **14 days** of a reported figure. Beyond that it is extrapolated, and says so.

Every number on screen is one click or tap from its tier, formula, range and sources.

## 3. From published figures to tokens per day

Each published figure becomes an **anchor**: a tokens-per-day value at a date. There are four methods.

| Method   | Formula                                                                      | Typical tier        |
| -------- | ---------------------------------------------------------------------------- | ------------------- |
| Tokens   | reported tokens per period ÷ days in the period                              | Reported            |
| Requests | requests per day × tokens per request                                        | Estimated / Modeled |
| Users    | users × share active per day × requests per active user × tokens per request | Modeled             |
| Revenue  | annual revenue ÷ 365 × share that pays for tokens ÷ price per token          | Modeled             |

For agentic coding tools, "requests per active user × tokens per request" is replaced by a direct
**tokens per active developer-day**, anchored on Anthropic's published average cost of about $13 per
developer per active day for Claude Code.

**Scope matters.** Each HQ states exactly what it counts (for example: "Google's Gemini models across
Google products and APIs"). Where a platform has distinct parts — a consumer app and an API — each part
has its own curve and the HQ shows their sum.

## 4. Filling in the time between figures

Published figures are sparse. Between them we draw a **piecewise-exponential curve**:

- **Between two anchors:** constant growth rate (a straight line on a log chart).
- **From launch to the first figure:** an exponential ramp from a small seed (3% of the first figure,
  range 1–10%) — Modeled.
- **After the latest figure:** we continue at the recent growth rate (measured from the most recent
  figure at least two months older, clamped between halving and ×10 per year), and let that growth
  rate fade with a one-year time constant, so no curve runs away. The uncertainty band **widens** the longer we extrapolate: after a
  year, by a further ×2 each way.

**Tokens since launch** is the area under this curve. It is never better than Estimated, and it is
Modeled if more than 5% of the total comes from Modeled segments (such as the launch ramp).

## 5. The live counters

The counters tick in real time, but they are not random and not an animation. At any instant,

```
tokens per second = (tokens per day ÷ 86,400) × traffic shape
total so far      = ∫ tokens per second dt          (exact, from launch)
tokens today      = total now − total at 00:00 UTC
since you arrived = total now − total when you opened the page
```

- The **traffic shape** follows a 24-hour and 7-day cycle in each region's local time, weighted by where
  a platform's users are (five regions: North America, Latin America, Europe & Africa, South Asia &
  Middle East, East Asia & Pacific). It averages exactly to 1, so it moves tokens around the clock
  without changing the daily total. That is why Asian platforms light up while the Americas sleep.
- The integral is computed **in closed form**, not by adding up frames, using our own arithmetic that
  gives bit-identical results in every browser. **Every visitor sees the same number at the same
  moment.** Cosmetic effects (particles, flicker) never feed into the numbers.

The shape's amplitudes are Modeled. The only published production load curve we found is DeepSeek's
(peak 278 nodes vs a 24-hour average of 226.75, "high load during the day, low at night"); we use a
day/night swing of roughly 2 : 1 for a single region, flatter for globally spread platforms.
Daylight saving time is ignored.

## 6. From tokens to GPUs, power and water

| Quantity        | Formula                                | Central value (range)                            |
| --------------- | -------------------------------------- | ------------------------------------------------ |
| GPU-equivalents | tokens per second ÷ throughput per GPU | 5,000 tokens/s per H100-class GPU (1,500–15,000) |
| Power           | GPUs × IT power per GPU × PUE          | 1.0 kW per GPU (0.6–1.5) × PUE 1.2 (1.09–1.5)    |
| Energy per day  | average power × 24 h                   | —                                                |
| On-site water   | energy × water use effectiveness       | 0.4 L/kWh (0.15–1.1)                             |
| Homes powered   | power ÷ average household demand       | shown once the EIA figure is verified            |

**Throughput is the biggest uncertainty in the whole project.** The only real production figure is
DeepSeek's: 776 billion tokens in 24 hours on an average of 226.75 servers of 8 H800 GPUs — about
4,950 tokens per second per GPU, including the 56% of input served from cache. Its own numbers check
out: 608B ÷ 73.7k tokens/s per server (prefill) plus 168B ÷ 14.8k tokens/s (decode) ≈ 227 server-days.
Bigger dense models run slower; newer Blackwell-class hardware and cache-heavy traffic run several times
faster (MLPerf, InferenceMAX). We apply one H100-equivalent figure to every platform with a wide range,
so **every hardware, power and water number is Modeled**.

Water is **on-site cooling water only**; it excludes the (larger) water used to generate electricity.

### Cross-check: energy per prompt

Our model implies about 0.24 J per token (1.0 kW × 1.2 ÷ 5,000 tokens/s). A typical chat request of
2,000–3,000 tokens (instructions, history, answer, reasoning) therefore uses about 0.1–0.2 Wh, with a
range that comfortably contains Google's measured median of **0.24 Wh** per Gemini text prompt and
OpenAI's stated **0.34 Wh** average per ChatGPT query. A unit test enforces this.

## 7. Uncertainty ranges

Every number has a low / central / high value. We read each input's range as a ~90% plausible interval
around its central value and combine them the way independent uncertainties combine — in quadrature on
a log scale, keeping the low and high sides separate. (Simply multiplying all the lows together would
describe a one-in-a-million coincidence, not a plausible low case.) Totals across platforms add the lows
and add the highs, because platforms share assumptions. The live counter shows the central value; the
info panel shows the range.

How a figure was phrased also matters: "over 1.3 quadrillion" is used as 1.3 quadrillion central and
low, up to +15% high; "about" gets ±10%; exact primary figures get ±3%; third-party estimates are widened
further.

## 8. Avoiding double counting

Some products call other listed platforms' models — a coding tool that uses a lab's API, for example.
Each HQ still shows everything its product handles, but the **global total** removes each product's
estimated share of tokens that another listed platform already counts.

## 9. Fun equivalences

"Tokens today = N × every book in the Library of Congress" and similar comparisons are built from cited
constants (for example 1 word ≈ 1.33 tokens) and carry ranges. An equivalence is shown only once every
constant behind it has been checked against its source.

## 10. Known limitations

- Most platforms do not publish token volumes; for those, the user-based methods dominate and their
  assumptions (messages per user, tokens per message) are judgement calls.
- Chinese user numbers are mostly for China only (QuestMobile), missing international users.
- Hardware efficiency differs enormously between platforms and over time; we use one H100-equivalent.
- The daily data pipeline tracks new model releases and incidents automatically; reported usage
  figures are curated by hand in `data/manual/metrics.yaml` (see `UPDATING.md`).

## 11. Sources

Every source is listed with its URL and the date we accessed it: platform figures in
`data/manual/metrics.yaml` (shown in-site next to each figure), constants in `src/model/constants.ts`.
Some figures were verified only from search-result summaries of the source during research; these are
marked `verified: snippet` and are listed for re-checking in `TASKS.md`.
