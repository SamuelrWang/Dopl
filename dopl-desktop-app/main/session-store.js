// Durable session persistence: `sessionRecords` (one whitelisted record per session key) and `sessionIds` (the
// resume map: key -> conversation id). Live handles never reach disk. The PURE block has no electron/store
// reference and is sliced by three suites with no injected free vars.

const Store = require('electron-store');
// The usage-baseline whitelist, consumed only below the PURE block (see `saveRecord`).
const runtimeTruth = require('./session-runtime-truth');

const store = new Store();
const RECORDS_KEY = 'sessionRecords';
const SDK_IDS_KEY = 'sessionIds';

// ─── BEGIN SESSION-STORE-PURE (pure; unit-tested via source extraction) ──────

// Wire/storage `task` == domain `thread`. A session is (channel, thread, AGENT INSTANCE):
// `<channelId>:<taskId>:<agentId>`, the middle segment empty for a channel-level agent. It crosses to the server
// as `channel_sessions.session_key` (`schema-sessions.ts › SESSION_KEY_RE`): change one, change both.
function sessionKey(channelId, taskId, agentId) {
  return String(channelId || '') + ':' + String(taskId || '') + ':' + String(agentId || '');
}

// The slot a call's own argument object names; the three parts compose.
function slotKey(a) {
  const x = a || {};
  return sessionKey(String(x.channelId || ''), String(x.taskId || ''), String(x.agentId || ''));
}

// The prefix every agent on one thread shares. The trailing colon is load-bearing (it stops a neighbouring
// thread whose id extends this one from matching); keys are compared, never split.
function threadKeyPrefix(channelId, taskId) {
  return String(channelId || '') + ':' + String(taskId || '') + ':';
}

function isTerminalPhase(phase) {
  return phase === 'ended';
}

// What init() does with a record at startup: 'ignore' (terminal), 'dormant' (PARKED: no interrupted echo,
// handled by session-boot), 'resume' (live when the app died: interrupted echo + opt-in resume).
function reloadDisposition(phase) {
  if (phase === 'parked') return 'dormant';
  return isTerminalPhase(phase) ? 'ignore' : 'resume';
}

// A durable display string: one line, collapsed, bounded (80 by default; a field with a real server bound
// passes it), or null. These never enter a framed prompt.
function durableName(value, max) {
  if (typeof value !== 'string') return null;
  const cap = typeof max === 'number' && max > 0 ? max : 80;
  const s = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap).trim();
  return s || null;
}

// Whitelist the durable fields (the one statement of the rule). Every field is coerced inline: this function
// is evaluated standalone by the extraction tests, so it cannot ask another module.
function durableSessionRecord(rec) {
  const r = rec || {};
  return {
    key: r.key,
    sessionId: r.sessionId,
    channelId: r.channelId,
    taskId: r.taskId || '',
    workspaceId: r.workspaceId,
    side: r.side,
    profile: r.profile,
    // A whole non-negative number or null; null (junk, old records) reads as the CAP at the gate. A hand-edited
    // `0` claiming a human start is an accepted widening of persisting the stamp at all.
    launchDepth: typeof r.launchDepth === 'number' && Number.isFinite(r.launchDepth) && r.launchDepth >= 0
      ? Math.floor(r.launchDepth) : null,
    launchChain: r.launchChain === true,
    mode: r.mode,
    phase: r.phase,
    startedAt: r.startedAt,
    // When it was last PARKED (stamped by both park writes; a pure passthrough here). Null is OLD at boot.
    parkedAt: Number(r.parkedAt) > 0 ? Number(r.parkedAt) : null,
    // The task's other party, so a resumed session stays bound to it (FIX L1).
    counterpartyId: r.counterpartyId || null,
    direct: r.direct === true,
    // A strict enum falling back to the NARROWER binding.
    bind: r.bind === 'room' ? 'room' : 'pair',
    // The instance id: third key segment, @-mention handle, the push's `name` — losing it re-keys the session.
    agentId: r.agentId || null,
    // Header identity as bounded plain strings (a hand-edited store cannot push a blob to a renderer).
    counterpartyName: durableName(r.counterpartyName),
    channelName: durableName(r.channelName),
    taskTitle: durableName(r.taskTitle),
    // The identity NAME only (F-288), at the column's 120: without it a crash resume erased
    // `channel_sessions.identity_name`. The body is never persisted (no reader after spawn).
    identityName: durableName(r.identityName, 120),
    // Display only; a whitelist drops the retired cost/cap fields of an older record on read.
    turns: Number(r.turns) || 0,
    // The post counter feeds client_msg_ids (idempotency), so it is coerced harder: finite, >= 0, integral.
    ownPostSeq: Number.isFinite(Number(r.ownPostSeq)) ? Math.max(0, Math.floor(Number(r.ownPostSeq))) : 0,
    // The pick, by shape only (no space, quote, newline or shell metacharacter), else '' (no pick).
    model: typeof r.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,109}(\[[A-Za-z0-9]{1,8}\])?$/.test(r.model) ? r.model : '',
    // Which runtime ran it, so a crash resume never lands on another vendor. Coerced by charset only; an unknown
    // id resolves to the default runtime, and null (an old record) is the default it really ran on.
    runtimeId: typeof r.runtimeId === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(r.runtimeId) ? r.runtimeId : null,
  };
}

// The record lags the in-memory post counter (written only at spawn/init/park/settle), so a resume jumps it
// clear of the window a crash can hide: re-minting an id the server holds silently discards the reply.
const RESUME_POST_SEQ_SLACK = 50;

// 0 stays 0 (a fresh spawn or junk).
function resumedPostSeq(stored) {
  const n = Number(stored);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n) + RESUME_POST_SEQ_SLACK;
}

// Record pruning (AUDIT D5). PROTECTED first: a live key, a key with a retained conversation id, or any
// non-ended/non-parked phase. Then drop records older than the TTL (by startedAt, restamped per start), then
// the oldest unprotected ones down to MAX_RECORDS. Pruning never touches the resume map.
const RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 200;

function protectedRecord(key, rec, keep, hasSdkId) {
  if (keep && keep.has && keep.has(key)) return true;
  if (hasSdkId(key)) return true;
  return rec.phase !== 'ended' && rec.phase !== 'parked';
}

function prunableKeys(all, opts) {
  const o = opts || {};
  const now = Number(o.now) || 0;
  const keep = o.keep || null;
  const hasSdkId = typeof o.hasSdkId === 'function' ? o.hasSdkId : function () { return false; };
  const records = all || {};
  const keys = Object.keys(records);
  const drop = [];
  const survivors = [];
  for (const key of keys) {
    const rec = records[key];
    // Garbage is never protected by the unknown-phase rule.
    if (!rec || typeof rec !== 'object') { drop.push(key); continue; }
    if (protectedRecord(key, rec, keep, hasSdkId)) continue;
    if (now - (Number(rec.startedAt) || 0) > RECORD_TTL_MS) drop.push(key);
    else survivors.push(key);
  }
  const excess = keys.length - drop.length - MAX_RECORDS;
  if (excess > 0) {
    survivors.sort(function (a, b) {
      return (Number(records[a].startedAt) || 0) - (Number(records[b].startedAt) || 0);
    });
    for (const key of survivors.slice(0, excess)) drop.push(key);
  }
  return drop;
}

// ─── END SESSION-STORE-PURE ──────────────────────────────────────────────────

function loadRecords() {
  return store.get(RECORDS_KEY) || {};
}

// The park stamp is written at BOTH writes that can leave a record parked (here and `setRecordPhase`), so a
// third park path cannot forget it; `Date.now()` may not live in the PURE block.
function stampParked(record) {
  if (record.phase === 'parked') record.parkedAt = Date.now();
  return record;
}

// The ONE write every record goes through; the runtime-truth fields are whitelisted here because the PURE
// block cannot reach a helper.
function saveRecord(rec) {
  const record = stampParked({
    ...durableSessionRecord(rec),
    ...runtimeTruth.durableRuntimeTruth(rec),
  });
  if (!record.key) return;
  const all = loadRecords();
  all[record.key] = record;
  store.set(RECORDS_KEY, all);
}

function setRecordPhase(key, phase) {
  const all = loadRecords();
  if (!all[key]) return;
  all[key].phase = phase;
  if (phase === 'parked') all[key].parkedAt = Date.now();
  store.set(RECORDS_KEY, all);
}

// Called once per app start, AFTER the interrupted scan and the re-park, with the live keys as `keep`.
function pruneRecords(opts) {
  const all = loadRecords();
  const ids = store.get(SDK_IDS_KEY) || {};
  const keys = prunableKeys(all, {
    now: Date.now(),
    keep: (opts && opts.keep) || null,
    hasSdkId: (key) => !!ids[key],
  });
  if (!keys.length) return 0;
  for (const key of keys) delete all[key];
  store.set(RECORDS_KEY, all);
  return keys.length;
}

// The resume map is kept apart from the record so a conversation survives a settled record; cleared only
// when the task itself is done.
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

/** Drop a key from BOTH structures in one call — the 7-day sweep's cleaner (`agent-retention.js`); an ended
 *  agent past its window must not be resumable. */
function forgetKeys(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  const all = loadRecords();
  const ids = store.get(SDK_IDS_KEY) || {};
  let records = 0;
  let resumes = 0;
  for (const key of list) {
    const k = String(key || '');
    if (!k) continue;
    if (k in all) { delete all[k]; records += 1; }
    if (k in ids) { delete ids[k]; resumes += 1; }
  }
  if (records) store.set(RECORDS_KEY, all);
  if (resumes) store.set(SDK_IDS_KEY, ids);
  return records + resumes;
}

module.exports = {
  sessionKey,
  slotKey,
  threadKeyPrefix,
  isTerminalPhase,
  reloadDisposition,
  durableName,
  durableSessionRecord,
  RESUME_POST_SEQ_SLACK,
  resumedPostSeq,
  prunableKeys,
  loadRecords,
  saveRecord,
  setRecordPhase,
  pruneRecords,
  forgetKeys,
  getSdkSessionId,
  setSdkSessionId,
  clearSdkSessionId,
};
