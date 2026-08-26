// WHAT THE OPERATOR CALLS ONE AGENT (2026-08-25, Samuel's ruling).
//
// ⚠ IDENTITY LIVES ON THIS MACHINE, WHICH IS WHY THIS FILE IS HERE AND NOT ON THE SERVER. An
// agent is local runtime state (`session-summary.js`; INVARIANTS §5) — the server's
// `channel_sessions` is a one-way PROJECTION this machine pushes, so a name written there
// would be overwritten by the next report and could not pass that column's handle CHECK
// (`^[a-z][a-z0-9-]{1,30}$`) anyway. The renderer reads the name off the summary, exactly as it
// reads every other fact about an agent.
//
// ⚠ KEYED BY `agentId`, THE INSTANCE ADDRESS (`main/agent-id.js`), not by session key. The
// session OBJECT is replaced by an idle park, a lazy resume and a crash resume; the operator's
// mental model — "the one I called Research" — survives all three, and so does the id.
//
// ⚠ IT NAMES, IT NEVER ADDRESSES. Nothing resolves an agent by this string: `@<agentId>` in a
// thread body is still parsed against the id (`session-dispatch.js`), and every op takes the id
// as its third coordinate. A display name that could address something would let a rename
// silently re-point a running instruction.
//
// ⚠ LOCAL-ONLY DISPLAY, DELIBERATELY (2026-08-25). A peer's card still shows what their machine
// reports; widening `channel_sessions` with a human-charset column is a separate, additive
// change and is NOT in this one. Nothing here reaches the network.

const Store = require('electron-store');

const store = new Store();
const NAMES_KEY = 'agentNames'; // { [agentId]: { name, at } }

// ─── BEGIN AGENT-NAMES-PURE (pure; unit-tested via source extraction) ──────────
// `store` is a free var from here down.

/** The operator types this, so it is bounded for a RENDERER rather than for a column. 60 is
 *  Samuel's; it fits a card's title line at the app's `text-body` without truncating. */
const MAX_NAME = 60;

/**
 * A BOUND ON THE SET, because a per-instance key is unbounded in principle: every launch mints
 * a new id, so a busy machine accumulates one entry per agent it ever ran. Drops the OLDEST
 * first. Far above what any real session produces — the CLOCK does not apply here (a name has
 * no expiry the way an ended run does), so a count is the whole bound.
 */
const MAX_NAMES = 500;

/**
 * TRIM, COLLAPSE, BOUND, REFUSE THE INVISIBLES — the same discipline every display string on
 * its way to a renderer gets (`session-summary.js › displayText`, and the bounds
 * `20260805120000_channel_sessions.sql` sets on its peer-influenced columns).
 *
 * ⚠ CONTROL, ZERO-WIDTH, BIDI AND LINE-SEPARATOR CHARACTERS ARE REFUSED, NOT STRIPPED. Stripping
 * would silently store something other than what was typed; refusing says the name was not
 * taken. A bidi override in an agent name renders a card that reads backwards, and a
 * zero-width joiner makes two different names look identical.
 *
 * Returns the clean string, or null when there is nothing storable.
 */
function sanitizeName(value) {
  if (typeof value !== 'string') return null;
  if (/[\x00-\x1f\x7f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/.test(value)) {
    return null;
  }
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > MAX_NAME) return null;
  return clean;
}

/** Newest-last insertion order is the store's own; the sweep drops from the front. */
function sweepable(map, max = MAX_NAMES) {
  const keys = Object.keys(map || {});
  if (keys.length <= max) return [];
  return keys
    .sort((a, b) => Number((map[a] || {}).at || 0) - Number((map[b] || {}).at || 0))
    .slice(0, keys.length - max);
}

/** The display name for one agent id, or null. ⚠ NULL IS THE ORDINARY ANSWER — most agents are
 *  never renamed, and the caller falls back to the canonical `Agent #<id>`. */
function nameFrom(map, agentId) {
  const id = String(agentId || '');
  const row = id && map ? map[id] : null;
  const name = row && typeof row.name === 'string' ? row.name : '';
  return name || null;
}

// ─── END AGENT-NAMES-PURE ──────────────────────────────────────────────────────

function all() {
  const map = store.get(NAMES_KEY);
  return map && typeof map === 'object' ? map : {};
}

/** The rename write. Returns the stored name, or null when the input was refused —
 *  ⚠ MAIN'S OWN VALUE, never an echo of the ask: a renderer that stamped what it sent would
 *  paint a name this machine did not take. Same rule `setMode` / `setModel` follow. */
function rename(agentId, value) {
  const id = String(agentId || '');
  if (!id) return null;
  const name = sanitizeName(value);
  if (name === null) return null;
  const map = all();
  map[id] = { name, at: Date.now() };
  for (const key of sweepable(map)) delete map[key];
  store.set(NAMES_KEY, map);
  return name;
}

/** Drop a name — an empty rename is how the operator goes back to `Agent #<id>`. */
function clear(agentId) {
  const id = String(agentId || '');
  if (!id) return;
  const map = all();
  if (!(id in map)) return;
  delete map[id];
  store.set(NAMES_KEY, map);
}

/** What the summary projects. Reads the whole map once per flush, not once per session. */
function displayNameFor(agentId) {
  return nameFrom(all(), agentId);
}

module.exports = {
  // pure core (re-exported for the shell + the tests)
  MAX_NAME,
  MAX_NAMES,
  sanitizeName,
  sweepable,
  nameFrom,
  // the live half
  rename,
  clear,
  displayNameFor,
};
