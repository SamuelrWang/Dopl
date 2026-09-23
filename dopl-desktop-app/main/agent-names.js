// What the operator calls one agent (and what it is FOR): local display state keyed by the instance `agentId`
// (it survives parks and resumes). It NAMES, it never ADDRESSES — every op and `@<agentId>` still resolve by id,
// or a rename could re-point a running instruction. Reaches no network.

const Store = require('electron-store');

const store = new Store();
// { [agentId]: { name, description, at } }
const NAMES_KEY = 'agentNames';

// ─── BEGIN AGENT-NAMES-PURE (pure; unit-tested via source extraction) ──────────

// `store` is a free var from here down.

// Bounded for a card's title line (and the column CHECK the push sanitizes to).
const MAX_NAME = 60;

// The identity description's own cap (`agent-identities/schema.ts`): one question, one cap.
const MAX_DESCRIPTION = 2000;

// A count bound (names do not expire), oldest dropped first.
const MAX_NAMES = 500;

// Trim, collapse, bound; control / zero-width / bidi / line-separator characters are REFUSED, not stripped (stripping
// would store something other than what was typed). Null when nothing is storable.
function sanitizeName(value) {
  if (typeof value !== 'string') return null;
  if (/[\x00-\x1f\x7f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/.test(value)) {
    return null;
  }
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > MAX_NAME) return null;
  return clean;
}

// The description's twin, differing on newlines: `SAFE_PROSE_RE`'s charset (`\t\n\r` legal). '' is a legitimate
// answer (clear the field); null means it could not be stored.
function sanitizeDescription(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (clean === '') return '';
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/.test(clean)) {
    return null;
  }
  return clean.length > MAX_DESCRIPTION ? null : clean;
}

function sweepable(map, max = MAX_NAMES) {
  const keys = Object.keys(map || {});
  if (keys.length <= max) return [];
  return keys
    .sort((a, b) => Number((map[a] || {}).at || 0) - Number((map[b] || {}).at || 0))
    .slice(0, keys.length - max);
}

// Null is the ordinary answer (never renamed): the caller falls back to `Agent #<id>`.
function nameFrom(map, agentId) {
  const id = String(agentId || '');
  const row = id && map ? map[id] : null;
  const name = row && typeof row.name === 'string' ? row.name : '';
  return name || null;
}

function descriptionFrom(map, agentId) {
  const id = String(agentId || '');
  const row = id && map ? map[id] : null;
  const value = row && typeof row.description === 'string' ? row.description : '';
  return value || null;
}

// Merge ONE field onto a row, keeping the other (a whole-row replace would destroy it). An empty field is dropped
// from the row, and a row with neither field is deleted.
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

// A tick-scoped memo of the name map: `store.get()` re-reads and re-parses the file, and the summary asks twice per
// row. Safe because a projection is synchronous. This module is the ONLY writer of NAMES_KEY and every write
// invalidates the memo; a writer added elsewhere must call `invalidateNames()`.
let cachedNames = null;
let cacheArmed = false;

function invalidateNames() {
  cachedNames = null;
}

function all() {
  if (cachedNames) return cachedNames;
  const map = store.get(NAMES_KEY);
  const out = map && typeof map === 'object' ? map : {};
  cachedNames = out;
  if (!cacheArmed) {
    cacheArmed = true;
    const t = setImmediate(() => { cachedNames = null; cacheArmed = false; });
    if (t && typeof t.unref === 'function') t.unref();
  }
  return out;
}

/** The rename write: answers MAIN's stored value (never an echo) or null when refused; the description survives. */
function rename(agentId, value) {
  const id = String(agentId || '');
  if (!id) return null;
  const name = sanitizeName(value);
  if (name === null) return null;
  store.set(NAMES_KEY, patched(all(), id, 'name', name));
  invalidateNames();
  return name;
}

/** The description write, rename's twin: '' when cleared, null when refused. */
function describe(agentId, value) {
  const id = String(agentId || '');
  if (!id) return null;
  const description = sanitizeDescription(value);
  if (description === null) return null;
  store.set(NAMES_KEY, patched(all(), id, 'description', description));
  invalidateNames();
  return description;
}

/** Clear the NAME (not the description): how the operator goes back to `Agent #<id>`. */
function clear(agentId) {
  const id = String(agentId || '');
  if (!id) return;
  store.set(NAMES_KEY, patched(all(), id, 'name', ''));
  invalidateNames();
}

/** What the summary projects. */
function displayNameFor(agentId) {
  return nameFrom(all(), agentId);
}

function descriptionForAgent(agentId) {
  return descriptionFrom(all(), agentId);
}

module.exports = {
  MAX_NAME,
  MAX_DESCRIPTION,
  MAX_NAMES,
  sanitizeName,
  sanitizeDescription,
  sweepable,
  nameFrom,
  descriptionFrom,
  patched,
  rename,
  describe,
  clear,
  displayNameFor,
  descriptionForAgent,
};
