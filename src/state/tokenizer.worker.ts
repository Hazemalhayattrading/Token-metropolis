/**
 * The o200k tokenizer in a worker (see createTokenizerLoader in ./prompt.ts): loading it parses a
 * 200k-entry vocabulary and builds its lookup table, a long task that would freeze the city and
 * the text box on the main thread. Messages: in {id, text}; out {type: 'ready'} once loaded,
 * {type: 'error', message} if the load failed, {type: 'count', id, count | error} per request.
 */
const options = { disallowedSpecial: new Set<string>() };
let countTokens: ((text: string, o: typeof options) => number) | null = null;

import('gpt-tokenizer/encoding/o200k_base').then(
  (m) => {
    countTokens = m.countTokens;
    postMessage({ type: 'ready' });
  },
  (e: unknown) =>
    postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
);

addEventListener('message', (e: MessageEvent<{ id: number; text: string }>) => {
  const { id, text } = e.data;
  try {
    if (!countTokens) throw new Error('The tokenizer is not loaded.');
    // "<|endoftext|>" and the like count as ordinary characters, as chat apps treat user input.
    postMessage({ type: 'count', id, count: text === '' ? 0 : countTokens(text, options) });
  } catch (err) {
    postMessage({ type: 'count', id, error: err instanceof Error ? err.message : String(err) });
  }
});
