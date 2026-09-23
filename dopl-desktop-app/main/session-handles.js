// The one teardown of a session's live query: abort the signal, close the prompt stream, close the
// runtime handle. The last step is the only thing that ends a Codex child (a thread has one writer);
// Claude's query has no `close`, so it is a no-op there. Requires nothing (P4-14).

/** `opts.supersede` also nulls `s.query`, making the old consume loop inert (`s.query !== q`). Never throws. */
function teardownHandles(s, opts) {
  if (!s) return;
  const prior = s.query;
  try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
  try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
  try { if (prior && typeof prior.close === 'function') prior.close(); } catch (_) { /* best effort */ }
  if (opts && opts.supersede === true) s.query = null;
}

module.exports = { teardownHandles };
