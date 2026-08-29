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
const NAMES_KEY = 'agentNames'; // { [agentId]: { name, description, at } }

// ─── BEGIN AGENT-NAMES-PURE (pure; unit-tested via source extraction) ──────────
// `store` is a free var from here down.

/** The operator types this, so it is bounded for a RENDERER rather than for a column. 60 is
 *  Samuel's; it fits a card's title line at the app's `text-body` without truncating. */
const MAX_NAME = 60;

/**
 * WHAT THIS AGENT IS FOR, in the operator's own words (2026-08-27, Samuel's launch-panel
 * ruling). Written at launch beside the name and shown wherever the name shows.
 *
 * ⚠ 2000 IS `agent-templates/schema.ts › DescriptionSchema` (`safeOptionalProse("Template
 * description", 2000)`), DELIBERATELY. A template's description answers the same question about
 * the same kind of thing — "what is this agent for" — and two caps on one question is how a
 * description that fits in one surface is refused by the next.
 *
 * ⚠ IT IS PROSE, WHERE THE NAME IS A LABEL, and that is the whole difference between the two
 * sanitizers below: a name is one line on a card's title, a description may hold paragraphs.
 */
const MAX_DESCRIPTION = 2000;

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

/**
 * The description's twin of {@link sanitizeName}, and the two differ on ONE axis: NEWLINES.
 *
 * ⚠ THE CHARSET IS `shared/lib/safe-label.ts › SAFE_PROSE_RE`, character for character — the
 * same class the server applies to every prose field that reaches a renderer. `\t`, `\n` and
 * `\r` are LEGAL here (a description may hold paragraphs); every control, zero-width, bidi and
 * line-separator character is refused. ⚠ REFUSED, NOT STRIPPED, for the reason `sanitizeName`
 * gives: stripping stores something other than what was typed and says nothing about it.
 *
 * ⚠ AN EMPTY DESCRIPTION IS A LEGITIMATE ANSWER, not a refusal — most launches will carry none
 * — so this returns `''` for it where `sanitizeName` returns null. The CALLER decides what an
 * empty string means (here: clear the field), which is what lets one op both set and unset.
 * Returns null only when the input could not be stored at all.
 */
function sanitizeDescription(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (clean === '') return '';
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/.test(clean)) {
    return null;
  }
  return clean.length > MAX_DESCRIPTION ? null : clean;
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

/** {@link nameFrom}'s twin. ⚠ NULL IS THE ORDINARY ANSWER here too — a description is optional
 *  at launch and most agents carry none, so every reader renders its ABSENCE rather than an
 *  empty line (INVARIANTS §11: UNKNOWN is not EMPTY). */
function descriptionFrom(map, agentId) {
  const id = String(agentId || '');
  const row = id && map ? map[id] : null;
  const value = row && typeof row.description === 'string' ? row.description : '';
  return value || null;
}

/**
 * MERGE ONE FIELD ONTO AN AGENT'S ROW, KEEPING THE OTHER — pure, so the merge rule itself is
 * testable without a disk. Returns the next map; the caller writes it.
 *
 * ⚠ IT EXISTS BECAUSE THE ROW GREW A SECOND FIELD (2026-08-27). `rename` wrote
 * `map[id] = { name, at }` — a whole-row REPLACE, which was correct while `name` was the only
 * thing in it and silently destroys the description now that it is not. Two writers, one row,
 * and whichever one forgets the other field wins.
 *
 * ⚠ AN EMPTY FIELD IS DROPPED FROM THE ROW rather than stored as `''`, so {@link nameFrom} and
 * {@link descriptionFrom} keep answering null for "never set" without either having to know
 * which spelling of empty it is looking at. A row left with NEITHER field is deleted outright —
 * an empty object per agent id is exactly the unbounded growth `MAX_NAMES` exists to bound.
 */
function patched(map, agentId, field, value) {
  const id = String(agentId || '');
  const next = { ...(map || {}) };
  if (!id) return next;
  const row = next[id] && typeof next[id] === 'object' ? { ...next[id] } : {};
  if (value) row[field] = value;
  else delete row[field];
  if (!row.name && !row.description) delete next[id];
  else next[id] = { ...row, at: Date.now() };
  for (const key of sweepable(next)) delete next[key];
  return next;
}

// ─── END AGENT-NAMES-PURE ──────────────────────────────────────────────────────

function all() {
  const map = store.get(NAMES_KEY);
  return map && typeof map === 'object' ? map : {};
}

/** The rename write. Returns the stored name, or null when the input was refused —
 *  ⚠ MAIN'S OWN VALUE, never an echo of the ask: a renderer that stamped what it sent would
 *  paint a name this machine did not take. Same rule `setMode` / `setModel` follow.
 *  ⚠ THE DESCRIPTION SURVIVES IT (2026-08-27) — see {@link patched}. */
function rename(agentId, value) {
  const id = String(agentId || '');
  if (!id) return null;
  const name = sanitizeName(value);
  if (name === null) return null;
  store.set(NAMES_KEY, patched(all(), id, 'name', name));
  return name;
}

/**
 * The description write, and its twin. Returns the stored value — `''` when the operator
 * cleared it — or null when the input was refused, on the same never-echo rule as
 * {@link rename}.
 *
 * ⚠ IT IS WRITTEN AT LAUNCH, from the composer's launch panel, in the same breath as the name
 * (`use-agent-launch.ts`). It moves no session, starts no turn and wakes nothing — the registry
 * is not consulted, exactly as `rename`'s own op states.
 */
function describe(agentId, value) {
  const id = String(agentId || '');
  if (!id) return null;
  const description = sanitizeDescription(value);
  if (description === null) return null;
  store.set(NAMES_KEY, patched(all(), id, 'description', description));
  return description;
}

/** Drop a name — an empty rename is how the operator goes back to `Agent #<id>`.
 *  ⚠ IT CLEARS THE NAME, NOT THE ROW (2026-08-27). It deleted the whole entry while `name` was
 *  the only field in it; doing that now would take the description with it, and "go back to
 *  `Agent #<id>`" says nothing about what the agent is FOR. `patched` drops the row when
 *  nothing is left, so the old behaviour is still what happens to a name-only entry. */
function clear(agentId) {
  const id = String(agentId || '');
  if (!id) return;
  store.set(NAMES_KEY, patched(all(), id, 'name', ''));
}

/** What the summary projects. Reads the whole map once per flush, not once per session. */
function displayNameFor(agentId) {
  return nameFrom(all(), agentId);
}

/** {@link displayNameFor}'s twin, projected beside it on every summary. */
function descriptionForAgent(agentId) {
  return descriptionFrom(all(), agentId);
}

module.exports = {
  // pure core (re-exported for the shell + the tests)
  MAX_NAME,
  MAX_DESCRIPTION,
  MAX_NAMES,
  sanitizeName,
  sanitizeDescription,
  sweepable,
  nameFrom,
  descriptionFrom,
  patched,
  // the live half
  rename,
  describe,
  clear,
  displayNameFor,
  descriptionForAgent,
};
