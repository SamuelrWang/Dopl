// Claude Code's context windows and usage readers. ⚠ The frozen model table, its id -> alias map and the
// launch-default id are DELETED (2026-10-08): the roster is live only and the default is the CLI's alias.
// Requires nothing.

// ─── BEGIN CLAUDE-MODEL-TABLE (pure; unit-tested via source extraction) ───────────

const WINDOW_200K = 200000;
const WINDOW_1M = 1000000;

// Keyed by alias (a denominator before the first turn reports an id) and by the ids the SDK reports.
const CONTEXT_WINDOWS = {
  opus: WINDOW_1M,
  sonnet: WINDOW_1M,
  haiku: WINDOW_1M, // the alias is Haiku 5.5 since runtime 0.3.293
  fable: WINDOW_1M,
  'claude-opus-5-5': WINDOW_1M,
  'claude-opus-5': WINDOW_1M,
  'claude-opus-4-8': WINDOW_1M,
  'claude-opus-4-7': WINDOW_1M,
  'claude-opus-4-6': WINDOW_200K, // 1M only via the [1m] suffix
  'claude-opus-4-5': WINDOW_200K,
  'claude-opus-4-1': WINDOW_200K,
  'claude-opus-4': WINDOW_200K,
  'claude-opus-4-0': WINDOW_200K,
  'claude-sonnet-5-5': WINDOW_1M,
  'claude-sonnet-5': WINDOW_1M,
  'claude-sonnet-4-6': WINDOW_200K,
  'claude-sonnet-4-5': WINDOW_200K,
  'claude-sonnet-4': WINDOW_200K,
  'claude-sonnet-4-0': WINDOW_200K,
  'claude-haiku-5-5': WINDOW_1M,
  'claude-haiku-4-5': WINDOW_200K,
  'claude-fable-5-1': WINDOW_1M,
  'claude-fable-5': WINDOW_1M,
  'claude-mythos-5-1': WINDOW_1M,
  'claude-mythos-5': WINDOW_1M,
};

// A model newer than this table (2026-10-08, Samuel): every Claude family from generation 5 on ships
// a 1M window, so `claude-<family>-<N>…` with N >= 5 reads 1M rather than an empty meter. Older
// generations varied (200k vs 1M), so an unlisted pre-5 id stays unknown.
const FAMILY_1M_RE = /^claude-(?:opus|sonnet|fable|haiku|mythos)-(\d+)(?:-\d+)*$/;
const FAMILY_1M_FROM = 5;

/** The window for a model id or alias: the table, else the generation-5+ family rule, else `null`. */
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
  const family = FAMILY_1M_RE.exec(undated);
  if (family && Number(family[1]) >= FAMILY_1M_FROM) return WINDOW_1M;
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
  contextWindowFor,
  promptTokens,
  sessionTokens,
};
