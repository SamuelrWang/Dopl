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
// Stable identity of a session = (channel, thread, AGENT INSTANCE).
//
// ⚠ THE AGENT SEGMENT JOINED ON 2026-08-21 (Samuel's multiplayer ruling) AND IT IS WHAT MAKES
// N SESSIONS PER THREAD EXPRESSIBLE. The key was `<channel>:<thread>`, and that pair WAS the
// de-dupe: one session per thread, `hasLiveSession` answered `{skipped:'busy'}` for the second,
// and every lookup in the tree was a single `sessions.get(...)`. Multiplayer means one operator
// may run several agents on one thread at once, so the pair can no longer identify a session —
// only (channel, thread, agent) can. Every spawn mints an agent id (`main/agent-id.js`), so the
// third segment is populated on every real session; it is left possible to be empty only so a
// mid-wave caller or a record written before this wave still produces a well-formed key.
//
// FORMAT: `<channelId>:<taskId>:<agentId>`. A responder with no first-class thread still
// collapses `taskId` to '', which is why the middle segment may be empty. The agent id charset
// (`^[a-z][a-z0-9]{7}$`) carries no colon, so the key is unambiguously splittable.
//
// ⚠ IT CROSSES TO THE SERVER as `channel_sessions.session_key`, whose zod bound
// (`src/features/channels/schema-sessions.ts › SESSION_KEY_RE`) was widened in the same change
// to admit the third segment. The DESKTOP owns what a session key IS; the server only bounds
// what it may look like. Change one, change both.
function sessionKey(channelId, taskId, agentId) {
  return String(channelId || '') + ':' + String(taskId || '') + ':' + String(agentId || '');
}

// THE SLOT a session occupies in the engine's registry, from a call's own argument object.
//
// ⚠ IT BLENDS ALL THREE NOW; `agentId` NO LONGER *REPLACES* `taskId`. The D2 rule this
// function used to carry was a CHOICE between two key spaces — (channel, thread) for a pair
// session, (channel, agent) for a summoned room-bound TEAM agent, "never blended, a caller
// either names an agent or it does not". Summoning is gone (channels rollback §1) and the
// room-bound shape has had no producer for months, while multiplayer needs exactly the thing
// that rule forbade: two agents distinguished on the SAME thread. So the choice is deleted and
// the three parts compose. A team-shaped call (thread '', agent set) still gets a unique slot,
// which is all the old branch was buying.
function slotKey(a) {
  const x = a || {};
  return sessionKey(String(x.channelId || ''), String(x.taskId || ''), String(x.agentId || ''));
}

// The (channel, thread) PREFIX every session on one thread shares — `<channelId>:<taskId>:`.
// ⚠ THE TRAILING COLON IS LOAD-BEARING: without it `<channel>:<thread>` would also prefix
// `<channel>:<threadWithALongerId>`, so a scan would claim sessions from a neighbouring thread.
// Callers that need "every agent on this thread" scan the registry with this rather than
// parsing keys apart — the key is COMPARED, never split, so nothing comes to depend on its
// internal shape. (`session-pool.js`, deleted 2026-08-20 with the headless lane, is where that
// discipline was first written down; the rule outlived the file.)
function threadKeyPrefix(channelId, taskId) {
  return String(channelId || '') + ':' + String(taskId || '') + ':';
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
    // H2: whether that party's channel is a DIRECT one, i.e. whether the server addresses
    // this session's unaddressed posts. Persisted with the binding because a recreated
    // shell posts too, and its approval card must name the same recipient the live one did.
    // Strict boolean: a hand-edited store can only ever make this FALSE, which understates.
    direct: r.direct === true,
    // D2 — THE BINDING MODE, persisted. 'pair' fences the inbound feed and the window's
    // history to ONE counterparty (every session shape that exists today); 'room' opens
    // both to the whole channel, which is what a summoned TEAM agent needs. Whitelisted
    // as a strict enum with 'pair' as the fallback, so a hand-edited store, an older
    // record written before this field existed, or a mid-wave caller can only ever land
    // on the NARROWER binding — a widened fence must be something a launch asked for.
    bind: r.bind === 'room' ? 'room' : 'pair',
    // THE AGENT INSTANCE ID (2026-08-21). It used to name a `channel_agents` ROW a summoned
    // team session ran as; named agents are gone and this is now the random per-INSTANCE id
    // `main/agent-id.js` mints at every spawn. It is the third segment of the slot key
    // (slotKey above), the handle the operator @-mentions to address ONE of several agents on
    // a thread, and the `name` the state push files — so a record that lost it would re-key
    // onto a different slot and answer to a different mention.
    agentId: r.agentId || null,
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
    // 2026-08-22 — THE OUTBOUND POST COUNTER, and it is whitelisted for an IDEMPOTENCY reason
    // rather than a budget one. `session-outbound-tag.js › nextOwnPostId` stamps every post this
    // instance makes `agent-<agentId>-<n>`; the AGENT ID is persisted just above and re-used by
    // `session-park.js › startResume`, so a counter that restarted at 0 on resume re-minted
    // `client_msg_id`s the server had already stored — and the server's idempotency
    // short-circuit answers the OLD row and silently discards the resumed agent's reply.
    // ⚠ COERCED HARDER THAN `turns` / `costUsd` ABOVE, and deliberately: `Number(x) || 0` lets
    // `Infinity` through (it is truthy), and this number is CONCATENATED into a client_msg_id
    // rather than compared against a cap. A non-finite or negative one lands on 0.
    ownPostSeq: Number.isFinite(Number(r.ownPostSeq)) ? Math.max(0, Math.floor(Number(r.ownPostSeq))) : 0,
    // 2026-08-02 — THE MODEL THIS SESSION RUNS ON, whitelisted so a P2 recreate or a crash
    // resume comes back on the operator's pick instead of silently reverting to the CLI
    // default. Coerced against the frozen enum INLINE, the same shape `bind` above uses and
    // for the same reason: this function is evaluated standalone by the extraction tests, so
    // it may not reach into session-model (which is canonical, and pins this copy). The value
    // becomes `--model <argv>` downstream, so a hand-edited store, a record written before
    // this field existed, or a mid-wave caller can only ever land on 'default' — no model
    // option at all. Frozen enum, spelled out, no normalization of near misses.
    model: ['default', 'opus', 'sonnet', 'haiku', 'fable'].indexOf(r.model) === -1 ? 'default' : r.model,
  };
}

// THE POST COUNTER A RESUMED SESSION STARTS FROM, and why it is not simply the stored number.
//
// ⚠ THE RECORD ALWAYS LAGS. `nextOwnPostId` bumps `s.ownPostSeq` in memory on every post, but a
// record is only written at the moments `session-io.js › baseRecord` is projected (spawn,
// system/init, park, settle). A CRASH between a post and the next persist therefore leaves a
// stored counter BELOW the ids the server already holds — and re-minting one of those is exactly
// the collision this counter is persisted to avoid, because the server answers the old row and
// the resumed agent's reply is silently discarded. So a rehydrate jumps the counter clear of the
// window a crash can hide, rather than resuming from a number that is only a lower bound.
//
// SLACK IS FREE HERE. The stamp is `agent-<agentId>-<n>`; `n` is scoped to ONE random instance
// id, nothing reads it as a count, and `MAX_OWN_POST_IDS` bounds the lookback set regardless. 50
// is far more posts than the seconds between a persist and a crash can hold.
const RESUME_POST_SEQ_SLACK = 50;

// PURE: a stored counter -> the counter a resumed session starts from. 0 (a fresh spawn, an
// absent field, a hand-edited store) stays 0 — slack over nothing would only make the first
// stamp look strange.
function resumedPostSeq(stored) {
  const n = Number(stored);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n) + RESUME_POST_SEQ_SLACK;
}

// ── Record pruning (AUDIT D5, closes FOLLOW-UP F8) ───────────────────────────
// Records used to live forever, so ANY thread that ever ran on this machine stayed
// peer-resurrectable: the inbound gate creates a shell from an inbound message alone
// (recreateParkedShell reads the record), which made the durable set an unbounded, growing
// list of windows a peer could pop. This is the bound.
//
// POLICY — deliberately conservative. Two rules, age and count, and a protection list that
// is checked FIRST, so nothing an operator might still want is dropped:
//   PROTECTED  (1) a key with a LIVE session on this machine (`keep`, the engine's registry):
//                  the held/queued inbound cards live only on that in-memory object, so this
//                  is also what protects an unanswered message;
//              (2) a key with a RETAINED sdkSessionId — that is a conversation the operator
//                  can still reopen and resume (the resume map is cleared only when the
//                  thread closes completed/failed);
//              (3) any phase that is neither 'ended' nor 'parked', i.e. a record that still
//                  looks live (launching / running / awaiting_*). Belt for (1).
//   RULE 1     drop an unprotected record whose session last STARTED more than
//              RECORD_TTL_MS ago. startedAt is restamped by every startSession for the
//              thread (launch, resume, recreate), so it reads as last-touched.
//   RULE 2     if more than MAX_RECORDS survive, drop the oldest unprotected ones (LRU by
//              startedAt) until the TOTAL is back at MAX_RECORDS. Protected records are
//              counted, never dropped, so a machine with 200 live threads simply prunes
//              nothing rather than evicting something reopenable.
// Pruning a record NEVER touches the resume map: a dropped record's sdkSessionId (if any)
// would have protected it, so there is nothing to clear.
const RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_RECORDS = 200;

function protectedRecord(key, rec, keep, hasSdkId) {
  if (keep && keep.has && keep.has(key)) return true;
  if (hasSdkId(key)) return true;
  return rec.phase !== 'ended' && rec.phase !== 'parked';
}

// PURE: which keys of `all` may be dropped, given the clock, the live-session keys, and a
// resume-map probe. Returns [] when nothing qualifies.
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
    // Garbage (a null / non-object entry) is never a real record, so it is never protected
    // by the unknown-phase rule below — it just goes.
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

// ── Records ──────────────────────────────────────────────────────────────────
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

// ⚠ `getRecord(key)` AND `removeRecord(key)` STOOD HERE AND ARE DELETED (2026-08-20), both
// with zero callers. `removeRecord`'s caller-lessness is itself a RECORDED FINDING —
// `test/main-audit-record-prune.test.mjs` opens by naming it ("records were never pruned;
// session-store.removeRecord existed with no caller"), and the fix that closed it was
// `pruneRecords`'s LRU sweep, not this function. Keeping a single-key delete beside a sweep is
// two answers to "how does a record leave", and the one with no callers is the one that would
// have been reached for first. `getRecord` went the same way: the live readers take
// `loadRecords()` (the whole map) or `getSdkSessionId(key)` (the one field a resume needs).

// AUDIT D5: apply the policy above. Called ONCE per app start (session-engine.init, AFTER the
// interrupted-record scan, so a crashed session still gets its echo + resume offer before it can
// ever age out). `keep` is the live registry's key set. Returns how many were dropped; a store
// with nothing prunable is not rewritten.
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

/**
 * DROP a key from BOTH durable structures — the record and the resume map — in one call.
 * The 7-day sweep's cleaner (`main/agent-retention.js`); nothing else has a reason to.
 *
 * ⚠ THE RESUME MAP IS THE HALF THAT MATTERS. `sessionIds[key]` is the `sdkSessionId` a resume
 * re-attaches to, and it is kept INDEPENDENTLY of the record precisely so a conversation
 * survives a settled one. An ended agent past its window must not be resumable, so the two are
 * dropped together here — the one place where "forget this agent" is a single statement.
 * ⚠ `pruneRecords`'s LRU sweep is a DIFFERENT rule (bound the durable set) and is untouched:
 * this is keyed, deliberate and driven by the clock on `endedAt`.
 */
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
  // pure core (also re-exported for the shell + tests)
  sessionKey,
  slotKey, // (channel, thread, agent instance) — the multiplayer slot
  threadKeyPrefix, // every agent on one thread shares it (registry scans)
  isTerminalPhase,
  reloadDisposition,
  durableName,
  durableSessionRecord,
  RESUME_POST_SEQ_SLACK, // 2026-08-22: the crash window a rehydrated post counter jumps
  resumedPostSeq,
  prunableKeys, // AUDIT D5: the pure record-retention policy
  // records
  loadRecords,
  saveRecord,
  setRecordPhase,
  pruneRecords, // AUDIT D5: bound the durable set (called from session-engine.init)
  forgetKeys, // 2026-08-22: the 7-day sweep's one-call "forget this agent" (record + resume)
  // resume map
  getSdkSessionId,
  setSdkSessionId,
  clearSdkSessionId,
};
