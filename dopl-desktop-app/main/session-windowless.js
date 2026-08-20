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
const { diag } = require('./diag');

const POLL_MS = 10_000;

// ── The spawn surface: a window, an adopted card, or nothing at all ──────────
// Returns true when the session has its surface; false = the caller rolls back.
function attachSurface(s, spec, deps) {
  if (spec.windowless) {
    s.windowless = true; // every emit no-ops on the null win; the Agents tab is the surface
    return true;
  }
  const adopted = deps.sessionConsent.takeForAdopt(s.key);
  try {
    s.win = (adopted && adopted.win && !adopted.win.isDestroyed())
      ? adopted.win
      : deps.windowFactory(s.sessionId);
    if (!s.win) throw new Error('window factory returned nothing');
  } catch (err) {
    diag('session-engine: window factory failed', err && err.message);
    return false;
  }
  deps.sessionShell.bindWindow(s);
  deps.sessionShell.emitFolder(s);
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
    return true;
  }
  return false;
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

module.exports = { attachSurface, liveCount, claimGate };
