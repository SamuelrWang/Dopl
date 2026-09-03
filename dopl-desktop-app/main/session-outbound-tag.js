// The session's OWN outbound post: classifying it, and FORCING the thread tag onto it.
//
// ── WHY THIS FILE EXISTS (incident 2026-07-31, second capture) ──────────────────────
// A requester opened FIRST-CLASS thread 300f2b7e (seq 141). The responder's session window
// answered at seq 143, and that reply carried metadata {runtime, summary, to_user_id} and NO
// taskId at all. On the requester's machine an addressed, agent-authored, thread-less message
// is indistinguishable from a fresh request, so it classified `trigger`, raised a consent row,
// and popped an "INCOMING REQUEST" window for the answer to its own question.
//
// The delivery prompt had already been fixed to NAME the thread (prompt-framing.deliveryCall,
// plus FIX S1 which corrected the argument from the non-existent `task` to the real `thread`).
// This capture is the proof that a correct prompt is not enough: the agent simply omitted the
// argument. A prompt is a request; the tag is an INVARIANT. So main enforces it.
//
// ── THE SEAM ────────────────────────────────────────────────────────────────────────
// session-io.makeCanUseTool already sees every `dopl_channel` call before it runs, and the
// Agent SDK's canUseTool may answer `{behavior:'allow', updatedInput}` (verified in the pinned
// @anthropic-ai/claude-agent-sdk 0.3.220: `PermissionResult` carries an optional
// `updatedInput`). So an ALLOW verdict can carry the corrected arguments. That is the only
// thing this module does — it never turns a deny into an allow, never touches either
// permission axis, and never runs for anything but the session's own channel post.
//
// ── THE RULES, AND WHY EACH ONE IS A REFUSAL ────────────────────────────────────────
//   - OWN CHANNEL POST ONLY (isOutboundPost). A cross-channel post is the exfiltration shape
//     D2/FIX #9 exist to catch; it is not ours to rewrite.
//   - ONLY WHEN THE SESSION HAS A THREAD ID. No id, no tag, byte-identical input.
//   - NEVER OVERWRITE. If the agent supplied a thread id — via the `thread` argument or a
//     `metadata.taskId` copy, both of which the MCP op honors — that value stands. When it
//     DIFFERS from the session's own we leave it and log, because an agent deliberately
//     threading elsewhere is a decision, and silently rewriting it would be main lying about
//     what the operator approved.
//   - THE VALUE IS OURS. `s.taskId` comes from the spawn spec on this machine, never off the
//     wire, and works for both a first-class UUID and a legacy `task-<channel>-<seq>` id (the
//     server passes a non-UUID through verbatim rather than resolving it).
//
// Split out of session-io.js because that file is AT the 500-line §2 cap, and kept
// dependency-free (session-profiles only, which is crypto + tool-profiles) so the truth table
// drives the real shipped code instead of a slice.

const {
  isOwnChannelPost, isChannelTool, isOwnChannelThreadOpen, isOwnChannelEscalate,
} = require('./session-profiles');

// ─── BEGIN SESSION-IO-PURE (pure; unit-tested via source extraction) ──────────
//
// Item 2 classifier. A `dopl_channel` op=post into the session's OWN channel is the real
// OUTBOUND message the agent sent to the peer — it must render as a sent message, not a
// generic tool card. Reuses the SAME op-scope as the grant (session-profiles.isOwnChannelPost);
// this does NOT widen the grant (§H-2), it only classifies for display. FIX F3: the tool-name
// half is `isChannelTool` (server prefix + short name), the SAME predicate the Axis-B branch
// uses, so a renamed/versioned channel tool cannot be gated as a message but painted as a
// generic tool card. Pure: references isChannelTool + isOwnChannelPost (both imported at module
// top) and holds no state, so the test slices this block and injects the real values.
function isOutboundPost(name, input, sessionChannelId) {
  return isChannelTool(name) && isOwnChannelPost(input, sessionChannelId);
}
// ─── END SESSION-IO-PURE ──────────────────────────────────────────────────────

// ── THE OUTBOUND CONSENT SHAPE (2026-08-24, Samuel's create_thread ruling) ────
//
// WHICH GATED `dopl_channel` CALLS RAISE THE OUTBOUND PAYLOAD (`outbound_gate`) INSTEAD OF THE
// DOCK'S `permission_request`. On a WINDOWLESS session that choice is the whole decision:
// `session-windowless.js › claimGate` BRIDGES an `outbound_gate` to a consent row plus a
// notification, and DENIES a `permission_request` outright because there is no surface to ask
// on. So the payload is the difference between "the operator is shown the bytes and may Send"
// and the live-observed refusal this ruling was written for — "this session has no surface to
// show one on, so the call was refused automatically."
//
// ⚠ IT IS DELIBERATELY NOT `isOutboundPost`, AND THE TWO MUST NOT BE MERGED. `isOutboundPost`
// also gates the FORCED THREAD TAG and the per-instance post stamp below, and neither applies
// to a thread OPEN: there is no thread yet to tag it with, and `create_thread` carries its own
// `client_msg_id` semantics. This predicate answers a RENDER/BRIDGE question; that one answers
// a REWRITE question, and one is not the other.
//
// ⚠ THE MEMBERSHIP IS THE GATE'S OWN, not a second list: `isOwnChannelThreadOpen` is
// `session-own-outbound.js`'s, re-exported through session-profiles, so a call that
// `grantDecision` classified onto the Axis-B outbound lane is exactly the call that reaches the
// outbound surface. A slug-addressed one is cross-channel to both, which is the safe failure.
// ⚠ `escalate` JOINED ON 2026-08-31 (Samuel's ruling) AND LEAVING IT OFF WOULD HAVE BEEN F-321
// EXACTLY. An escalation is a question a HUMAN has to answer, so the session asking one is
// windowless far more often than not — and without this predicate a gated one raises the dock's
// `permission_request`, which `claimGate` denies outright. The agent would be told "this session
// has no surface to show one on" about the one call whose entire purpose is to reach a surface.
function outboundConsentShape(name, input, sessionChannelId) {
  if (!isChannelTool(name)) return false;
  return isOutboundPost(name, input, sessionChannelId)
    || isOwnChannelThreadOpen(input, sessionChannelId)
    || isOwnChannelEscalate(input, sessionChannelId);
}

// ─── BEGIN OUTBOUND-THREAD-TAG (pure; unit-tested via source extraction) ──────
//
// The dopl_channel argument that threads a post. `thread` since the 1.7.11 hard cutover;
// the server folds it into the STORAGE key `metadata.taskId` (channel-ops-write.ts). Passing
// `task` — which is what the prompt used to teach, FIX S1 — names nothing.
const THREAD_ARG = 'thread';

// The thread id the AGENT put on this call, from either place the op reads one, or ''.
// `metadata.taskId` counts: the op honors it when no explicit `thread` is passed, so an
// agent that threaded that way has already made a choice we must not overwrite.
function suppliedThreadId(input) {
  const i = input && typeof input === 'object' ? input : {};
  const explicit = typeof i[THREAD_ARG] === 'string' ? i[THREAD_ARG].trim() : '';
  if (explicit) return explicit;
  const meta = i.metadata && typeof i.metadata === 'object' ? i.metadata : null;
  const viaMeta = meta && typeof meta.taskId === 'string' ? meta.taskId.trim() : '';
  return viaMeta;
}

// ── THE PER-INSTANCE POST STAMP (2026-08-21, Samuel's fan-out ruling) ─────────
//
// ⚠ WHY A SECOND INJECTED ARGUMENT, AND WHY HERE. Under fan-out every message on a thread is
// fed to every live agent on it EXCEPT its author, and AUTHORSHIP CANNOT ANSWER "which of my
// agents wrote this": all of them post under the operator's own account with
// `authorKind: 'agent'`, so three of my agents and I are indistinguishable on the wire. The
// only thing that can tell them apart is a token the writer chose, and the message row already
// has a field for exactly that — `client_msg_id`, which the MCP op accepts
// (`packages/mcp-server/src/tools/channel-schema.ts`) and the read DTO returns
// (`ChannelMessage.clientMsgId`). So each post is stamped with its author instance's id, the
// session records the stamp, and `session-dispatch.wroteIt` is a Set lookup.
//
// ⚠ IT IS THE SAME SEAM AND THE SAME RULES AS THE THREAD TAG, DELIBERATELY. Same reason the
// thread tag lives here rather than in the prompt: a prompt is a request, this is an invariant.
// NEVER OVERWRITE — an agent (or a retry) that supplied its own `client_msg_id` has made an
// idempotency decision and keeps it, exactly as a supplied `thread` stands. The input object is
// never mutated. The id also keeps the SERVER's de-dupe honest: uniqueness is per (channel,
// client_msg_id), and the instance id is random per spawn, so two agents cannot collide.
const CLIENT_MSG_ID_ARG = 'client_msg_id';

// The stamp for ONE post: `agent-<agentId>-<n>`, n counting this session's posts. Recorded on
// the session as it is minted, which is what makes the self-filter possible at all.
// ⚠ BOUNDED. `ownPostIds` is per-session and every per-session structure multiplies against
// MAX_CONCURRENT_SESSIONS (INVARIANTS §11), so it drops its oldest entry past the cap. 64 posts
// of lookback is far more than a thread's live window: the fan-out only ever asks about a
// message the listener is dispatching right now.
const MAX_OWN_POST_IDS = 64;

function nextOwnPostId(s) {
  if (!s || !s.agentId) return '';
  s.ownPostSeq = (Number(s.ownPostSeq) || 0) + 1;
  const id = `agent-${s.agentId}-${s.ownPostSeq}`;
  if (!s.ownPostIds) s.ownPostIds = new Set();
  s.ownPostIds.add(id);
  if (s.ownPostIds.size > MAX_OWN_POST_IDS) {
    const oldest = s.ownPostIds.values().next();
    if (!oldest.done) s.ownPostIds.delete(oldest.value);
  }
  return id;
}

// ── ⚠ THE "IT LAST SPOKE" STAMP (2026-09-01, T51/T83) ──────────────────────────────────
//
// `session-health.js` measures both the QUIET WINDOW and the token DELTA from the last thing
// this session said, and this is the one place a post is stamped — so putting the clock
// anywhere else would let "it spoke" and "when it spoke" drift apart.
//
// ⚠ **IT IS A SEPARATE FUNCTION FROM {@link nextOwnPostId}, AND THAT SEPARATION IS THE WHOLE
// FIX (2026-09-02).** The two lines used to sit at the bottom of the id minter — and the minter
// runs BEFORE the verdict (`session-gate-bridge.js › gateCall` computes the tag first, because
// the tag has to ride the verdict it cannot make). So EVERY REFUSED POST RESET THE STALENESS
// CLOCK: a wedged agent hammering a tool it is denied looked freshly talkative, one denial per
// tick, forever — which is precisely the class T51 exists to surface and precisely the class
// that got the strongest immunity.
//
// ⚠ CALLED ON THE ALLOW BRANCHES ONLY, and "allow" INCLUDES the operator's own click on a
// parked card: the session has DECIDED to speak and a human said yes, so treating the wait for
// delivery as silence would flag the agent that is doing exactly what it should. What it must
// NOT include is a verdict of `deny` — nothing was said, and nothing is what the clock should
// report. It rides beside `ownPostSeq`, whose lifetime it shares.
function markOwnPost(s) {
  if (!s || !s.agentId) return;
  s.lastOwnPostAt = Date.now();
  s.tokensAtLastPost = Number(s.tokensSpent) || 0;
}

// WHAT to do with this call's arguments. Three outcomes, and only one of them rewrites:
//   {action:'none'}      — nothing to do (no input, or every argument already supplied)
//   {action:'inject'}    — `.input` is a COPY carrying thread=<the session's id> and/or
//                          client_msg_id=<this instance's stamp>
//   {action:'conflict'}  — the agent named a DIFFERENT thread; `.supplied` is it, and the
//                          caller leaves the call alone and logs
// The input object is never mutated: the SDK, the render path and the grant key all hold the
// original, and a decision must not change under them.
// ⚠ `clientMsgId` IS OPTIONAL AND ABSENT MEANS TODAY'S BEHAVIOUR BYTE FOR BYTE — the thread-tag
// truth table drives this function with two arguments and must keep passing unchanged.
// ⚠ A CONFLICT STILL WINS OVER THE STAMP. When the agent threaded somewhere else we leave the
// WHOLE call as written and log: rewriting half of a call the operator will see is worse than
// rewriting none of it, and a post that is deliberately going to another thread is not a post
// this session should later filter out of its own feed.
function threadTagFor(input, taskId, clientMsgId) {
  const want = typeof taskId === 'string' ? taskId.trim() : '';
  const stamp = typeof clientMsgId === 'string' ? clientMsgId.trim() : '';
  if (!want && !stamp) return { action: 'none', reason: 'no-thread' };
  if (!input || typeof input !== 'object') return { action: 'none', reason: 'no-input' };
  const supplied = want ? suppliedThreadId(input) : '';
  if (want && supplied && supplied !== want) {
    return { action: 'conflict', supplied: supplied, wanted: want };
  }
  const next = Object.assign({}, input);
  let changed = false;
  if (want && !supplied) { next[THREAD_ARG] = want; changed = true; }
  if (stamp && !(typeof input[CLIENT_MSG_ID_ARG] === 'string' && input[CLIENT_MSG_ID_ARG].trim())) {
    next[CLIENT_MSG_ID_ARG] = stamp;
    changed = true;
  }
  if (!changed) return { action: 'none', reason: 'already-tagged' };
  return { action: 'inject', input: next };
}
// ─── END OUTBOUND-THREAD-TAG ──────────────────────────────────────────────────

// The immediate (auto-allowed) verdict, tagged when there is something to tag. An allow with
// no injection is the exact object the gate returned before, so the pre-approved and
// task-granted paths are unchanged for every call that needs nothing.
function allowResult(tag) {
  return tag && tag.action === 'inject'
    ? { behavior: 'allow', updatedInput: tag.input }
    : { behavior: 'allow' };
}

// The GATED path's resolver, wrapped. The operator's decision still decides: a deny (or a
// park's fail-closed deny, or any non-allow shape) passes through untouched and carries no
// updatedInput. Only an allow gains the corrected arguments.
// ⚠ `onAllow` IS THE STALENESS STAMP'S HOOK (2026-09-02) and it fires on the OPERATOR's allow,
// never on their deny — see {@link markOwnPost}. It is a callback rather than a session argument
// so this module keeps knowing nothing about how a verdict is reached.
function wrapAllow(resolve, tag, onAllow) {
  const inject = !!(tag && tag.action === 'inject');
  if (!inject && typeof onAllow !== 'function') return resolve;
  return function resolveWithThreadTag(result) {
    const allowed = !!(result && result.behavior === 'allow');
    if (allowed && typeof onAllow === 'function') onAllow();
    if (allowed && inject) {
      resolve(Object.assign({}, result, { updatedInput: tag.input }));
      return;
    }
    resolve(result);
  };
}

module.exports = {
  isOutboundPost,
  outboundConsentShape, // 2026-08-24: …plus an own-channel create_thread — the OUTBOUND payload's predicate
  suppliedThreadId,
  threadTagFor,
  nextOwnPostId, // 2026-08-21: the per-instance stamp the fan-out self-filter reads
  markOwnPost, // 2026-09-02: T51's staleness clock — ALLOW branches only
  MAX_OWN_POST_IDS,
  CLIENT_MSG_ID_ARG,
  allowResult,
  wrapAllow,
};
