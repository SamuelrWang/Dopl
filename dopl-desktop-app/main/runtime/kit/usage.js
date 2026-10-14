// Token-usage readers an adapter's `normalize.js` builds on (docs/specs/runtime-scaffold.md §3 K4).
// Pure, no requires, vendor-neutral. THE RULE THEY CARRY (INVARIANTS §11.0a): a count that could not be
// read is NULL, never 0 — a renamed field must read as UNKNOWN, or core resets the baseline to zero and
// bills the next total twice. Each adapter passes its OWN key lists; the cache convention (whether a
// cached-read figure is a subset of the input or an addition to it) is the adapter's measurement and is
// expressed by whether it passes `cached` keys — the kit never reconciles two conventions.

/** A count read off a vendor frame: a finite number ≥ 0, else NULL — never 0 for "not there". */
function readCount(obj, ...pathParts) {
  let cur = obj;
  for (const p of pathParts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[p];
  }
  return typeof cur === 'number' && Number.isFinite(cur) && cur >= 0 ? cur : null;
}

/** The first readable count among `keys` (spellings of one field), or NULL — never 0 for "not there". */
function firstCount(usage, keys) {
  for (const k of keys) {
    const v = usage[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

/**
 * `{ prompt, session }` — the window occupancy, and the turn's whole token total. NULL for what could
 * not be read. `keys = { input, cached?, output, total }`, each a list of spellings, first readable
 * wins. `cached` is ADDED to the input (an additive cache convention); omit it where the vendor's
 * cached figure is a subset of the input. An absent cached figure is none, not unknown.
 */
function tokensFrom(usage, keys) {
  if (!usage || typeof usage !== 'object') return { prompt: null, session: null };
  const input = firstCount(usage, keys.input);
  const cached = firstCount(usage, keys.cached || []) || 0; // absent cache reads are none, not unknown
  const output = firstCount(usage, keys.output);
  const total = firstCount(usage, keys.total);
  const prompt = input !== null ? input + cached : null;
  const sum = input !== null && output !== null ? input + cached + output : null;
  return { prompt, session: total !== null ? total : sum };
}

/**
 * The cumulative-total carry. Where a vendor's total is cumulative per conversation and an interrupted
 * turn gets no usage update, the last total seen is carried onto the turn that completes without one.
 * `observe(total)` on every usage update; `forTurn(latest)` at turn completion → `latest`, else the
 * carried total (NULL if none was ever seen).
 */
function makeUsageCarry() {
  let lastTotal = null;
  return {
    observe(total) { if (total) lastTotal = total; },
    forTurn(latest) { return latest ? latest : lastTotal; },
  };
}

module.exports = { readCount, firstCount, tokensFrom, makeUsageCarry };
