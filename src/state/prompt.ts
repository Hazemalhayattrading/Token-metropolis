/**
 * "Your prompt, visualized" (brief §5.3 item 4) — the pure part.
 *
 * - footprintFor(): energy and on-site water of processing one prompt's tokens, straight from the
 *   model's promptFootprint() (Modeled, with ranges; METHODOLOGY.md §6).
 * - The tokenizer: gpt-tokenizer's o200k_base encoding (the tokenizer of OpenAI's GPT-4o and later
 *   models), loaded on first use through a dynamic import so it ships as its own chunk. Other
 *   companies' models split text differently; the UI says so next to every count.
 * - formatQuantity(): plain numbers for the tiny quantities involved (a prompt is milliwatt-hours).
 */
import { COMPUTE } from '../model/constants';
import { joulesPerToken, promptFootprint } from '../model/derived';
import { tierOfBasis, weakest } from '../model/tier';
import type { Estimate, Range, Tier } from '../model/types';

export interface PromptFootprintView {
  readonly tokens: number;
  readonly energyWh: Estimate;
  readonly waterMl: Estimate;
}

/** The tokenizer actually used — keep in sync with importTokenizer() below. */
export const TOKENIZER_NAME = 'o200k_base';
/** The JavaScript library that implements it in the browser. */
export const TOKENIZER_LIBRARY = 'gpt-tokenizer';

/** Longest text the prompt box accepts, in characters (UTF-16 code units, as `maxlength` counts). */
export const PROMPT_MAX_CHARS = 20_000;

/**
 * Ceiling for a token count. Far above anything the prompt box can hold (20,000 characters are at
 * most a few tens of thousands of tokens) and above the longest context windows on offer, so no
 * input can push the arithmetic to Infinity.
 */
export const MAX_PROMPT_TOKENS = 10_000_000;

/** A sane token count: an integer in [0, MAX_PROMPT_TOKENS]. NaN and negatives become 0; fractions round down. */
export function clampTokens(n: number): number {
  if (!(n > 0)) return 0;
  return Math.min(MAX_PROMPT_TOKENS, Math.floor(n));
}

/** Energy (Wh) and on-site water (mL) of processing `tokens` tokens. Both Modeled (see promptFootprint). */
export function footprintFor(tokens: number): PromptFootprintView {
  const t = clampTokens(tokens);
  const { energyWh, waterMl } = promptFootprint(t);
  return { tokens: t, energyWh, waterMl };
}

export interface PerTokenEnergy {
  /** Facility energy per token, joules. */
  readonly joules: Range;
  readonly tier: Tier;
  /** Constants behind it (constants.ts keys). */
  readonly refs: readonly string[];
  /** Central inputs, for the formula text. */
  readonly kwPerGpu: number;
  readonly pue: number;
  readonly tokensPerSecPerGpu: number;
}

/**
 * The "J/token" factor in the energy formula, with its range and inputs, so the panel can show the
 * whole chain: kW per GPU × 1,000 × PUE ÷ tokens/s per GPU.
 */
export function perTokenEnergy(): PerTokenEnergy {
  const { throughputTokensPerSecPerGpu: tp, kwPerGpu: kw, pue } = COMPUTE;
  return {
    joules: joulesPerToken(),
    // The weakest input decides the tier (the throughput transfer is an assumption → Modeled).
    tier: weakest(tierOfBasis(tp.basis), tierOfBasis(kw.basis), tierOfBasis(pue.basis)),
    refs: ['COMPUTE.throughputTokensPerSecPerGpu', 'COMPUTE.kwPerGpu', 'COMPUTE.pue'],
    kwPerGpu: kw.value,
    pue: pue.value,
    tokensPerSecPerGpu: tp.value,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * A non-negative quantity with `digits` significant figures in plain decimal notation:
 * 0.0208 → "0.021", 0.0000667 → "0.000067", 1.333 → "1.3", 66.7 → "67", 1,333.3 → "1,333".
 * (ui/format's humanNumber rounds anything below 0.005 to "0", and a single prompt is far smaller
 * than a watt-hour.) Deterministic: Number#toPrecision is exactly specified by ECMAScript.
 */
export function formatQuantity(n: number, digits = 2): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 10 ** digits) return grouped.format(Math.round(n));
  const s = n.toPrecision(digits);
  // toPrecision switches to exponential notation below 1e-6 (and when rounding reaches 10^digits).
  const m = /^(\d)(?:\.(\d+))?e([+-])(\d+)$/.exec(s);
  let out = s;
  if (m) {
    out =
      m[3] === '+'
        ? grouped.format(Math.round(Number(s)))
        : `0.${'0'.repeat(Number(m[4]) - 1)}${m[1]}${m[2] ?? ''}`;
  }
  return out.includes('.') ? out.replace(/0+$/, '').replace(/\.$/, '') : out;
}

// ---------------------------------------------------------------------------
// The tokenizer (lazy, its own chunk)
// ---------------------------------------------------------------------------

/** Counts the tokens of a text with TOKENIZER_NAME (asynchronously: the work runs in a worker). */
export type TokenCounter = (text: string) => Promise<number>;

/** The slice of the tokenizer module the counter uses (the worker's version answers later). */
export interface TokenizerModule {
  countTokens(
    text: string,
    options?: { disallowedSpecial?: Set<string> },
  ): number | Promise<number>;
}

/**
 * Import the tokenizer on this thread. The dynamic import makes it a chunk of its own (~2 MB of
 * vocabulary), fetched only when the prompt panel first needs it. Only this one encoding is
 * imported. Used where workers are unavailable (and by tests); pages use workerTokenizer().
 */
export const importTokenizer = () => import('gpt-tokenizer/encoding/o200k_base');

/**
 * The tokenizer in a module worker (./tokenizer.worker.ts), so its load — a long task of parsing
 * and table building — never blocks rendering or typing. Rejects with the worker's error message
 * (which names the failed chunk, for the retry) if the load fails.
 */
export function workerTokenizer(): Promise<TokenizerModule> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./tokenizer.worker.ts', import.meta.url), {
      type: 'module',
    });
    const waiting = new Map<number, { ok(n: number): void; fail(e: Error): void }>();
    let next = 0;
    worker.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as {
        type: string;
        id?: number;
        count?: number;
        error?: string;
        message?: string;
      };
      if (m.type === 'ready') {
        resolve({
          countTokens: (text) =>
            new Promise<number>((ok, fail) => {
              const id = next++;
              waiting.set(id, { ok, fail });
              worker.postMessage({ id, text });
            }),
        });
      } else if (m.type === 'error') {
        worker.terminate();
        reject(new Error(m.message ?? 'The tokenizer could not be loaded.'));
      } else if (m.type === 'count' && m.id !== undefined) {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error !== undefined || typeof m.count !== 'number')
          w?.fail(new Error(m.error ?? 'count failed'));
        else w?.ok(m.count);
      }
    });
    worker.addEventListener('error', (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The tokenizer worker failed.'));
    });
  });
}

/** In pages, the worker; elsewhere (tests, very old browsers) this thread. */
const defaultImporter = (): Promise<TokenizerModule> =>
  typeof Worker === 'function' && typeof window !== 'undefined'
    ? workerTokenizer()
    : importTokenizer();

export interface TokenizerLoader {
  /** Resolves with a counter once the tokenizer is loaded. A failed load is not cached: call again to retry. */
  load(): Promise<TokenCounter>;
  readonly ready: boolean;
  /** Failed attempts so far. */
  readonly failures: number;
}

/**
 * The same-origin script URL a failed dynamic import tried to fetch, if the error names it
 * (Chromium and Firefox do; Safari does not). Browsers remember a failed module fetch per URL, so
 * a retry has to ask for that file under a new URL.
 */
export function failedModuleUrl(error: unknown, origin: string): string | null {
  if (!origin) return null;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const m = /https?:\/\/[^\s'"]+?\.m?js\b/.exec(message);
  if (!m) return null;
  try {
    const url = new URL(m[0]);
    return url.origin === origin ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

function isTokenizerModule(m: unknown): m is TokenizerModule {
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof (m as { countTokens?: unknown }).countTokens === 'function'
  );
}

export function createTokenizerLoader(
  importer: () => Promise<TokenizerModule> = defaultImporter,
  /** Imports a module by URL (used to retry a failed chunk under a cache-busting URL). */
  importUrl: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url),
  origin: string = globalThis.location?.origin ?? '',
): TokenizerLoader {
  let pending: Promise<TokenCounter> | null = null;
  let ready = false;
  let failures = 0;
  let retryUrl: string | null = null;

  const attempt = (): Promise<TokenizerModule> =>
    retryUrl
      ? importUrl(`${retryUrl}?retry=${failures}`).then((m) => {
          if (!isTokenizerModule(m)) throw new Error('Unexpected tokenizer module');
          return m;
        })
      : importer();

  return {
    get ready() {
      return ready;
    },
    get failures() {
      return failures;
    },
    load() {
      pending ??= attempt().then(
        (m) => {
          // Text such as "<|endoftext|>" is counted as ordinary characters (as chat apps treat user
          // input) instead of throwing, which the library does by default for special tokens.
          const options = { disallowedSpecial: new Set<string>() };
          ready = true;
          return async (text: string) => (text === '' ? 0 : await m.countTokens(text, options));
        },
        (e: unknown) => {
          pending = null;
          failures++;
          retryUrl = failedModuleUrl(e, origin) ?? retryUrl;
          throw e;
        },
      );
      return pending;
    },
  };
}
