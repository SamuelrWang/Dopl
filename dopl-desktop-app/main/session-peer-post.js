// The OPERATOR's own message, posted into the channel addressed to the peer (v2.8).
//
// This is the main-process half of composer @-addressing. The renderer's `@their-agent`
// tag routes here instead of to session:send, and the difference is total: this module
// NEVER touches the SDK. No query, no pushTurn, no canUseTool, no permission request, no
// grant, and — structurally, asserted by a source grep in test/session-peer-post.test.mjs —
// no `dispatch` call anywhere in the file. That is what makes the park invariant hold:
// posting from a parked session leaves it parked, with no rebuilt query and no idle re-arm,
// because there is no session event to fire.
//
// SECURITY: the outbound approval card gates an AGENT-authored post. This one is
// human-typed, human-addressed, into a channel the human is already a member of, so a card
// would ask the operator to approve themselves to themselves (the identical posture to the
// web composer). grantDecision / allowForTask / autoApprove are untouched. The HTTP path is
// fail-closed: a 4xx is never retried and any failure paints "Not sent" in the window. The
// PEER's side gates it exactly like any other inbound message. channelId / workspaceId are
// read off the LIVE session at post time, so a session that gains its channel binding later
// posts correctly and one that never had it refuses locally.
//
// The message BODY is never logged: diag() sees an HTTP status and nothing else.

const crypto = require('crypto');
const { apiFetch } = require('./api');
const { clampBody } = require('./consent');
const { diag } = require('./diag');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── BEGIN SESSION-PEER-POST-PURE (injectable; unit-tested via source extraction) ──
// Free vars: crypto / apiFetch / clampBody / diag / sleep (required above, faked in tests).

// LOCAL refusal copy (no em dash). A shell with no channel binding cannot post anything,
// and saying so in the window beats a silent no-op.
const REFUSE_NO_CHANNEL = 'Could not send that message. This session is not bound to a channel yet.';
// FIX F9: the OTHER local refusal. A shell with no workspaceId sends no X-Workspace-Id, so
// withWorkspaceAuth answers 400 on a multi-workspace credential and the bubble read "Not sent"
// with no reason at all, unlike the no-channel case right above it. Say what happened. Only
// the STATUS is named: the message body reaches neither this notice nor the log.
const REFUSE_REJECTED_HEAD = 'Could not send that message. The server refused the request';
const REFUSE_REJECTED_TAIL = ' Nothing was posted. Reopening this session window usually fixes it.';
function refusedText(status) {
  return REFUSE_REJECTED_HEAD + (status ? ' (' + status + ')' : '') + '.' + REFUSE_REJECTED_TAIL;
}
const RETRY_DELAY_MS = 600;
const MAX_ATTEMPTS = 2;
const POST_TIMEOUT_MS = 20000;

// The wire body. authorKind 'user' is what makes this a HUMAN message on the peer's side
// (their gate + classify treat it like a web DM); metadata.taskId is what threads it into
// the same session card. NO `kind` key — that is for lifecycle events, not real messages.
// toUserId / metadata are omitted entirely when unknown rather than sent as null.
//
// DO NOT FIX F10 (pre-existing, not agent-reachable): authorKind is CALLER-ASSERTED, so the
// server takes our word that this message is human-authored. That is a property of the
// /api/channels/:id/messages contract every client shares, not of this module, and nothing an
// agent can reach touches this call: the tag route is the operator's keystroke in the composer
// and there is no tool, no MCP op and no SDK path into peerPost.send. Tightening it belongs
// server-side (deriving authorKind from the credential), not here.
function postBody(s, text, localId) {
  const sess = s || {};
  const body = { body: text, authorKind: 'user', clientMsgId: 'peer-' + localId };
  if (sess.counterpartyId) body.toUserId = sess.counterpartyId;
  if (sess.taskId) body.metadata = { taskId: sess.taskId };
  return body;
}

// Worth a second attempt: a rate-limit or a server fault. Every other 4xx is a fact about
// the request (a too-long body, a channel we cannot post to) and will not improve.
function retryable(status) {
  return status === 429 || status >= 500;
}

// The window is the only progress indicator, so an emit must never be able to break the
// post (or vice versa).
function safeEmit(emit, s, payload) {
  try {
    if (typeof emit === 'function') emit(s, payload);
  } catch (err) {
    diag('session-peer-post: emit failed', err && err.message);
  }
}

// Post `rawText` as the operator. Emits operator_post immediately (the bubble paints
// "Sending"), then operator_post_result with the verdict. Returns {ok} for the caller's
// logging only — the renderer learns the outcome from the event stream.
async function send(s, rawText, emit) {
  const text = clampBody(rawText).trim();
  if (!text) return { ok: false, reason: 'empty' }; // the same silent guard the composer has
  if (!s || !s.channelId) {
    safeEmit(emit, s, { type: 'notice', level: 'error', text: REFUSE_NO_CHANNEL });
    return { ok: false, reason: 'no-channel' };
  }
  const localId = crypto.randomUUID();
  safeEmit(emit, s, { type: 'operator_post', localId, to: s.counterpartyName || null, text });
  let ok = false;
  let lastStatus = 0; // FIX F9: the last HTTP status, so a refusal can EXPLAIN itself
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let again = false;
    try {
      const res = await apiFetch('/api/channels/' + s.channelId + '/messages', {
        method: 'POST',
        workspaceId: s.workspaceId,
        body: postBody(s, text, localId),
        timeoutMs: POST_TIMEOUT_MS,
      });
      if (res && res.ok) {
        ok = true;
        break;
      }
      const status = res ? res.status : 0;
      lastStatus = status;
      diag('session-peer-post: post failed', status, 'attempt', attempt); // status ONLY
      again = retryable(status);
    } catch (err) {
      diag('session-peer-post: post error attempt', attempt, err && err.message);
      again = true; // a transport throw (timeout / dead socket) is exactly what a retry is for
    }
    if (!again) break;
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
  }
  // FIX F9: a REFUSED request (a 4xx: no workspace header, not a member, a body the channel
  // rejects) gets the same courtesy the no-channel refusal gets — a notice that names the
  // status, emitted BEFORE the verdict so the bubble's "Not sent" already has its reason on
  // screen. A 5xx / transport failure stays bare: it is a transient fault, not a fact about
  // the request, and the retry already covered it.
  if (!ok && lastStatus >= 400 && lastStatus < 500) {
    safeEmit(emit, s, { type: 'notice', level: 'error', text: refusedText(lastStatus) });
  }
  safeEmit(emit, s, { type: 'operator_post_result', localId, ok });
  return { ok };
}

// ─── END SESSION-PEER-POST-PURE ────────────────────────────────────────────────────

module.exports = { send, postBody, retryable, refusedText, REFUSE_NO_CHANNEL, RETRY_DELAY_MS };
