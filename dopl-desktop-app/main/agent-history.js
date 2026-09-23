// What an ended agent leaves behind: a durable, READ-ONLY history (narration, what it sent, the 1:1 exchange, its
// identity and final numbers) kept SEVEN DAYS from `endedAt`. Nothing here can wake anything, and channel messages
// are never in it (they are the server's shared record). Written once at `settle`, never per frame: a hard kill
// loses the ring of a session that was live.

const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();
// { [sessionKey]: durable ended-agent record }
const HISTORY_KEY = 'agentHistory';

// ─── BEGIN AGENT-HISTORY-PURE (pure; unit-tested via source extraction) ──────────

// `store` and `diag` are free vars from here down.

// The retention window, in one place.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// A count belt beside the clock (a time bound alone is not a bound); oldest first.
const MAX_HISTORY = 200;

// null means UNMEASURED and never becomes 0.
function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// A bounded display string (80 by default; a field with a real server bound passes it), or null.
function historyName(value, max) {
  if (typeof value !== 'string') return null;
  const cap = typeof max === 'number' && max > 0 ? max : 80;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap).trim();
  return s || null;
}

// Whitelist what a record may carry (a live handle never reaches disk; an unnamed field is DROPPED). `entries`
// is the narration ring, already bounded and stripped of `inputFull`.
function durableHistory(rec) {
  const r = rec || {};
  return {
    key: String(r.key || ''),
    agentId: String(r.agentId || ''),
    sessionId: String(r.sessionId || ''),
    channelId: String(r.channelId || ''),
    taskId: String(r.taskId || ''),
    workspaceId: String(r.workspaceId || ''),
    channelName: historyName(r.channelName),
    threadTitle: historyName(r.threadTitle),
    // At the column's 120, not the 80 display default: clipping at the write reports a name no identity has (F-287).
    identityName: historyName(r.identityName, 120),
    endedAt: Number(r.endedAt) || 0,
    // Why the run stopped, when not the operator's doing (F-692).
    diag: historyName(r.diag, 200),
    // The vendor-neutral end code and its runtime (re-said at read time by `session-detail.js › endReasonFor`),
    // bounded strings or null.
    endCode: historyName(r.endCode, 40),
    runtimeId: historyName(r.runtimeId, 32),
    // The final measurement, frozen: null is a real answer and never zero.
    startedAt: numberOrNull(r.startedAt),
    lastActivityAt: numberOrNull(r.lastActivityAt),
    contextUsed: numberOrNull(r.contextUsed),
    contextWindow: numberOrNull(r.contextWindow),
    tokensSpent: numberOrNull(r.tokensSpent),
    entries: Array.isArray(r.entries) ? r.entries : [],
  };
}

// Compared on `endedAt` (a clock jump sweeps early or late, never something live); no usable `endedAt` is ancient.
function expired(rec, now) {
  return (Number(now) || 0) - (Number(rec && rec.endedAt) || 0) >= RETENTION_MS;
}

// PURE: which keys the sweep drops — age first, then the count belt; garbage always goes.
function sweepableKeys(all, now) {
  const records = all || {};
  const drop = [];
  const survivors = [];
  for (const key of Object.keys(records)) {
    const rec = records[key];
    if (!rec || typeof rec !== 'object') { drop.push(key); continue; }
    if (expired(rec, now)) drop.push(key);
    else survivors.push(key);
  }
  const excess = survivors.length - MAX_HISTORY;
  if (excess > 0) {
    survivors.sort((a, b) => (Number(records[a].endedAt) || 0) - (Number(records[b].endedAt) || 0));
    for (const key of survivors.slice(0, excess)) drop.push(key);
  }
  return drop;
}

// ─── END AGENT-HISTORY-PURE ──────────────────────────────────────────────────────

function loadAll() {
  try {
    const raw = store.get(HISTORY_KEY);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (_err) { return {}; }
}

function saveAll(all) {
  try { store.set(HISTORY_KEY, all); }
  catch (err) { diag('agent-history: could not persist —', (err && err.message) || String(err)); }
}

/** Freeze an ended session's history, once, from `session-teardown.js › settle` before the registry entry goes.
 *  Never throws: `settle` must still abort the child. */
function record(rec) {
  const r = durableHistory(rec);
  if (!r.key || !r.endedAt) return false;
  const all = loadAll();
  all[r.key] = r;
  saveAll(all);
  return true;
}

function historyFor(key) {
  const rec = loadAll()[String(key || '')];
  return rec && typeof rec === 'object' ? rec : null;
}

/** Every retained record, oldest first — the ended cards. Records, never sessions: nothing may resume one. */
function listEnded() {
  const all = loadAll();
  return Object.keys(all)
    .map((k) => all[k])
    .filter((r) => r && typeof r === 'object' && r.key)
    .sort((a, b) => (Number(a.endedAt) || 0) - (Number(b.endedAt) || 0));
}

// Drop keys whatever their age: a deleted thread takes its agents' histories with it.
function forget(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  const all = loadAll();
  let dropped = 0;
  for (const key of list) {
    const k = String(key || '');
    if (k && k in all) { delete all[k]; dropped += 1; }
  }
  if (dropped) saveAll(all);
  return dropped;
}

function keysForThread(prefix) {
  const p = String(prefix || '');
  if (!p) return [];
  return Object.keys(loadAll()).filter((k) => k.indexOf(p) === 0);
}

// Drop expired records and return their keys so `agent-retention.js` can clean the other stores in one pass.
function sweep(now) {
  const all = loadAll();
  const keys = sweepableKeys(all, Number(now) || Date.now());
  if (!keys.length) return [];
  for (const key of keys) delete all[key];
  saveAll(all);
  return keys;
}

module.exports = {
  RETENTION_MS,
  MAX_HISTORY,
  historyName,
  numberOrNull,
  durableHistory,
  expired,
  sweepableKeys,
  record,
  historyFor,
  listEnded,
  forget,
  keysForThread,
  sweep,
};
