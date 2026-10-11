// session-windowless.js — the WINDOWLESS spawn shape (2026-08-20, the session-window
// retirement's second half).
//
// A responder session now runs on the REAL SDK engine with NO window: it registers in the
// engine's session Map (so the Agents tab, pause/end and the metrics all work), its only
// emit is the gate bridge below (`claimGate`), and the two decisions the window used to host move to the
// channels surfaces:
//
//   INBOUND  — auto-consumed. The spawn's message axis is floored at `auto_inbound`
//              (trigger.js decides the exact posture), because there is no Accept UI and
//              the consent that admitted the THREAD is the human decision (INVARIANTS §6).
//   OUTBOUND — an own-channel post that GATES (message axis not auto-outbound) bridges to
//              a CONSENT ROW (`kind: 'outbound'`) + a native notification, and the thread
//              view's SEND BOX / the Inbox list render it. The decision resolves the held
//              tool call through the reducer's own `permission_decision` event — the agent
//              posts its own bytes; nothing here posts on its behalf.
//   ANY OTHER GATED TOOL — HELD and ASKED, since 2026-08-31 (Samuel's ruling; it was an
//              immediate deny before). The call stays pending, a native notification with an
//              ALLOW action is shown, and the gate resolves on the click — or DENIES when
//              `TOOL_GATE_TTL_MS` passes unanswered, with a message that says a human was
//              notified and did not answer (a different fact from "nobody was asked", and
//              `session-permissions.js` carries all three sentences). ⚠ LOCAL, deliberately:
//              no server row — a tool grant is a fact about THIS machine and must not be
//              writable by anything holding the operator's Dopl credential (the argument
//              `orchestrator-consent.js` makes for its toggles). The one shape that still
//              denies outright is a platform with no Notification support at all, which is
//              the true no-surface case and keeps the old copy.
//
// ⚠ THE BRIDGE POLLS THE ROW (stops with the session or the resolution) rather than
// subscribing: first-answer-wins means the web PATCH may decide it, and the row's status is
// the only truth (INVARIANTS §6 — decisions are CAS'd on the server row).

const consent = require('./consent');
const targeting = require('./targeting');
const channelPost = require('./channel-post'); // postTaskEvent: the in-thread record
// 2026-08-31: which DENIAL COPY a refused gate deserves is stamped HERE now, not by the engine —
// this file alone knows whether a prompt was shown, timed out, or had no surface at all.
const sessionPermissions = require('./session-permissions');
const { diag } = require('./diag');

// ⚠ 3s (down from 10s, 2026-08-25): the loop sleeps BEFORE its first poll, so the interval is
// the floor on how soon a decision shows up. COST: one request per interval per WAITING post,
// so the ceiling is MAX_CONCURRENT_SESSIONS / 3s (~5 req/s at 15) and moves with the cap; it
// stops on the first terminal status. NOT a decaying ladder, deliberately: that would punish
// the operator who comes back later, the case the 24h TTL exists for (`consent-cadence.js`
// was that idea and was deleted). The real fix is a doorbell, filed as F-312.
const POLL_MS = 3_000;
// …and the ceiling this poll gives back to when it is FAILING rather than waiting
// (2026-08-30, F-354). See `watchRow` for why the two are different questions.
const POLL_MAX_MS = 60_000;

// ── THE CONCURRENCY CEILING FOR THIS LANE ────────────────────────────────────
// The one ceiling on live sessions (the name INVARIANTS §11 uses). 15 since 2026-09-01
// (Samuel's ruling: an orchestrator spawns workers and must not hit the cap with its own staff
// running); `agent-self-ops.js › end_agent` lets an agent return a slot.
// ⚠ EVERY PER-SESSION BOUND IS MULTIPLICATIVE AGAINST IT (§11): the narration ring, the
// pending-inbound queue, the retained-ended set, the gated-body ledger. The ring is bounded by
// characters (`session-narration.js › RING_CHAR_BUDGET`), so what really limits this build is
// N live SDK child processes and API spend, neither bounded here. Measure which before moving it.
const MAX_CONCURRENT_SESSIONS = 15;

// ── The spawn surface ────────────────────────────────────────────────────────
// One shape, and it mints nothing (the window branch was retired 2026-08-20, F-228). Kept a
// function because the ENGINE'S ROLLBACK is the contract: `startSession` un-registers the
// session when this returns false. Today it cannot (pinned by session-launch-refusal-detail).
function attachSurface(s, _spec) {
  s.windowless = true; // the Agents tab is the surface
  return true;
}

// How many unsettled sessions the engine holds — the windowless shape's own concurrency
// bound (the window budget cannot count what mints no window).
function liveCount(sessions) {
  let n = 0;
  for (const s of sessions.values()) if (!s.settled) n += 1;
  return n;
}

// ── The gate bridge ──────────────────────────────────────────────────────────
// Claim a PENDING gate payload on a windowless session. Returns true when claimed (the engine's
// `emit` ignores it; tests pin it). `decide(requestId, 'allow'|'deny')`
// dispatches the reducer's own `permission_decision`, so state stays consistent.
function claimGate(s, payload, decide) {
  if (!s.windowless || !payload) return false;
  const rid = payload.requestId;
  if (!rid || !s.pendingPermissions.has(rid)) return false;
  if (payload.type === 'outbound_gate') {
    // ⚠ setImmediate: emit runs inside a dispatch; deciding synchronously would re-enter.
    setImmediate(() => { void bridgeOutbound(s, payload, decide); });
    return true;
  }
  if (payload.type === 'permission_request') {
    // ⚠ RE-EMIT DEDUPE: a payload can reach emit more than once for one request (a reshow, a
    // narration replay); the FIRST claim armed the notification and the TTL, and a second
    // banner for the same held call is the storm ruling 6b closed. Claimed, and nothing else.
    if (!s.bridgedToolGates) s.bridgedToolGates = new Set();
    if (s.bridgedToolGates.has(rid)) return true;
    if (s.bridgedToolGates.size >= MAX_BRIDGED_GATES) {
      s.bridgedToolGates.delete(s.bridgedToolGates.values().next().value);
    }
    s.bridgedToolGates.add(rid);
    // ⚠ setImmediate for the outbound branch's reason: emit runs inside a dispatch.
    setImmediate(() => bridgeToolGate(s, payload, decide));
    return true;
  }
  return false;
}

// ── THE TOOL-GATE BRIDGE (2026-08-31, Samuel's ruling) ───────────────────────
// A gated tool used to be denied on the spot with "no surface to ask on" — and the operator's
// own paste of the result ("Skill … NOBODY WAS ASKED … Bash … denied") is what bought this
// bridge: the agent had legitimate work behind the gate, the operator was sitting right there,
// and the machine refused on their behalf without asking. The notification IS a surface.
//
// ⚠ ALLOW-ONCE ONLY. The banner's button resolves THIS call; it mints no standing grant (the
// decide lane carries no tool name for `allow-task` to key on, and a banner is too small a
// surface to grant a session-wide power from). Repeat calls re-prompt; the systemic fix for
// that friction is the default-permissions work, not a wider grant here.
// ⚠ DISMISS DECIDES NOTHING (notify-action.js's rule) — only the TTL or a click resolves.
const TOOL_GATE_TTL_MS = 10 * 60_000;
const MAX_BRIDGED_GATES = 64; // same idiom + bound as autoDeniedIds; dies with the session

/** The sanitized, bounded tool label — ONE spelling for the banner, the diag and the dedupe. */
function toolLabel(payload) {
  return String((payload && payload.name) || 'A tool')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 40);
}

// ── THE DENIAL LEDGER (2026-09-01, T25) — WHAT AN ORCHESTRATOR CAN SEE ───────
//
// ⚠ THE DEFECT IT CLOSES IS INVISIBILITY, NOT THE DENY ITSELF. A windowless session whose calls
// are being refused looks IDENTICAL, from off this machine, to one that is working: the
// projection said `working · tool Bash` for sixteen minutes while every call died. The operator
// gets a banner (`notifyDenied`) and the agent gets a sentence
// (`session-permissions.js › denialMessage`); the ORCHESTRATOR that launched the agent and is
// waiting on it got nothing at all, and its only recourse was to keep waiting.
//
// ⚠ TWO NUMBERS ON THE SESSION OBJECT, AND THEY DIE WITH IT. `deniedCalls` counts every denial
// this bridge DECIDED and `lastDeniedTool` names the most recent one; both ride the projection
// (`session-metrics.js › metrics`) out to `read_sessions`. Nothing is stored per (session, tool)
// here — `notifiedDenials` below already pays that cost for the BANNER, and a second bounded set
// for a COUNT would be a bound on a number that cannot grow.
//
// ⚠ IT COUNTS THE TWO DENIALS THIS FILE DECIDES AND NO OTHERS, WHICH IS THE HONEST SCOPE. A
// `deny` VERDICT from `grantDecision` (a hard deny, the launch-depth cap, the T85 await refusal)
// never reaches `claimGate` — `session-gate-bridge.js › gateCall` answers it settled — so it is
// not counted and must not be described as if it were. What IS counted is the class the ticket
// is about: a call that was HELD and then refused with nobody deciding it.
function noteDenied(s, tool) {
  if (!s) return false;
  s.deniedCalls = (Number(s.deniedCalls) || 0) + 1;
  s.lastDeniedTool = tool;
  return s.deniedCalls === 1;
}

// ── THE ONE POST (2026-09-01, T25) ───────────────────────────────────────────
//
// ⚠ EXACTLY ONE PER SESSION, AND THE BOUND IS THE WHOLE DESIGN. This writes into the SHARED
// channel transcript, which every member reads, so the failure mode a per-denial post would have
// is `notifyDenied`'s storm one turn worse: a wall of identical rows in a room, each of them
// costing a peer's listener a decision. The FIRST denial is the one that carries information —
// "this agent has started being refused" — and every one after it is the same sentence.
//
// ⚠ IT SAYS THE MODE ONLY WHEN THE MODE IS THE REMEDY. `denied Bash (tool mode auto)` tells the
// reader which of two different things happened: a posture too narrow for the work (the operator
// can widen it), or a tool nothing widens (`bypass` is a positive allow-list, so an unclassified
// name gates in every mode). Without the mode the line is a complaint; with it, it is an action.
//
// ⚠ BUT A `dopl_channel` OP IS DECIDED ON AXIS B, AND NAMING THE TOOL MODE FOR ONE OF THOSE IS A
// LIE (GATE-BUG-REPORT 2026-09-15, fix 1). Every `dopl_channel` call is classified per-OP on the
// MESSAGE axis; `denied mcp__dopl__dopl_channel (tool mode bypass)` reads as "bypass is broken"
// and sends the operator to widen a posture that never decided the call. The real code is already
// on the payload — `session-gate-bridge.js` sets `gateReason` from the verdict — so the line
// prints THE REASON when there is one and falls back to the mode only when there is not.
//
// ⚠ IT IS `task_progress`, NOT A `message`. A lifecycle kind reaches no session at all
// (`session-dispatch.js › feedLiveSession`'s kind filter), so this cannot start a turn, cannot
// feed back into the session that produced it, and cannot cost the peer a consent decision. A
// `message` here would be an agent-shaped post that this machine, not the agent, wrote.
//
// ⚠ THE `clientMsgId` IS PER SESSION, NOT PER MESSAGE, so the server's own uniqueness is a SECOND
// guarantee of the same bound rather than a different one. `postTaskEvent`'s default keys on
// (kind, channel, seq) and two denials under one inbound seq would share it by luck; this says
// what is actually meant.
//
// ⚠ BEST-EFFORT AND NEVER IN THE WAY OF THE DENY. `postTaskEvent` never throws and the deny is
// already dispatched by the time this runs; a channel that cannot be posted into costs the
// visibility, never the decision.
function announceDenial(s, tool, gateReason) {
  try {
    if (!s || !s.channelId) return;
    const why = gateReason || `tool mode ${(s.state && s.state.toolMode) || 'manual'}`;
    const entry = { channel: { id: s.channelId }, workspaceId: s.workspaceId };
    Promise.resolve(channelPost.postTaskEvent(
      entry,
      { seq: s.lastInboundSeq },
      'task_progress',
      s.taskId || undefined,
      undefined,
      `denied ${tool} (${why}); further denials counted`,
      // ⚠ TWO IDS, TWO JOBS, DELIBERATELY NOT COLLAPSED (2026-09-15, docs/traces/AGENT-BADGE-TRACE.md). The
      // `clientMsgId` keys on the EPHEMERAL id because a resumed session may legitimately start
      // being refused again; the ATTRIBUTION stamp keys on the SLOT key because that is the one
      // naming the AGENT, which is what makes this row say who is being refused rather than the
      // bare noun "Agent".
      { clientMsgId: `denied-${s.channelId}-${s.sessionId}`, sessionId: s.key }
    )).catch((err) => diag('windowless denial notice failed —', err && err.message));
  } catch (err) {
    diag('windowless denial notice threw —', (err && err.message) || String(err));
  }
}

/** Both deny paths funnel here: count it, and announce the FIRST one only. */
function recordDenial(s, tool, gateReason) {
  if (noteDenied(s, tool)) announceDenial(s, tool, gateReason);
}

/** A notification's open action: this session's thread. Best-effort navigation. */
function openThread(s, channelName) {
  try {
    targeting.openChannelForEntry(
      {
        channel: { id: s.channelId, name: channelName },
        workspaceId: s.workspaceId,
        // openChannelForEntry no-ops without the SEGMENT — it rides the context.
        workspaceSegment: (s.context && s.context.workspaceSegment) || null,
      },
      { threadId: s.taskId }
    );
  } catch (_) { /* navigation is best-effort */ }
}

function bridgeToolGate(s, payload, decide) {
  const rid = payload.requestId;
  const tool = toolLabel(payload);
  const channelName = (s.context && s.context.channelName) || 'this channel';
  const notif = consent.notifyToolGate({
    channelName,
    tool,
    onAllow: () => decide(rid, 'allow-once'),
    onOpen: () => openThread(s, channelName),
  });
  if (!notif) {
    // The TRUE no-surface case — no Notification support on this platform. The pre-2026-08-31
    // behaviour in full: immediate deny, the NOBODY-WAS-ASKED copy, the deduped local notice.
    sessionPermissions.noteAutoDenied(s, rid);
    decide(rid, 'deny');
    diag('windowless session: gated tool denied (no surface to ask on)', tool);
    notifyDenied(s, payload);
    recordDenial(s, tool, payload.gateReason); // T25: after the deny — the ledger never delays a decision
    return;
  }
  diag('windowless tool gated — operator notified', tool, 'req', String(rid).slice(0, 8));
  const timer = setTimeout(() => {
    // Already resolved (the click, a park's deny-close, the session's settle) → nothing to do.
    if (s.settled || !s.pendingPermissions.has(rid)) return;
    // ⚠ STAMPED BEFORE THE DECIDE, so `resolvePerm` reads the timeout copy and not
    // "Denied by operator" — nobody said no, and claiming so is the defect class
    // `session-permissions.js` exists to remove.
    sessionPermissions.noteGateTimeout(s, rid);
    decide(rid, 'deny');
    diag('windowless tool gate expired unanswered', tool, 'req', String(rid).slice(0, 8));
    // T25: an unanswered prompt is the MODERN shape of the silent denial this ticket is about —
    // the operator was asked, said nothing, and the orchestrator waiting on the agent still has
    // no way to know. Counted and announced on exactly the same terms as the no-surface deny.
    recordDenial(s, tool, payload.gateReason);
    try { notif.close(); } catch (_) { /* best-effort */ }
  }, TOOL_GATE_TTL_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
}

// ── The denial NOTICE (2026-08-20) — the FALLBACK's notice since 2026-08-31 ──
// ⚠ A SILENT DENY IS THE WORST HALF OF THIS SHAPE, AND IT IS NOT WHAT THE
// OPERATOR THINKS THEY CONFIGURED. `bypass` is a POSITIVE ALLOW-LIST
// (`session-profiles.js` — "Unknown therefore GATES IN EVERY MODE, `bypass`
// included"), so it covers the classified work set and nothing else: `Task`,
// `AskUserQuestion`, the plan-mode ops, any built-in a newer CLI ships, and
// EVERY tool from the operator's own connected MCP servers all still reach the
// gate.
//
// ⚠ SINCE 2026-08-31 THE ORDINARY PATH ASKS (`bridgeToolGate` above), so this
// notice fires only on the platform-without-notifications fallback — where the
// deny has already been dispatched and nothing here can reverse it. It is a
// NOTICE, not a decision surface, and it posts nothing into the channel.
//
// ⚠ NAMES THE TOOL AND THE CHANNEL, and nothing else. The tool NAME is a
// counterparty-influenceable string on its way to an OS notification, so it is
// bounded the same way every other display string on this path is.
//
// ── ONE NOTICE PER TOOL PER SESSION (2026-08-22, Samuel's ruling 6b) ─────────
// ⚠ A DENIAL STORM MUST BE ONE BANNER, NOT N. In live testing a burst of denied
// calls on one tool produced a burst of IDENTICAL notifications — which is a
// worse surface than the silence it replaced, because a wall of the same banner
// is dismissed wholesale and takes the first, informative one with it. The first
// denial of tool T on session S notifies; later denials of T on S do not.
//
// ⚠ THE DENY IS UNCHANGED AND STILL HAPPENS EVERY TIME. `bridgeToolGate` has already
// dispatched it before calling here and the diag line still records every one. This
// de-duplicates the INTERRUPTION, never the decision — a notice cannot become a
// grant by being skipped.
//
// ⚠ BOUNDED, AND ON THE SESSION OBJECT. The idiom is `trigger-outcomes.js ›
// MAX_REMEMBERED_ENDS`: a cap, oldest evicted first by insertion order. An
// unbounded Set is the shape this tree has already been bitten by, and keying
// module state by session id would leak one entry per session for the life of
// the process — here the memory dies WITH the session object. 32 is far above
// the tool vocabulary one agent exercises, and an eviction costs at worst one
// repeated banner, never a missed deny.
const MAX_NOTIFIED_DENIALS = 32;
function firstDenialOf(s, tool) {
  if (!s.notifiedDenials) s.notifiedDenials = new Set();
  if (s.notifiedDenials.has(tool)) return false;
  if (s.notifiedDenials.size >= MAX_NOTIFIED_DENIALS) {
    s.notifiedDenials.delete(s.notifiedDenials.values().next().value);
  }
  s.notifiedDenials.add(tool);
  return true;
}

function notifyDenied(s, payload) {
  try {
    const tool = toolLabel(payload);
    // ⚠ KEYED ON THE SANITIZED, CAPPED LABEL — the string the operator actually reads, so two
    // names that DISPLAY identically collapse into one banner (they are one banner to a human),
    // and a hostile name cannot mint unbounded distinct keys past the cap above.
    if (!firstDenialOf(s, tool)) return;
    const channelName = (s.context && s.context.channelName) || 'this channel';
    require('./notification-route').raise('tool_blocked', { // POPUP ONLY (`tool_blocked`, 2026-10-09)
      title: `Dopl: ${tool} was not allowed`,
      body: `Your agent in "${channelName}" asked to use it. Nothing was running to ask on, so it was denied.`,
    });
  } catch (_) { /* best-effort — a notice must never break the deny */ }
}

async function bridgeOutbound(s, payload, decide) {
  const rid = payload.requestId;
  const body = String(payload.text || '');
  const channelName = (s.context && s.context.channelName) || 'this channel';
  // The seq join is what places the send box on the THREAD (view-model-requested's
  // pendingOutboundByThread): the latest inbound turn's seq, the trigger's as the floor.
  // A second draft against the same seq collides with the de-dupe key — retried seq-less,
  // which keeps it decidable from the Inbox list (a NULL seq is unconstrained, §6).
  if (!s.watchedOutboundRows) s.watchedOutboundRows = new Set();
  let created = await consent.createConsentRequest(s.workspaceId, {
    channelId: s.channelId,
    kind: 'outbound',
    messageSeq: s.lastInboundSeq != null ? s.lastInboundSeq : undefined,
    summary: `Reply from your agent in "${channelName}"`,
    bodyPreview: body,
    proposedReply: body,
  });
  // ⚠ THE SEQ DE-DUPE RETURNS THE EXISTING ROW, NOT A FAILURE (consent-service
  // findConsentByTrigger, ANY status). A row that is already decided — or already
  // carrying ANOTHER draft of this session — must never authorize THIS draft's
  // bytes: one Send may approve exactly the body the operator reviewed. Re-create
  // seq-less (a NULL seq is unconstrained, INVARIANTS §6); it stays decidable from
  // the notification and the Inbox list.
  if (created && ((created.status && created.status !== 'pending') || s.watchedOutboundRows.has(created.rowId))) {
    created = await consent.createConsentRequest(s.workspaceId, {
      channelId: s.channelId,
      kind: 'outbound',
      summary: `Reply from your agent in "${channelName}"`,
      bodyPreview: body,
      proposedReply: body,
    });
  }
  if (!created) {
    // Fail closed, loudly: no row means no surface can ever approve this.
    diag('windowless outbound: consent row create failed — denying the post');
    decide(rid, 'deny');
    return;
  }
  const rowId = created.rowId;
  s.watchedOutboundRows.add(rowId);
  diag('windowless outbound gated', 'row', String(rowId).slice(0, 8), 'thread', String(s.taskId).slice(0, 8));
  consent.notifyOutbound({
    channelName,
    proposedReply: body,
    // The notification's SEND action decides immediately; the body CLICK only
    // navigates — to the THREAD, where the send box is (Samuel, 2026-08-20).
    onSend: () => {
      void consent.submitDecision(s.workspaceId, rowId, 'allow', { channelName });
    },
    onOpen: () => openThread(s, channelName),
  });
  await watchRow(s, rowId, rid, decide);
}

// Poll until the row settles, the permission is gone (a park deny-closed it), or the
// session itself settles. Every terminal status that is not an allow is a deny.
//
// ⚠ A FAILED READ IS NOT A PENDING ROW (2026-08-30, F-354). `pollStatus` answers `null`
// for every transient failure — a 5xx, a torn socket, our own timeout — and this loop
// treated that identically to "still waiting", so an API that was DOWN produced a
// three-second poll with no backoff and no ceiling for as long as the session lived, one
// abandoned `Response` per turn. The row's real cadence is unchanged; only the failing
// read gives back, doubling to POLL_MAX_MS. It never gives UP: the operator may still
// decide, and the session's own settle is what ends this loop.
async function watchRow(s, rowId, requestId, decide) {
  let failures = 0;
  for (;;) {
    await sleep(failures ? Math.min(POLL_MAX_MS, POLL_MS * 2 ** Math.min(failures, 8)) : POLL_MS);
    if (s.settled || !s.pendingPermissions.has(requestId)) {
      // The tool call this row was gating is gone (park deny-closed it, or the
      // session ended). A row left `pending` would take a Send that posts
      // NOTHING — cancel it so the surface tells the truth. Best-effort.
      void consent.submitDecision(s.workspaceId, rowId, 'deny', {});
      return;
    }
    const status = await consent.pollStatus(s.workspaceId, rowId);
    if (status === null) { failures += 1; continue; } // could not ASK — back off
    failures = 0;
    if (status === 'pending') continue; // asked and answered: still waiting, full cadence
    const allow = status === 'allowed' || status === 'auto_allowed';
    diag('windowless outbound decided', allow ? 'allow' : `deny (${status})`, 'row', String(rowId).slice(0, 8));
    decide(requestId, allow ? 'allow-once' : 'deny');
    return;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  attachSurface,
  liveCount,
  claimGate,
  MAX_CONCURRENT_SESSIONS,
  TOOL_GATE_TTL_MS, // 2026-08-31: how long a held tool gate waits for the banner's Allow
  // 2026-09-01 (T25): the denial LEDGER. Exported for the suite and for nothing else — the two
  // call sites are in this file, and a second writer of `deniedCalls` is how a count that an
  // orchestrator ACTS on comes to mean two different things.
  noteDenied,
};
