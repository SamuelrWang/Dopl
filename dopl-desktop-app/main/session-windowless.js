// session-windowless.js — the WINDOWLESS spawn shape (2026-08-20, the session-window
// retirement's second half).
//
// A responder session now runs on the REAL SDK engine with NO window: it registers in the
// engine's session Map (so the Agents tab, pause/end and the metrics all work), its emits
// no-op on the null `win`, and the two decisions the window used to host move to the
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
//   ANY OTHER GATED TOOL — denied. A gate means "ask a human", there is no surface to ask
//              on, and the headless lane this shape replaces had the same answer.
//
// ⚠ THE BRIDGE POLLS THE ROW (10s, stops with the session or the resolution) rather than
// subscribing: first-answer-wins means the web PATCH may decide it, and the row's status is
// the only truth (INVARIANTS §6 — decisions are CAS'd on the server row).

const consent = require('./consent');
const targeting = require('./targeting');
const channelPost = require('./channel-post'); // notifyLocal: the denial notice, local-only
const { diag } = require('./diag');

const POLL_MS = 10_000;

// ── THE CONCURRENCY CEILING FOR THIS LANE ────────────────────────────────────
// ⚠ THE NAME MOVED HERE ON 2026-08-20, AND THE NUMBER DID NOT CHANGE. `MAX_CONCURRENT_SESSIONS`
// used to name the HEADLESS pool's guard (`session-pool.js`, 4) while the windowless engine
// enforced a SEPARATE number under a window's name (`settings.MAX_SESSION_WINDOWS`, 6, since
// deleted). Two
// ceilings, one of them called a window budget, and the lane that is actually left was the one
// with the misleading name. The headless pool goes with its lane; this is the ceiling that
// survives, so it takes the name INVARIANTS §11 already uses for it.
//
// ⚠ IT IS A COST CEILING, NOT JUST A CONCURRENCY ONE: EVERY PER-SESSION BOUND IS
// MULTIPLICATIVE AGAINST IT (§11). The narration ring, the pending-inbound queue, the
// retained-ended set and the gated-body ledger are each N times this number in the worst case.
// Raising it is a memory decision as much as a concurrency one.
//
// VALUE UNCHANGED FROM WHAT THE ENGINE ALREADY ENFORCED, deliberately — this wave moves where
// the number lives and nothing about what it is.
const MAX_CONCURRENT_SESSIONS = 6;

// ── The spawn surface ────────────────────────────────────────────────────────
// ⚠ THERE IS ONE SHAPE LEFT AND IT MINTS NOTHING (2026-08-20, F-228). This function used
// to branch: a WINDOW (freshly built by the injected factory, or the open pre-consent card
// adopted through `session-consent.takeForAdopt`), or — under `spec.windowless` — none. The
// window branch went with `session-window.js` and the renderer it painted into.
//
// It stays a function rather than being inlined at the call site because the ENGINE'S
// ROLLBACK is the contract: `startSession` un-registers the session when a surface cannot
// be attached, and keeping the seam keeps that failure expressible. Returns true when the
// session has its surface; false = the caller rolls back.
function attachSurface(s, _spec) {
  s.windowless = true; // every emit no-ops on the null win; the Agents tab is the surface
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
// Claim a PENDING gate payload on a windowless session. Returns true when claimed (the
// caller must not fall through to the window emit). `decide(requestId, 'allow'|'deny')`
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
    setImmediate(() => decide(rid, 'deny'));
    diag('windowless session: gated tool denied (no surface to ask on)',
      String(payload.name || '').slice(0, 40));
    notifyDenied(s, payload);
    return true;
  }
  return false;
}

// ── The denial NOTICE (2026-08-20) ───────────────────────────────────────────
// ⚠ A SILENT DENY IS THE WORST HALF OF THIS SHAPE, AND IT IS NOT WHAT THE
// OPERATOR THINKS THEY CONFIGURED. `bypass` is a POSITIVE ALLOW-LIST
// (`session-profiles.js` — "Unknown therefore GATES IN EVERY MODE, `bypass`
// included"), so it covers the classified work set and nothing else: `Task`,
// `AskUserQuestion`, the plan-mode ops, any built-in a newer CLI ships, and
// EVERY tool from the operator's own connected MCP servers all still reach the
// gate. In a windowless session a gate is a deny, and until now the only trace
// was a diag line — so an operator who had set Tools = Bypass watched their
// agent quietly fail to do things and had nothing to read.
//
// ⚠ IT IS A NOTICE, NOT A DECISION SURFACE. The deny has already been dispatched
// above; nothing here can reverse it, and nothing here posts into the channel.
// Bridging these to a consent row the way an outbound post is bridged is a
// LATER wave — the shape is real (`bridgeOutbound`) but the product question
// (which gated tools deserve an interruption) is Samuel's, not this file's.
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
// ⚠ THE DENY IS UNCHANGED AND STILL HAPPENS EVERY TIME. `claimGate` has already
// dispatched it above and the diag line still records every one. This
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
    const tool = String((payload && payload.name) || 'A tool')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 40);
    // ⚠ KEYED ON THE SANITIZED, CAPPED LABEL — the string the operator actually reads, so two
    // names that DISPLAY identically collapse into one banner (they are one banner to a human),
    // and a hostile name cannot mint unbounded distinct keys past the cap above.
    if (!firstDenialOf(s, tool)) return;
    const channelName = (s.context && s.context.channelName) || 'this channel';
    channelPost.notifyLocal(
      `Dopl: ${tool} was not allowed`,
      `Your agent in "${channelName}" asked to use it. Nothing was running to ask on, so it was denied.`
    );
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
    onOpen: () => {
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
    },
  });
  await watchRow(s, rowId, rid, decide);
}

// Poll until the row settles, the permission is gone (a park deny-closed it), or the
// session itself settles. Every terminal status that is not an allow is a deny.
async function watchRow(s, rowId, requestId, decide) {
  for (;;) {
    await sleep(POLL_MS);
    if (s.settled || !s.pendingPermissions.has(requestId)) {
      // The tool call this row was gating is gone (park deny-closed it, or the
      // session ended). A row left `pending` would take a Send that posts
      // NOTHING — cancel it so the surface tells the truth. Best-effort.
      void consent.submitDecision(s.workspaceId, rowId, 'deny', {});
      return;
    }
    const status = await consent.pollStatus(s.workspaceId, rowId);
    if (status === null || status === 'pending') continue;
    const allow = status === 'allowed' || status === 'auto_allowed';
    diag('windowless outbound decided', allow ? 'allow' : `deny (${status})`, 'row', String(rowId).slice(0, 8));
    decide(requestId, allow ? 'allow-once' : 'deny');
    return;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { attachSurface, liveCount, claimGate, MAX_CONCURRENT_SESSIONS };
