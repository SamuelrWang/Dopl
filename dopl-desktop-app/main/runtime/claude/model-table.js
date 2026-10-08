// Claude Code's usage readers. ⚠ NO MODEL DATA (2026-10-08): the frozen model table, its id -> alias map,
// the launch-default id and the context-window table (with its family guess) are DELETED. The roster is
// live (`models.js`), the default is the CLI's `sonnet` alias, and every window is the one the CLI reports
// on a `result` (`normalize.js › learnWindows`). Requires nothing.

// ─── BEGIN CLAUDE-MODEL-TABLE (pure; unit-tested via source extraction) ───────────

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
  promptTokens,
  sessionTokens,
};
