// Claude Code's frozen model table: the picker's fallback when the live roster (`roster.js`) cannot
// be read, the id -> argv alias map an old record may still carry, the context windows, and the
// usage readers. Transcribed from the bundled CLI's alias table and model registry, never from
// memory; do not add a row for a model the live roster already offers. Requires nothing.

// ─── BEGIN CLAUDE-MODEL-TABLE (pure; unit-tested via source extraction) ───────────

// Full ids the fallback picker offers. The alias is what reaches `--model` (version-stable); the
// dated haiku id resolving to the `haiku` alias is deliberate.
const MODEL_IDS = [
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
];
const ID_TO_ALIAS = {
  'claude-fable-5': 'fable',
  'claude-opus-5': 'opus',
  'claude-sonnet-5': 'sonnet',
  'claude-haiku-4-5-20251001': 'haiku',
};

/** The argv alias for a listed id, or `'default'` (no pick) for anything else. */
function aliasForModelId(value) {
  return Object.prototype.hasOwnProperty.call(ID_TO_ALIAS, value) ? ID_TO_ALIAS[value] : 'default';
}

// The product's default model for a launch with no pick (Samuel's back-fill ruling). Its web twin,
// `agent-models.ts › AGENT_MODEL_FALLBACK`, is pinned against it by test/claude-model-table.test.mjs.
const LAUNCH_MODEL_FALLBACK = 'claude-sonnet-5';

const WINDOW_200K = 200000;
const WINDOW_1M = 1000000;

// Keyed by alias (a denominator before the first turn reports an id) and by the ids the SDK reports.
const CONTEXT_WINDOWS = {
  opus: WINDOW_1M,
  sonnet: WINDOW_1M,
  haiku: WINDOW_200K,
  fable: WINDOW_1M,
  'claude-opus-5': WINDOW_1M,
  'claude-opus-4-8': WINDOW_1M,
  'claude-opus-4-7': WINDOW_1M,
  'claude-opus-4-6': WINDOW_200K, // 1M only via the [1m] suffix
  'claude-opus-4-5': WINDOW_200K,
  'claude-opus-4-1': WINDOW_200K,
  'claude-opus-4': WINDOW_200K,
  'claude-opus-4-0': WINDOW_200K,
  'claude-sonnet-5': WINDOW_1M,
  'claude-sonnet-4-6': WINDOW_200K,
  'claude-sonnet-4-5': WINDOW_200K,
  'claude-sonnet-4': WINDOW_200K,
  'claude-sonnet-4-0': WINDOW_200K,
  'claude-haiku-4-5': WINDOW_200K,
  'claude-fable-5': WINDOW_1M,
  'claude-mythos-5': WINDOW_1M,
};

/** The window for a model id or alias, or `null` when this table cannot say (never a guess). */
function contextWindowFor(model) {
  const id = typeof model === 'string' ? model.trim() : '';
  if (!id) return null;
  // The `[1m]` suffix IS the window, read before the base row (which says 200k).
  if (id.slice(-4) === '[1m]') return WINDOW_1M;
  if (Object.prototype.hasOwnProperty.call(CONTEXT_WINDOWS, id)) return CONTEXT_WINDOWS[id];
  const undated = id.replace(/-\d{8}$/, ''); // a dated id is its undated row
  if (undated !== id && Object.prototype.hasOwnProperty.call(CONTEXT_WINDOWS, undated)) {
    return CONTEXT_WINDOWS[undated];
  }
  return null;
}

// A usage field as a count: missing or junk reads 0, never NaN.
function count(v) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/** Occupancy: the prompt the model LAST saw (uncached input + cache reads + cache writes). Output
 *  is excluded — it occupies the window only as the next turn's input. */
function promptTokens(usage) {
  const u = usage || {};
  return count(u.input_tokens) + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens);
}

/** Spend: every token this QUERY billed, output included. The `result` usage is cumulative within
 *  a query and restarts on a resumed one; core sums the deltas (`session-io.js › applyCoreEvents`). */
function sessionTokens(usage) {
  const u = usage || {};
  return count(u.input_tokens) + count(u.output_tokens)
    + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens);
}

// ─── END CLAUDE-MODEL-TABLE ───────────────────────────────────────────────────────

module.exports = {
  MODEL_IDS,
  aliasForModelId,
  LAUNCH_MODEL_FALLBACK,
  contextWindowFor,
  promptTokens,
  sessionTokens,
};
