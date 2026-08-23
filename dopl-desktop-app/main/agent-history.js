// WHAT AN ENDED AGENT LEAVES BEHIND, AND FOR HOW LONG (2026-08-22, Samuel's ruling).
//
// ⚠ AN ENDED AGENT IS DEAD AND ITS RECORD IS NOT. Nothing here can wake anything: an ended
// agent is gone from the engine's registry (`settle` deletes it), every wake path resolves
// against that registry, and this module holds no session object, no query and no handle. What
// it holds is the READ-ONLY history the operator can still open for SEVEN DAYS — the agent
// window's narration frames, what it sent, and the 1:1 exchange — plus the identity a card
// needs to render.
//
// ⚠ IT REPLACED AN IN-MEMORY SET THAT DID NOT SURVIVE A RESTART. `session-summary.js` kept
// retained-ended pills in `endedKept`, bounded by `MAX_ENDED` (12) and gone on quit, and it
// retained only the ABANDONMENT case (F-234). Both are superseded: retention is now UNIVERSAL
// (every end keeps a card), DURABLE (a restart keeps it), and bounded by TIME rather than
// count. The count bound was the honest answer while the set was in memory; a durable set can
// be swept on the clock, which is what "viewable for seven days" actually asks for.
//
// ⚠ CHANNEL MESSAGES ARE NOT IN HERE AND ARE NEVER SWEPT. Everything this agent POSTED is
// `channel_messages` on the server — the shared record, owned by the channel, seen by both
// members. This file holds the LOCAL view of how the work happened. Deleting it deletes a
// window's contents, never a conversation (INVARIANTS §11).
//
// ⚠ WRITTEN AT END, NOT PER FRAME, and that is a cost decision. The narration ring is appended
// on EVERY SDK event (`session-narration.js › note` runs from the engine's one dispatch
// funnel), so persisting per frame is a disk write per tool call per session, multiplied by
// MAX_CONCURRENT_SESSIONS. `record()` snapshots the ring once, at `settle`. THE ACCEPTED COST:
// a hard kill (SIGKILL, power loss) loses the ring for sessions that were live, because nothing
// settled them. Every ORDINARY end — operator End, cap, crash, abandonment, quit — routes
// through `settle` and is captured. A restart's interrupted-record scan marks those keys ended
// with no session object and therefore no ring, which is the honest empty answer.

const Store = require('electron-store');
const { diag } = require('./diag');

const store = new Store();
const HISTORY_KEY = 'agentHistory'; // { [sessionKey]: durable ended-agent record }

// ─── BEGIN AGENT-HISTORY-PURE (pure; unit-tested via source extraction) ──────────
// `store` and `diag` are free vars from here down.

/**
 * THE RETENTION WINDOW, IN ONE PLACE. Seven days from `endedAt`.
 * ⚠ Every sweep, every expiry check and every doc that quotes a number reads THIS. A second
 * copy is how a card outlives its history or a history outlives its card.
 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A BOUND ON THE SET AS WELL AS ON ITS AGE, because a time bound alone is not a bound. Seven
 * days of a busy machine at MAX_CONCURRENT_SESSIONS is unbounded in principle; this is the
 * belt, and it drops the OLDEST first (least likely to still matter). Far above what a week
 * realistically produces, so the CLOCK is the rule and this is the guard.
 */
const MAX_HISTORY = 200;

/** A finite number, or null. ⚠ `null` means UNMEASURED and must never become 0 — see
 *  `durableHistory`'s measurement block. */
function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Bounded display string, the discipline every counterparty-influenced field here is under
 *  (`session-store.js › durableName`): one line, collapsed, `max` chars (80 by default), or null.
 *  ⚠ THE BOUND IS A PARAMETER SINCE 2026-08-23 (F-287). 80 is a DISPLAY default and the right
 *  number for `channelName` / `threadTitle`; it is the wrong one for a field carrying a real
 *  server bound, and the caller passes that instead — the same shape `session-summary.js ›
 *  displayText(value, max)` and `session-store.js › durableName(value, max)` take. */
function historyName(value, max) {
  if (typeof value !== 'string') return null;
  const cap = typeof max === 'number' && max > 0 ? max : 80;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap).trim();
  return s || null;
}

/**
 * Whitelist what a record may carry, so a live handle can never reach the disk even if a
 * caller hands over an enriched object — the same rule `session-store.durableSessionRecord`
 * follows, and for the same reason (`s.query`, `s.win` and the push iterator are not data).
 * ⚠ `entries` is the narration ring, already bounded by `NARRATION_MAX` on the way in and
 * already stripped of `inputFull` by `session-narration.js › entryFor`. Nothing is re-derived
 * here; a shape this file did not build is not one it will invent.
 */
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
    // ⚠ THE TEMPLATE IT RAN AS (2026-08-22). A whitelist DROPS what it does not name, so without
    // this line the frozen name never survives the write.
    // ⚠ **AT 120, THE COLUMN'S OWN BOUND — NOT `historyName`'s 80 DISPLAY DEFAULT** (F-287,
    // 2026-08-23). This line used to reason that "`session-summary.js` re-bounds at 120 on the
    // way out", which is exactly backwards: re-bounding a value already clipped to 80 restores
    // nothing, and `endedSummary`'s `displayText(e.templateName, TEMPLATE_NAME_MAX)` is a no-op
    // on it. A 100-character name was DESTROYED AT THE WRITE, then reported to the operator as a
    // spelling no template has — and §5A's "a stale name here is correct, not drift" rule tells
    // them not to read that as an error. `channelName` / `threadTitle` above are display strings
    // and 80 is right for them; `templateName` is the one IDENTITY in this whitelist, which is
    // why the bound is wrong here and only here.
    templateName: historyName(r.templateName, 120),
    endedAt: Number(r.endedAt) || 0,
    // ⚠ THE FINAL MEASUREMENT, FROZEN WITH THE IDENTITY. The session object is gone by the time
    // anything reads this, so a live read would blank every number at exactly the moment the
    // operator wants to know what the run cost. `session-summary.js › endedSummary` already
    // projects these; the durable record is where they now have to survive from, because the
    // in-memory set that used to hold them does not outlive a restart.
    // ⚠ `null` is a REAL answer and never zero — an unmeasured run, or a model this build has
    // no window for, has no denominator (INVARIANTS §11: UNKNOWN is not EMPTY).
    startedAt: numberOrNull(r.startedAt),
    lastActivityAt: numberOrNull(r.lastActivityAt),
    contextUsed: numberOrNull(r.contextUsed),
    contextWindow: numberOrNull(r.contextWindow),
    tokensSpent: numberOrNull(r.tokensSpent),
    entries: Array.isArray(r.entries) ? r.entries : [],
  };
}

/** Has this record outlived the window? ⚠ Compared on `endedAt`, so a clock that jumped
 *  FORWARD sweeps early and one that jumped BACK sweeps late — both bounded, neither able to
 *  delete something that has not ended. A record with no usable `endedAt` (0) is treated as
 *  ancient and swept: it cannot be rendered with a date and nothing can renew it. */
function expired(rec, now) {
  return (Number(now) || 0) - (Number(rec && rec.endedAt) || 0) >= RETENTION_MS;
}

/**
 * PURE: which keys of `all` the sweep drops, given the clock. Age first, then the count belt
 * over whatever survived it (oldest `endedAt` first).
 * ⚠ Garbage (a null / non-object entry) is never a real record and always goes — it can only
 * have arrived from a hand-edited store or a partially-written file.
 */
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

/**
 * A session ENDED: freeze its history. Called from `session-engine.js › settle`, once,
 * BEFORE the registry entry is dropped — that object is the only place the ring lives.
 * ⚠ BEST EFFORT AND IT NEVER THROWS. `settle` is the one teardown path every terminal reaches;
 * a disk failure here must not leave a `claude` child un-aborted.
 */
function record(rec) {
  const r = durableHistory(rec);
  if (!r.key || !r.endedAt) return false;
  const all = loadAll();
  all[r.key] = r;
  saveAll(all);
  return true;
}

/** One agent's frozen history, or null. The agent window's read after the agent is gone. */
function historyFor(key) {
  const rec = loadAll()[String(key || '')];
  return rec && typeof rec === 'object' ? rec : null;
}

/**
 * Every retained ended record, oldest first — what `session-summary.js` projects the ENDED
 * cards from. ⚠ It returns records, never sessions: nothing downstream may treat one as
 * something that can be resumed, messaged or fed.
 */
function listEnded() {
  const all = loadAll();
  return Object.keys(all)
    .map((k) => all[k])
    .filter((r) => r && typeof r === 'object' && r.key)
    .sort((a, b) => (Number(a.endedAt) || 0) - (Number(b.endedAt) || 0));
}

/**
 * DROP these keys outright, whatever their age — the explicit removal the THREAD-DELETE
 * cascade needs. A deleted thread takes its agents' histories with it: the statement the
 * history makes is about work on an exchange that no longer exists, which is the same
 * argument `deleteSessionStatesForThread` makes server-side.
 */
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

/** Every retained key whose (channel, thread) prefix matches — the cascade's lookup. */
function keysForThread(prefix) {
  const p = String(prefix || '');
  if (!p) return [];
  return Object.keys(loadAll()).filter((k) => k.indexOf(p) === 0);
}

/**
 * THE SWEEP. Drops expired records and returns the keys dropped, so the caller can clean the
 * OTHER stores keyed by the same key in one pass (`main/agent-retention.js` owns that list —
 * this module knows only its own file).
 */
function sweep(now) {
  const all = loadAll();
  const keys = sweepableKeys(all, Number(now) || Date.now());
  if (!keys.length) return [];
  for (const key of keys) delete all[key];
  saveAll(all);
  return keys;
}

module.exports = {
  // pure core (re-exported for the shell + the tests)
  RETENTION_MS,
  MAX_HISTORY,
  historyName,
  numberOrNull,
  durableHistory,
  expired,
  sweepableKeys,
  // the live half
  record,
  historyFor,
  listEnded,
  forget,
  keysForThread,
  sweep,
};
