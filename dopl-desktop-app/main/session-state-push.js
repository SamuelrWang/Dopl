// SESSION STATE -> THE SERVER. The writer behind `dopl_channel(op="read_sessions")` -> GET /api/channels/sessions -> `channel_sessions`.
//
// ⚠ A PUSH ON STATE CHANGE, NOT A HEARTBEAT. presence.js beats every 30s per listener per workspace unconditionally
// (~120 writes/hour/machine, forever); this writes when a session's DERIVED state actually moves — launch, first
// tool, park, end. A handful of writes per session lifetime. That difference is the whole argument for the table
// existing. Do NOT "simplify" it to a timer. ⚠ A KEEPALIVE WAS CONSIDERED HERE AND NOT BUILT (2026-08-23, F-294): a LIVE
// session past some TELEMETRY_KEEPALIVE_MS folding a wall-clock bucket into its digest so the next natural cycle
// re-reports (≤6 writes/hour/machine — the cost was never the objection). Refused for two reasons. The machine's
// liveness is NOT missing from the wire — `agent_presence` carries it unconditionally — so the fix went to the side that
// was lying (`server/session-state-service.ts › listSessionStates` joins it, `channel-session-render.ts ›
// SessionRenderOpts` renders "quiet Xm" not "may be offline"), with no contract change and no new write; and a
// wall-clock value inside `setDigest`'s input turns the digest gate this module is built around into a writer for sets
// that did not move (`session-telemetry.js` argues the same hazard for `lastActivityAt`). A future wave that still needs
// it needs a reason this one did not have, and must state it HERE.
// ⚠ THE TRIGGER IS NOT DERIVED HERE. session-summary.js is the ONE place engine state becomes a pill state, and it
// already coalesces and fires only when the digest moved. This SUBSCRIBES and re-derives nothing. Anything else is the
// two-readers-one-fact defect. ⚠ SEPARATE MODULE because session-summary.js is network-free above `module.exports` —
// its suite reads it as SOURCE and evaluates the block with fakes injected. An apiFetch there ends that — the seam is a subscription.
//
// TRANSPORT IS api.js: a short POST with no abort wiring and no long-poll, so it inherits the shared 401 repair
// (api-repair.js — a second copy of that repair produced the 1.8.x Channels outage), the app-version stamp and the undici
// pool reset. listener-io.js keeps its own SEND only because its long-poll wires a caller abort signal in.
//
// ── ROW LIFETIME ────────────────────────────────────────────────────────────────────────
// ⚠ A session's row exists while its PILL does and is DELETED when the pill leaves, ended rows included — the row IS that
// projection (session-summary's retention rule). Keeping `ended` rows to sweep later needs a scheduler this product does
// not have, so "later" means never and the table grows unbounded; and an `ended` row for a window-less session answers
// "what is flint doing?" with a session the operator cannot open. ⚠ THE DELETE IS IMPLICIT, which is why this POSTS THE
// WHOLE SET: the server replaces the caller's set. A delta protocol needs an explicit "this one is gone" that a crashed
// or quit desktop never sends. KNOWN GAP: rows outlive the process that wrote them. Bounded by (a) the first push for a
// workspace in a new run replacing its whole set and (b) `reportedWorkspaces` being PERSISTED, so a run starting with no
// sessions clears them. NOT covered: signing out — the credential that could delete the rows is gone before anything
// here can react.
//
// ── IDENTITY ────────────────────────────────────────────────────────────────────────────
// ⚠ CROSS-ACCOUNT GUARD. Signing out does not end engine sessions, so operator A's sessions are still in the registry
// when operator B signs in on the same Mac — and a push under B's credential files A's handles, channel names and
// thread titles as B's, readable by B through `read_sessions`. Every session key is therefore stamped with the identity
// current WHEN THIS MODULE FIRST SAW IT, and only matching keys are reported. A key first seen with no resolvable
// identity is never reported — fail closed. Signing back in as the SAME operator resumes reporting automatically.

const { apiFetch } = require('./api');
const { diag } = require('./diag');
// THE QUANTIZER + CADENCE FLOOR (2026-08-22). ABOVE the sentinel like `apiFetch`, so the harness injects the REAL
// module. Its header carries the derivations; this file only spends them.
const telemetry = require('./session-telemetry');
const Store = require('electron-store');

const store = new Store();

// ─── BEGIN SESSION-STATE-PUSH (injectable; unit-tested via source extraction) ───────────
// ⚠ `apiFetch`, `diag`, `store`, `telemetry` and `Date` are free vars from here down, so
// test/session-state-push.test.mjs evaluates this verbatim with fakes — no Electron, no
// network, no disk, and a clock a case can drive.

const ENDPOINT = '/api/channels/sessions';
const HTTP_TIMEOUT_MS = 15000;

// Workspaces this machine has written rows into, persisted beside the listener's cursors. For ONE case: a run that
// starts with no sessions in a workspace a previous run left rows in. Without it those rows stand claiming `working` for
// a process that is gone.
const REPORTED_WORKSPACES_KEY = 'sessionReportWorkspaces';

// ⚠ BOUNDED RETRY, deliberately small (ui-sync's ~39 000-attempt storm is the cautionary tale). Two attempts, one fixed
// gap, then STOP — the digest is NOT recorded on failure, so the session's next real state change is the retry. Bounded
// by the session's life, not a timer.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2000;

let armed = false;
let deps = { getUserId: null, summary: null };
let unsubscribe = null;
let lastUserId = null;
let running = false; // one cycle at a time — the pushes inside one are serial
let queued = null; // the newest entries that arrived while a cycle was in flight
let draining = null; // the in-flight cycle, so the quit path can await one final push

// sessionKey -> userId current when this module first saw that key. Pruned to the live set
// every cycle, so it is bounded by the window budget.
const origin = new Map();
// workspaceId -> digest of the set this process last STORED there. ⚠ An unchanged digest is
// not sent: a window rebuild, a re-mount or an identical re-derivation must not cost a write.
const pushedDigest = new Map();
// ⚠ THE CADENCE FLOOR'S TWO FACTS (2026-08-22): the STATE HALF of the stored set, and when it
// was stored. Beside `pushedDigest` rather than folded into it because they answer a different
// question — that map says "is this set new", these say "is what is new worth a write NOW".
const pushedStateDigest = new Map();
const pushedAt = new Map();
// One line per (workspace, failure shape). A subsystem that dies must say so ONCE, not once
// per state change.
const loggedFailures = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => String(id || '').slice(0, 8);

/**
 * ONE REPORT ENTRY -> THE WIRE ROW. The only mapping here, and it is a rename: `key` is the
 * server's `sessionKey` (the stable (channel, thread) key the table upserts on, NOT the
 * ephemeral `sessionId`), and an empty `taskId` becomes the NULL the column stores.
 * ⚠ state / name / channelName / threadTitle pass through byte-for-byte — no vote on state.
 * ── ⚠ EIGHT RICH FIELDS JOINED IT ON 2026-08-22 (the orchestrator wave, F-270) ─────────────
 * `session-telemetry.js › telemetryFields`, whose header is where the argument lives. The
 * BY-NAME PICK IS UNCHANGED (a summary field not named here still does not cross), and those
 * values are QUANTIZED: `lastActivityAt` moves on every engine dispatch, so an unquantized
 * widening turns the digest gate off and makes this a per-event writer.
 * ⚠ `templateName` JOINED THE SAME DAY (agent templates) and is QUANTIZATION-EXEMPT: an
 * IDENTITY, not a metric. It rides the STATE half (`session-telemetry.js › STATE_FIELDS`) so a
 * change PUSHES, which is free because `context.template` is a spawn-time capture that is never
 * re-resolved. ⚠ THE NAME, NEVER THE ID: the server stores it verbatim and resolves nothing. */
function reportRow(e) {
  return {
    sessionKey: String((e && e.key) || ''),
    channelId: String((e && e.channelId) || ''),
    threadId: (e && e.taskId) || null,
    name: (e && e.name) || '',
    state: (e && e.state) || '',
    channelName: (e && e.channelName) || null,
    threadTitle: (e && e.threadTitle) || null,
    templateName: telemetry.labelOrNull(e && e.templateName, telemetry.TEMPLATE_NAME_MAX),
    ...telemetry.telemetryFields(e),
  };
}

/** One stable string, like `summariesDigest`, so a field added to the row shape is compared
 *  automatically. */
function setDigest(rows) {
  return JSON.stringify(rows || []);
}

/**
 * Stamp unseen keys with the identity current NOW; release stamps of keys that left the
 * projection. ⚠ THE WHOLE CROSS-ACCOUNT GUARD: a stamp is written once per key and NEVER
 * rewritten, so a session started under one operator can never be re-attributed to the next.
 */
function trackOrigin(entries, userId) {
  const live = new Set();
  for (const e of entries) {
    const key = String((e && e.key) || '');
    live.add(key);
    if (!origin.has(key)) origin.set(key, userId || null);
  }
  for (const key of [...origin.keys()]) {
    if (!live.has(key)) origin.delete(key);
  }
}

/** The entries this operator may honestly report as their own. */
function ownedBy(entries, userId) {
  if (!userId) return [];
  return entries.filter((e) => origin.get(String((e && e.key) || '')) === userId);
}

// ── THE AD-HOC SESSION NEVER GOES ON THE WIRE ───────────────────────────────────────────
// ⚠ An UNTHREADED inbound (the ordinary DM) has no first-class thread, so trigger.taskIdFor mints
// `task-<channelId>-<seq>`, which the server's `SESSION_KEY_RE` and `threadId: z.string().uuid()` both refuse.
// Zod validates the ARRAY, so ONE such entry 400s the WHOLE payload; retryable(400) is false, so the digest is
// never recorded and every later push for that workspace fails identically — `read_sessions` answers [] for
// the machine, valid UUID-threaded sessions included, and stale rows are never cleared.
// ⚠ Filter client-side; do NOT widen the server schema. `read_sessions` answers "what is this member's agent
// doing on THIS thread", and an ad-hoc session has no thread for the answer to be about. Widening the key
// charset also gives up the reconcile's delete-by-key safety. The predicate RESTATES the server's contract
// (uuid channel, uuid thread or none) rather than sniffing `!key.startsWith('task-')`: the reason to drop a
// row is that the server refuses it.
const WIRE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serverReportable(e) {
  const x = e || {};
  if (!WIRE_UUID_RE.test(String(x.channelId || ''))) return false;
  const taskId = String(x.taskId || '');
  return taskId === '' || WIRE_UUID_RE.test(taskId);
}

// ── A ROW WITH NO USABLE HANDLE DOES NOT GO ON THE WIRE EITHER (2026-08-22) ─────────────
//
// ⚠ THE SAME FAILURE AS THE AD-HOC KEY ABOVE, REACHED BY A THIRD ROAD, AND THIS IS THE BELT RATHER THAN THE
// FIX. `channel_sessions.name` carries CHECK `^[a-z][a-z0-9-]{1,30}$` and
// `src/features/channels/schema-sessions.ts › SESSION_NAME_RE` restates it character for character. Zod
// validates the ARRAY, so ONE bad name 400s the WHOLE payload, `retryable(400)` is false, the digest is never
// recorded, and every later push for that workspace fails identically — `read_sessions` answers [] for the
// machine for the life of the run.
//
// ⚠ AND `''` IS A REACHABLE VALUE, NOT A HYPOTHETICAL. `session-summary.js › nameOf` answers the empty string
// for a session carrying no `agentId` — deliberately, because inventing a name there would be worse — and the
// producer that could hand one over was `session-park.js › startResume` resuming a PRE-MULTIPLAYER durable
// record. That producer is fixed in the same change (it mints an id), so nothing in the tree feeds this
// today. It stays because the COST of the next producer getting it wrong is a workspace silently blanked, and
// the check is a regex.
//
// ⚠ THE PREDICATE RESTATES THE SERVER'S CONTRACT rather than sniffing for '' — the reason to drop
// a row is that the endpoint refuses it, which is the same rule `serverReportable` follows.
const WIRE_NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;

function nameReportable(e) {
  return WIRE_NAME_RE.test(String((e || {}).name || ''));
}

// ── THE ENDED ROW DOES NOT GO ON THE WIRE (2026-08-22, Samuel's ended-agent ruling) ─────
//
// ⚠ THIS IS A DELIBERATE NARROWING, AND WITHOUT IT THE RULING WOULD HAVE BROKEN THE PUSH
// ENTIRELY. Ended rows used to be reported and disappeared almost at once — the retained set was
// in memory, bounded by 12, and cleared by a restart. Retention is now SEVEN DAYS and DURABLE
// (`agent-history.js`), so a machine can hold hundreds of ended cards. The server's own bound is
// `SESSION_REPORT_MAX = 32` on the ARRAY (`src/features/channels/schema-sessions.ts`); one
// oversized payload is a 400, `retryable(400)` is false, the digest is never recorded, and every
// later push for that workspace fails identically — `read_sessions` answers [] for the machine,
// LIVE sessions included, and stale rows are never cleared. That is the exact failure the ad-hoc
// filter above exists for, reached by a different road.
//
// ⚠ AND NOTHING WANTED THEM. Samuel's ruling is that the OPERATOR sees their own ended cards —
// which they do, from the LOCAL summaries bridge, where the 7-day history actually lives. PEERS
// do not need ended cards: `peerCardsFor` already filters on row freshness, so a day-old ended
// row renders nothing anyway. And `read_sessions` answers "what is this member's agent DOING",
// which a dead one is not. So the cross-machine vocabulary keeps its three values and simply
// stops carrying the third.
//
// ⚠ THE ROW STILL LEAVES PROMPTLY, WHICH IS THE POINT. Dropping the entry here means the next
// push reports a SMALLER set, and the replace protocol deletes by omission — so a peer's card
// for a just-ended agent disappears on the next state change rather than lingering for a week.
function liveForWire(e) {
  return String((e || {}).state || '') !== 'ended';
}

// ⚠ One line per dropped session, NOT per push: a filtered entry survives every state change
// of a session that may run for hours. Pruned to the live set every cycle, like `origin`.
const loggedAdHoc = new Set();

function reportable(entries) {
  const kept = [];
  const live = new Set();
  for (const e of entries) {
    const key = String((e && e.key) || '');
    live.add(key);
    // ⚠ ENDED ROWS ARE DROPPED SILENTLY, unlike the ad-hoc ones below. An ad-hoc session is a
    // shape the server REFUSES and the operator may want to know about; an ended one is simply
    // not this table's business, it happens constantly, and one diag line per ended agent would
    // be noise about working-as-designed.
    if (!liveForWire(e)) continue;
    if (serverReportable(e) && nameReportable(e)) { kept.push(e); continue; }
    if (loggedAdHoc.has(key)) continue;
    loggedAdHoc.add(key);
    if (!serverReportable(e)) {
      diag('session-state push: SKIPPING ad-hoc session', key,
        '— no first-class thread, so read_sessions has nothing to be about;',
        'the rest of this workspace\'s set is reported normally');
    } else {
      diag('session-state push: SKIPPING nameless session', key,
        '— its name', JSON.stringify(String((e || {}).name || '')),
        'is not a handle channel_sessions.name accepts, and ONE of them 400s the whole payload;',
        'the rest of this workspace\'s set is reported normally');
    }
  }
  for (const key of [...loggedAdHoc]) {
    if (!live.has(key)) loggedAdHoc.delete(key);
  }
  return kept;
}

/** workspaceId -> rows to report there. ⚠ An entry with no workspace is DROPPED, never
 *  guessed at (the server fences on X-Workspace-Id). Unreachable from a real session, which
 *  is why it diags rather than throws. */
function groupByWorkspace(entries) {
  const out = new Map();
  for (const e of entries) {
    const ws = String((e && e.workspaceId) || '');
    if (!ws) {
      noteFailure('none', 'no-workspace', 'a session summary carried no workspace id');
      continue;
    }
    const rows = out.get(ws);
    if (rows) rows.push(reportRow(e));
    else out.set(ws, [reportRow(e)]);
  }
  return out;
}

// ── The persisted "workspaces this machine has rows in" record ──────────────────────────
// ⚠ KEYED BY OPERATOR (`{ userId: [workspaceId, …] }`), because a ROW is. A machine-wide list
// would make the next operator to sign in clear a workspace they may not be a member of, and
// would forget that the PREVIOUS operator still has rows there — the one thing this remembers.
// Empty entries are dropped, so it is bounded by accounts that signed in on this Mac.
function reportedRecord() {
  let raw = null;
  try { raw = store.get(REPORTED_WORKSPACES_KEY); } catch (_err) { return {}; }
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function reportedWorkspaces(userId) {
  const list = reportedRecord()[String(userId || '')];
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x) : [];
}

function rememberWorkspace(userId, workspaceId, hasRows) {
  const record = reportedRecord();
  const next = new Set(reportedWorkspaces(userId));
  if (hasRows) next.add(workspaceId);
  else next.delete(workspaceId);
  if (next.size > 0) record[String(userId)] = [...next];
  else delete record[String(userId)];
  try { store.set(REPORTED_WORKSPACES_KEY, record); } catch (err) {
    diag('session-state push: could not persist the reported-workspace set —', err && err.message);
  }
}

// ── Failure reporting: once per distinct shape, and it says what it costs ────────────────
function noteFailure(workspaceId, shape, detail) {
  const key = String(workspaceId) + '|' + shape;
  if (loggedFailures.has(key)) return;
  loggedFailures.add(key);
  diag('session-state push failed —', detail, 'ws', short(workspaceId),
    '— read_sessions will not see this machine until a later state change succeeds');
}

function clearFailures(workspaceId) {
  const prefix = String(workspaceId) + '|';
  for (const key of [...loggedFailures]) {
    if (key.startsWith(prefix)) loggedFailures.delete(key);
  }
}

// A 5xx or a 429 may differ next time; a 4xx will not (a bad payload, a workspace this
// credential is not in, an expired session api-repair already retried once).
function retryable(status) {
  return status === 429 || status >= 500;
}

/** POST one workspace's whole set. Returns whether the server stored it. */
async function send(workspaceId, rows) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res = null;
    try {
      res = await apiFetch(ENDPOINT, {
        method: 'POST',
        workspaceId: workspaceId,
        body: { sessions: rows },
        timeoutMs: HTTP_TIMEOUT_MS,
        noStore: true,
      });
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
      noteFailure(workspaceId, 'network', (err && err.message) || 'network error');
      return false;
    }
    if (res && res.ok) { clearFailures(workspaceId); return true; }
    const status = (res && res.status) || 0;
    if (retryable(status) && attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
    noteFailure(workspaceId, 'http-' + status, 'HTTP ' + status);
    return false;
  }
  return false;
}

/**
 * ONE CYCLE: the projection as it stands -> at most one POST per workspace whose set moved.
 * ⚠ The empty-set push is the DELETE half: a workspace with rows but no sessions gets
 * `{ sessions: [] }` once, removing the last session's row (and a previous run's leftovers).
 */
async function cycle(entries) {
  const userId = (deps.getUserId && deps.getUserId()) || null;
  trackOrigin(entries, userId);
  if (!userId) return; // signed out: nothing here is ours to assert
  if (userId !== lastUserId) {
    // A different operator's server state is unknown here and their failures are not ours.
    // ⚠ Nothing carries across except the origin stamps, which are the whole point.
    pushedDigest.clear();
    // ⚠ THE FLOOR'S STATE GOES WITH THE DIGEST, ALL THREE TOGETHER. A surviving `pushedAt`
    // would delay the NEW operator's first write for one THEY never made, and a surviving state
    // digest would misread their first set as churn — and the first write for a workspace is
    // the one carrying its whole set.
    pushedStateDigest.clear();
    pushedAt.clear();
    loggedFailures.clear();
    lastUserId = userId;
  }
  // ⚠ Ad-hoc rows are dropped HERE, before grouping, so the digest, the empty-set delete and
  // the bounded retry all operate on exactly the set that goes on the wire. Filtering inside
  // `send` leaves the digest recording a payload that was never sent.
  const groups = groupByWorkspace(reportable(ownedBy(entries, userId)));
  for (const ws of reportedWorkspaces(userId)) {
    if (!groups.has(ws)) groups.set(ws, []);
  }
  for (const [ws, rows] of groups) {
    const digest = setDigest(rows);
    if (pushedDigest.get(ws) === digest) continue;
    // ── THE CADENCE FLOOR (2026-08-22) — A DELAY, NOT A SCHEDULE ─────────────────────────
    // ⚠ NOTHING IS QUEUED AND NO TIMER IS ARMED. A churn-only set inside the window is not
    // written and its digest is NOT recorded, so the session's NEXT projection move carries it —
    // the same bargain the bounded retry makes. A machine that falls quiet never writes it, and
    // nothing wakes up to. ⚠ A STATE CHANGE BYPASSES IT (`telemetry.STATE_FIELDS` is the whole
    // definition of which is which). ⚠ SILENT: a skipped churn push is constant and
    // working-as-designed; one line per skip is the quiet cousin of a log storm.
    const state = telemetry.stateDigest(rows);
    const stateMoved = pushedStateDigest.get(ws) !== state;
    if (!stateMoved && !telemetry.floorAllows(pushedAt.get(ws), Date.now())) continue;
    // Serial on purpose: a burst of parallel writes is what this design exists to avoid.
    const stored = await send(ws, rows);
    if (!stored) continue; // NOT recorded, so the next real change retries
    pushedDigest.set(ws, digest);
    pushedStateDigest.set(ws, state);
    // ⚠ STAMPED AFTER THE SEND. `send` can hold 15s plus a retry, and a stamp taken before it
    // would let the very next cycle read the floor as already expired.
    pushedAt.set(ws, Date.now());
    rememberWorkspace(userId, ws, rows.length > 0);
  }
}

/** Coalesce: a cycle already running takes the newest entries when it comes round again,
 *  so a state change during a slow POST can never start a second overlapping run. */
function schedule(entries) {
  if (!armed) return;
  queued = Array.isArray(entries) ? entries : [];
  if (running) return;
  running = true;
  draining = drain();
}

async function drain() {
  try {
    while (queued) {
      const entries = queued;
      queued = null;
      await cycle(entries); // the loop IS the serialization
    }
  } catch (err) {
    diag('session-state push: cycle error —', (err && err.message) || String(err));
  } finally {
    running = false;
  }
}

/**
 * Arm the writer. ⚠ `getUserId()` is read at PUSH time, never captured — it changes
 * underneath us. `summary` is session-summary.js, INJECTED rather than required so the block
 * above stays evaluable. Idempotent.
 */
function start(opts) {
  const o = opts || {};
  deps = {
    getUserId: typeof o.getUserId === 'function' ? o.getUserId : null,
    summary: o.summary || null,
  };
  if (armed) return;
  if (!deps.summary || typeof deps.summary.subscribe !== 'function') {
    diag('session-state push: NOT armed — no session-summary to subscribe to');
    return;
  }
  armed = true;
  unsubscribe = deps.summary.subscribe((entries) => schedule(entries));
  diag('session-state push: armed (on state change — no heartbeat)');
}

/**
 * Run a cycle now off the CURRENT projection. One caller: the sign-in transition. A fresh
 * credential is not a state change, so nothing fires on its own — yet a run that starts signed
 * out then signs in has a previous run's rows to clear and possibly a live session to report.
 */
function kick() {
  if (!armed || !deps.summary || typeof deps.summary.reportList !== 'function') return;
  schedule(deps.summary.reportList());
}

/**
 * `kick()`, AWAITABLE, for the quit path and nothing else — a quit that ends every session
 * otherwise leaves rows saying `working` for a dead process until the same account signs in on
 * this Mac again.
 * ⚠ THE CALLER BOUNDS THE WAIT, not this function: `send`'s 15s timeout + one retry is right
 * for a running app and wrong for a quit, so racing it against a short deadline is the quit
 * guard's decision. `drain()`'s own try/catch means this promise can never reject.
 */
function flush() {
  kick();
  return draining || Promise.resolve();
}

function stop() {
  if (unsubscribe) { try { unsubscribe(); } catch (_err) { /* already gone */ } }
  unsubscribe = null;
  armed = false;
  queued = null;
}

// ─── END SESSION-STATE-PUSH ─────────────────────────────────────────────────────────────

module.exports = {
  // the live half
  start,
  kick,
  flush, // an awaitable kick, for the quit teardown
  stop,
  // the pure core (exported for the shell + the tests)
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
  REPORTED_WORKSPACES_KEY,
  reportRow,
  liveForWire, // 2026-08-22: an ENDED row is local-only — see its block
  nameReportable, // 2026-08-22: the belt against a nameless row 400-ing the whole set
  setDigest,
  TELEMETRY_MIN_INTERVAL_MS: telemetry.TELEMETRY_MIN_INTERVAL_MS, // 2026-08-22, the floor
  retryable,
  reportedWorkspaces,
};
