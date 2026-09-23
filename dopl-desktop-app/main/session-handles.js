// THE ONE TEARDOWN OF A SESSION'S LIVE QUERY (P4-14).
//
// Abort the signal, close the prompt stream, close the runtime's own handle. The last step is the
// only thing that ends a Codex child (its adapter reads no abort signal), and a thread has one
// writer, so a teardown that skips it leaks a process still holding the thread. Claude's query has
// no `close`, so the guarded call is a no-op there. Requires nothing: every caller can reach it.

/**
 * `opts.supersede` also nulls `s.query`, which makes the old consume loop inert (`s.query !== q`).
 * Best effort by construction: a teardown that throws would strand the caller mid-way.
 */
function teardownHandles(s, opts) {
  if (!s) return;
  const prior = s.query;
  try { if (s.abortController) s.abortController.abort(); } catch (_) { /* best effort */ }
  try { if (s.pushIterator) s.pushIterator.close(); } catch (_) { /* best effort */ }
  try { if (prior && typeof prior.close === 'function') prior.close(); } catch (_) { /* best effort */ }
  if (opts && opts.supersede === true) s.query = null;
}

module.exports = { teardownHandles };
