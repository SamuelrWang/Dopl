// Durable session persistence (v1.9 Session Window, Track T1).
//
// Two structures, mirroring the consent-watcher durability discipline:
//   sessionRecords  { [sessionKey]: durable record }   — one per (channelId,taskId)
//   sessionIds      { [sessionKey]: sdkSessionId }      — the resume map (the SESSION_KEY analog)
//
// A durable record carries only the fields needed to re-post the interrupted echo
// and offer a resume ({ sessionId, sdkSessionId, channelId, taskId, workspaceId,
// side, profile, mode, phase, startedAt }). Live handles (the SDK query, the
// BrowserWindow, the push iterator) live ONLY in the engine's in-memory registry
// and are NEVER written here. On restart the engine reads records back and, per
// reloadDisposition, either ignores a settled one or treats a running/awaiting one
// as interrupted (§A.8 — no auto-reopen; opt-in resume via options.resume).
//
// The pure block below has NO electron / store references so
// test/session-store.test.mjs slices and evaluates it verbatim (WATCHER-PURE idiom).

const Store = require('electron-store');

const store = new Store();
const RECORDS_KEY = 'sessionRecords'; // { [sessionKey]: durable record }
const SDK_IDS_KEY = 'sessionIds'; // { [sessionKey]: sdkSessionId } — resume map

// ─── BEGIN SESSION-STORE-PURE (pure; unit-tested via source extraction) ──────

// v3.0 VOCABULARY BOUNDARY (durable record + resume map): wire/storage name `task` ==
// domain name `thread`. Every `taskId` / `taskTitle` here is the server's `channel_tasks`
// spelling and is deliberately unchanged; a SESSION is this machine's run on that thread,
// keyed below. Renaming the storage is a migration, not a copy change.
//
// Stable identity of a session = (channel, task). One session per pair (the
// registry de-dupe). A responder with no first-class thread collapses taskId to ''.
function sessionKey(channelId, taskId) {
  return String(channelId || '') + ':' + String(taskId || '');
}

// A phase that means the session is finished and must never be resumed or
// re-echoed. Everything else (launching / running / awaiting_* / interrupted) is a
// live-or-crashed session that reloadDisposition treats as interrupted.
function isTerminalPhase(phase) {
  return phase === 'ended';
}

// What init() does with a record found on disk at startup:
//   'ignore'  — already terminal (settled); drop it.
//   'dormant' — P1 (v1.7.4): PARKED when the app died. It is NOT interrupted — it was
//               intentionally paused and stays resumable, so init() posts NO
//               task_failed{interrupted:true} echo and leaves the record + resume map
//               intact for a later reopen (P2). Neither 'ignore' nor 'resume'.
//   'resume'  — was live/awaiting when the app died; post the interrupted echo and
//               offer an opt-in resume (never auto-reopen).
function reloadDisposition(phase) {
  if (phase === 'parked') return 'dormant';
  return isTerminalPhase(phase) ? 'ignore' : 'resume';
}

// A durable DISPLAY string: one line, whitespace collapsed, capped at 80 chars, or
// null when there is nothing usable. Same LENGTH/newline bound sanitizeName applies
// (not its fence-token strip; these strings never enter a framed prompt, and every
// framing path re-sanitizes on its own), so an identity field can never grow into a blob.
function durableName(value) {
  if (typeof value !== 'string') return null;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
  return s || null;
}

// Whitelist the durable fields so a live handle can never leak into electron-store
// even if the caller passes an enriched record (mirrors consent-watcher's durable()).
function durableSessionRecord(rec) {
  const r = rec || {};
  return {
    key: r.key,
    sessionId: r.sessionId,
    sdkSessionId: r.sdkSessionId || null,
    channelId: r.channelId,
    taskId: r.taskId || '',
    workspaceId: r.workspaceId,
    side: r.side,
    profile: r.profile,
    mode: r.mode,
    phase: r.phase,
    startedAt: r.startedAt,
    // FIX L1: the task's OTHER party (responder -> the requester who addressed me;
    // requester -> the target I addressed). Persisted so a resumed session stays
    // counterparty-bound and only feeds on that member's replies.
    counterpartyId: r.counterpartyId || null,
    // v1.7.5 D1: the header identity (peer display name, channel name, task title).
    // Whitelisted as PLAIN STRINGS so a recreated/resumed shell can rebuild the header
    // instead of falling back to a bare "Session". Coerced + bounded the same way the
    // framing bounds a counterparty-controlled display name (80 chars, one line), so a
    // hand-edited store can never push an unbounded blob back into the renderer.
    counterpartyName: durableName(r.counterpartyName),
    channelName: durableName(r.channelName),
    taskTitle: durableName(r.taskTitle),
    // FIX #9: the running cap counters, whitelisted so a P2 recreate rehydrates the
    // budget (a turn/cost-capped session must not reopen with a fresh cap). Coerced to a
    // finite number so a hand-edited store can never inject NaN into the reducer.
    turns: Number(r.turns) || 0,
    costUsd: Number(r.costUsd) || 0,
  };
}

// ─── END SESSION-STORE-PURE ──────────────────────────────────────────────────

// ── Records ──────────────────────────────────────────────────────────────────
// FOLLOW-UP F8: records are never pruned, so ANY task that ever ran on this machine stays
// peer-resurrectable through the inbound gate (recreateParkedShell reads them forever).
// Wants a pruning policy (age / count bound, or drop on a completed close_task).
function loadRecords() {
  return store.get(RECORDS_KEY) || {};
}

function saveRecord(rec) {
  const record = durableSessionRecord(rec);
  if (!record.key) return;
  const all = loadRecords();
  all[record.key] = record;
  store.set(RECORDS_KEY, all);
}

function setRecordPhase(key, phase) {
  const all = loadRecords();
  if (!all[key]) return;
  all[key].phase = phase;
  store.set(RECORDS_KEY, all);
}

function getRecord(key) {
  return loadRecords()[key] || null;
}

function removeRecord(key) {
  const all = loadRecords();
  if (key in all) {
    delete all[key];
    store.set(RECORDS_KEY, all);
  }
}

// ── Resume map (sdkSessionId per (channelId,taskId)) ─────────────────────────
// Kept independently of the record so a resume survives a settled record: an
// interrupted session's record can be dropped while its sdkSessionId stays here
// for options.resume. Cleared only when the task itself is done.
function getSdkSessionId(key) {
  const map = store.get(SDK_IDS_KEY) || {};
  return map[key] || null;
}

function setSdkSessionId(key, sdkSessionId) {
  if (!sdkSessionId) return;
  const map = store.get(SDK_IDS_KEY) || {};
  map[key] = sdkSessionId;
  store.set(SDK_IDS_KEY, map);
}

function clearSdkSessionId(key) {
  const map = store.get(SDK_IDS_KEY) || {};
  if (key in map) {
    delete map[key];
    store.set(SDK_IDS_KEY, map);
  }
}

module.exports = {
  // pure core (also re-exported for the shell + tests)
  sessionKey,
  isTerminalPhase,
  reloadDisposition,
  durableName,
  durableSessionRecord,
  // records
  loadRecords,
  saveRecord,
  setRecordPhase,
  getRecord,
  removeRecord,
  // resume map
  getSdkSessionId,
  setSdkSessionId,
  clearSdkSessionId,
};
