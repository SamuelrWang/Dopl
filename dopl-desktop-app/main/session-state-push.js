// SESSION STATE -> THE SERVER. The writer behind `dopl_channel(op="status")` -> GET /api/channels/sessions -> `channel_sessions`.
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
// ⚠ AND A FAILED CYCLE RETRIES ON A BACKOFF SINCE 2026-09-14 (`session-state-push-retry.js` carries
// the incident), WHICH IS NOT THE TIMER THIS FORBIDS: armed by a FAILURE and by nothing else,
// cleared by a success, absent on a machine whose pushes land — so "no heartbeat" is unchanged. It
// replaces "the session's next real state change is the retry", which was true of a SESSION and
// false of a BOOT RECONCILE — that cycle has no next state change to wait for.
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
const { discardBody } = require('./api-repair'); // ⚠ NO branch here read the body — success included (the presence.beatOnce leak)
const { diag } = require('./diag');
// ⚠ ABOVE THE SENTINEL, like every other dep: the extracted block below may not `require`.
const wire = require('./session-state-push-wire');
// THE QUANTIZER + CADENCE FLOOR (2026-08-22). ABOVE the sentinel like `apiFetch`, so the harness injects the REAL
// module. Its header carries the derivations; this file only spends them.
const telemetry = require('./session-telemetry');
// THE WAKE-ACK BUFFER (2026-09-02, A9). ⚠ THIS MODULE IS THE ONLY THING THAT MAY POST IT: the
// endpoint is a WHOLE-SET REPLACE, so a module posting receipts on its own with an empty session
// list would delete this machine's projection every time it spoke. `delivery-ack.js` therefore
// HOLDS receipts and this drains them into the payload it was going to send anyway.
const deliveryAck = require('./delivery-ack');
// THE FAILURE LANE (2026-09-14) — the once-per-shape log line, `retryable`, and the BACKOFF that
// re-runs a FAILED reconcile until one lands. ABOVE THE SENTINEL like every dep; its header carries the incident.
const retryLane = require('./session-state-push-retry');
// THE WATCHDOG (2026-09-14, F-698) — `listener-heal.js › watchPass`, the same deadline the listener's guard took.
const heal = require('./listener-heal');
// THE REPORTED-WORKSPACE RECORD (2026-09-14) — moved out at the cap; its header carries the rule.
const record = require('./session-state-push-record');
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

// ⚠ THE INNER, PER-POST RETRY, deliberately small (ui-sync's ~39 000-attempt storm is the cautionary tale). Two
// attempts, one fixed gap, then this POST gives up and the CYCLE is failed. ⚠ WHAT HAPPENS NEXT IS THE OUTER LANE'S
// (`session-state-push-retry.js`): a failed cycle re-runs off the CURRENT projection on a backoff until one lands,
// because "the next state change is the retry" left a whole run's rows wrong on 2026-09-14. The digest rule is what
// makes both safe — nothing is recorded on failure, so any later cycle re-sends the set.
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2000;
// ⚠ A DEADLOCK DETECTOR, NOT A LATENCY BUDGET (2026-09-14, F-698). The worst HONEST cycle is a quarantine sweep —
// up to 32 probes × (15s + 2s + 15s) — so a healthy cycle never comes near this; tripping it is always a defect.
const CYCLE_WATCHDOG_MS = 20 * 60 * 1000;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// THE FAILURE LANE, MINTED PER WRITER because it REMEMBERS (the shapes it has said, the
// consecutive-failure count, its one timer) — the same reason `makeWireFilter` is a factory. ⚠ The
// retry's run is `kick(true)`: a normal cycle off the CURRENT projection, coalesced through
// `schedule` like any state change, and the `true` is what keeps it from resetting its own ladder.
// ⚠ NO TIMER FUNCTION IS NAMED HERE — the lane defaults to the real clock and the suites inject a
// hand-driven one at ITS seam, so the timer count in THIS file is still just the gap above
// (`session-telemetry-cadence.test.mjs` pins that as a source fact).
const { noteFailure, clearFailures, forgetFailures, retryable, armRetry, clearRetry } =
  retryLane.makeFailureLane(diag, () => kick(true));
// THE QUARANTINE (2026-09-14) — the rows the SERVER refuses for a reason no client predicate can
// restate. Minted per writer for the lane's own reason (it remembers), and its probe is `send`
// with NO acks: every probe is a real WRITE on a replace-by-omission endpoint, so the winning one
// stores exactly the set the next cycle would have sent. Its header carries the sweep-vs-bisect
// measurement.
const quarantine = retryLane.makeQuarantine(diag, (ws, rows) => send(ws, rows));

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
    // ⚠ THE OPERATOR-GIVEN NAME, PEER-VISIBLE BY DESIGN (2026-08-31, Samuel's ruling;
    // migration 20260905120000 + `schema-sessions.ts › displayName`). Rides the summary's
    // `displayName` (`session-summary.js › liveSummary` ← `agent-names.js`), so a RENAME
    // changes the digest and pushes like any state change — that is how the peer sees it.
    // 60 is `agent-names.js › MAX_NAME`, which is the column CHECK's own bound; sanitized
    // through the same labelOrNull every other operator-authored field crosses with, so a
    // pathological stored name can never 400 the whole payload (INVARIANTS §11).
    displayName: telemetry.labelOrNull(e && e.displayName, 60),
    // ⚠ **THE AGENT COLOUR — PEER-VISIBLE BY DESIGN, WHICH IS THE ENTIRE RULING** (Samuel,
    // 2026-09-13: *"this will be categorized not only for the own users' agents, but also for
    // other users' agents"*; migration `20261005120000` + `schema-sessions.ts › color`). It
    // rides `displayName` above in every respect but one, below.
    //
    // ⚠ **IT IS AN ASK AND NOT AN ASSIGNMENT, AND THAT MAKES THE NULL CASE SAFE.** Uniqueness
    // is per channel across EVERY member, which no machine can evaluate — two desktops cannot
    // see each other's registries — so the server resolves this rather than storing it:
    // `src/features/channels/server/session-colors.ts › resolveReportedColors` rule 1 KEEPS
    // whatever the stored row already holds. **So a push that reports no colour cannot erase
    // one**, which is what made it correct to put the field on the wire before the summary
    // carried it. ⚠ **IT CARRIES ONE SINCE 2026-09-13** (`session-summary.js › liveSummary`,
    // over `session-engine.js`'s new `color: spec.color || null`): until then every row here
    // reported `undefined` and the server assigned FIRST FREE on every push, so the operator's
    // pick in the New agent popup reached the column by luck rather than by request. ⚠ THIS IS ALSO WHY IT IS NOT THE `templateName` HAZARD
    // (`session-store.js`'s durable-whitelist block): that column is stored VERBATIM, so a
    // resume that rebuilt context without it nulled the server's copy. A colour cannot be nulled
    // by omission, because omission is not a value on this lane.
    // ⚠ NOT `labelOrNull`: this is a CLOSED SET, not operator prose, so it is membership-tested
    // rather than length-bounded — a sanitizer would pass `agent-99` through as a legal label.
    color: wire.colorKey(e && e.color),
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

// ⚠ **THE THREE WIRE REFUSALS MOVED TO `main/session-state-push-wire.js` ON 2026-08-31** — the
// ad-hoc key, the nameless row and the ended row — at the §1 cap and on a real seam: they change
// when the SERVER'S contract for a row changes, where the rest of this file changes when the
// PUSH does. `wireFilter` is minted per writer because `reportable` REMEMBERS what it already
// said (see that file's header), and it is injected with `diag` so the suites' fake logger still
// receives the skip lines.
const { serverReportable, nameReportable, liveForWire, reportable } = wire.makeWireFilter(diag);

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

// ── The persisted "workspaces this machine has rows in" record — `session-state-push-record.js` ──
const { reportedWorkspaces, rememberWorkspace } = record.makeReportedRecord(store, diag, REPORTED_WORKSPACES_KEY);

/**
 * POST one workspace's whole set, plus any delivery receipts riding along.
 *
 * ⚠ THREE ANSWERS, NOT TWO (2026-09-14): `true` stored; `'retry'` failed on a shape that may answer
 * differently (a network throw — the incident's aborted fetch — or an exhausted 429/5xx); `false`
 * failed on one that will not (a 4xx). Only `'retry'` may arm the outer lane, because a timer over
 * a bad payload is the ui-sync storm with a longer period.
 *
 * ⚠ `acks` IS OMITTED WHEN EMPTY, not sent as `[]`. The key is optional on the endpoint
 * (`schema-sessions.ts › SessionStateReportSchema`) and every build in the field posts without
 * it; sending an empty array on every push would put a field on the wire that says nothing.
 */
async function send(workspaceId, rows, acks) {
  const body = { sessions: rows };
  if (acks && acks.length) body.acks = acks;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res = null;
    try {
      res = await apiFetch(ENDPOINT, {
        method: 'POST',
        workspaceId: workspaceId,
        body: body,
        timeoutMs: HTTP_TIMEOUT_MS,
        noStore: true,
      });
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
      noteFailure(workspaceId, 'network', (err && err.message) || 'network error'); return 'retry';
    }
    if (res && res.ok) { discardBody(res); clearFailures(workspaceId); return true; }
    const status = (res && res.status) || 0; discardBody(res); // nothing below reads it
    if (retryable(status) && attempt < MAX_ATTEMPTS) { await sleep(RETRY_DELAY_MS); continue; }
    noteFailure(workspaceId, 'http-' + status, 'HTTP ' + status);
    return retryable(status) ? 'retry' : false;
  }
  return 'retry';
}

/**
 * ONE CYCLE: the projection as it stands -> at most one POST per workspace whose set moved.
 * ⚠ The empty-set push is the DELETE half: a workspace with rows but no sessions gets
 * `{ sessions: [] }` once, removing the last session's row (and a previous run's leftovers).
 */
async function cycle(entries) {
  const userId = (deps.getUserId && deps.getUserId()) || null;
  trackOrigin(entries, userId);
  // ⚠ SIGNED OUT DISARMS THE LANE: nothing here is ours, and the sign-in transition kicks its own cycle.
  if (!userId) { clearRetry(); return; }
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
    forgetFailures(); // …and the ladder with them: a new operator starts at the first rung
    // ⚠ THE RECEIPTS ARE NOT CLEARED HERE, AND THAT IS DELIBERATE (2026-09-02, A9). They carry
    // the identity that earned them (`delivery-ack.js`), and `take` hands back only this
    // operator's — so the cross-account rule holds whether or not anything noticed the
    // handover, which a clear on this branch could not promise: the branch also runs on the
    // FIRST cycle of a run, where there is no previous operator and a receipt the dispatch
    // path already filed would be destroyed.
    lastUserId = userId;
  }
  // ⚠ Ad-hoc rows are dropped HERE, before grouping, so the digest, the empty-set delete and
  // the bounded retry all operate on exactly the set that goes on the wire. Filtering inside
  // `send` leaves the digest recording a payload that was never sent.
  const reported = reportable(ownedBy(entries, userId));
  // ⚠ PRUNED TO THE LIVE SET FIRST, like `loggedAdHoc`: an agent that ends takes its quarantine
  // with it, so a row is never banished for longer than the session that owned it.
  quarantine.prune(new Set(reported.map((e) => String((e && e.key) || ''))));
  const groups = groupByWorkspace(reported);
  for (const ws of reportedWorkspaces(userId)) {
    if (!groups.has(ws)) groups.set(ws, []);
  }
  // ⚠ A WORKSPACE HOLDING RECEIPTS IS PUSHED EVEN IF ITS SESSION SET NEVER MOVED (2026-09-02,
  // A9). In practice almost every receipt coincides with a state change — a wake moves a
  // session out of dormant, a fed turn moves `turns` — but "almost" is not a contract for a
  // field an orchestrator polls, and a receipt stranded behind the digest gate is exactly the
  // silent-miss the ack exists to remove.
  for (const ws of deliveryAck.pendingWorkspaces(userId)) {
    if (!groups.has(ws)) groups.set(ws, []);
  }
  let wantsRetry = false; // any workspace whose POST failed on a shape that may answer differently
  for (const [ws, all] of groups) {
    // ⚠ THE QUARANTINE IS APPLIED HERE, ABOVE THE DIGEST, so a banished row cannot make a set look
    // NEW every cycle and re-send a payload that is known to 400.
    const rows = quarantine.allowed(ws, all);
    // ⚠ TAKEN BEFORE THE GATES BELOW MAY `continue`, and PUT BACK on every path that does not
    // send: a receipt held past a skipped cycle is a receipt this machine forgot it owed.
    const acks = deliveryAck.take(ws, userId);
    const digest = setDigest(rows);
    if (pushedDigest.get(ws) === digest && acks.length === 0) continue;
    // ── THE CADENCE FLOOR (2026-08-22) — A DELAY, NOT A SCHEDULE ─────────────────────────
    // ⚠ NOTHING IS QUEUED AND NO TIMER IS ARMED. A churn-only set inside the window is not
    // written and its digest is NOT recorded, so the session's NEXT projection move carries it —
    // the same bargain the bounded retry makes. A machine that falls quiet never writes it, and
    // nothing wakes up to. ⚠ A STATE CHANGE BYPASSES IT (`telemetry.STATE_FIELDS` is the whole
    // definition of which is which). ⚠ SILENT: a skipped churn push is constant and
    // working-as-designed; one line per skip is the quiet cousin of a log storm.
    const state = telemetry.stateDigest(rows);
    const stateMoved = pushedStateDigest.get(ws) !== state;
    // ⚠ RECEIPTS BYPASS THE CADENCE FLOOR the way a STATE CHANGE does, and for the same reason:
    // the floor exists to swallow CHURN — a telemetry counter ticking — and a receipt is news.
    // ⚠ No `restore` on this branch: it is only reachable with an EMPTY `acks`.
    if (!stateMoved && acks.length === 0 && !telemetry.floorAllows(pushedAt.get(ws), Date.now())) continue;
    // Serial on purpose: a burst of parallel writes is what this design exists to avoid.
    let stored = await send(ws, rows, acks);
    if (stored !== true) { // NOT recorded, so ANY later cycle re-sends this set
      deliveryAck.restore(ws, acks, userId);
      if (stored === 'retry') wantsRetry = true;
      // ⚠ A NON-RETRYABLE REFUSAL IS SWEPT ONCE: a 4xx will not answer differently in 15s, so
      // without this ONE poisoned row wedges the whole workspace's projection for the run. The
      // winning probe stores the good set, so the retry armed below only has to carry the acks.
      else if (await quarantine.sweep(ws, rows)) wantsRetry = true;
      continue;
    }
    // ⚠ ONE LINE PER LANDED PUSH (2026-09-14, F-698). Success was SILENT and failure logged once per shape, so a lane
    // that never ran and a lane that ran fine read identically in the log — nine hours of it. Bounded by the cadence
    // floor and the digest gate, so it is one line per real state change, not a storm.
    diag('session-state push: stored', rows.length, 'row(s) ws', String(ws).slice(0, 8));
    pushedDigest.set(ws, digest);
    pushedStateDigest.set(ws, state);
    // ⚠ STAMPED AFTER THE SEND. `send` can hold 15s plus a retry, and a stamp taken before it
    // would let the very next cycle read the floor as already expired.
    pushedAt.set(ws, Date.now());
    rememberWorkspace(userId, ws, rows.length > 0);
  }
  // ⚠ THE WHOLE CYCLE IS THE UNIT, and a CLEAN one arms NOTHING — including a cycle where nothing
  // was due (every set inside the digest gate), so a quiet machine holds no timer.
  if (wantsRetry) armRetry();
  else clearRetry();
}

/** Coalesce: a cycle already running takes the newest entries when it comes round again,
 *  so a state change during a slow POST can never start a second overlapping run. */
function schedule(entries, fromRetry) {
  if (!armed) return;
  // ⚠ A REAL STATE CHANGE RESETS THE LADDER AND RUNS AT ONCE — its set supersedes the one that
  // failed. A retry's own re-run passes `true`, or it would reset itself to 15s forever: a poll.
  if (!fromRetry) clearRetry();
  queued = Array.isArray(entries) ? entries : [];
  if (running) return;
  running = true;
  draining = drain();
}

function onHungCycle(ms) {
  diag('session-state push: cycle still running after', ms / 1000, 's — RELEASING the single-flight guard so the',
    'next state change can push. The hung cycle is abandoned, not cancelled (F-698).');
}

async function drain() {
  try {
    while (queued) {
      const entries = queued;
      queued = null;
      // ⚠ WATCHDOGGED (2026-09-14, F-698). `running` had no deadline, so ONE cycle that never settled — the boot cycle
      // of 09:11:00Z, wedged behind an unbounded token refresh — was a permanent OFF SWITCH: every later `schedule`
      // took `if (running) return`, and this machine wrote no row for nine hours. Same shape, same fix as
      // `channel-listener.js › reconcile`. The hung cycle is abandoned, not cancelled; the NEXT one runs.
      await heal.watchPass(cycle(entries), onHungCycle, CYCLE_WATCHDOG_MS); // the loop IS the serialization
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
function kick(fromRetry) {
  if (!armed || !deps.summary || typeof deps.summary.reportList !== 'function') return;
  schedule(deps.summary.reportList(), fromRetry === true);
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
  clearRetry(); // a disarmed writer holds no timer — `schedule` would refuse the re-run anyway
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
  RETRY_BACKOFF_MS: retryLane.RETRY_BACKOFF_MS, // 2026-09-14: the outer lane's ladder
  reportedWorkspaces,
};
