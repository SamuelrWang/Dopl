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

const { isOwnChannelPost, isChannelTool } = require('./session-profiles');

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

// WHAT to do with this call's arguments. Three outcomes, and only one of them rewrites:
//   {action:'none'}      — nothing to do (no thread id, no input, or already correctly tagged)
//   {action:'inject'}    — `.input` is a COPY carrying thread=<the session's id>
//   {action:'conflict'}  — the agent named a DIFFERENT thread; `.supplied` is it, and the
//                          caller leaves the call alone and logs
// The input object is never mutated: the SDK, the render path and the grant key all hold the
// original, and a decision must not change under them.
function threadTagFor(input, taskId) {
  const want = typeof taskId === 'string' ? taskId.trim() : '';
  if (!want) return { action: 'none', reason: 'no-thread' };
  if (!input || typeof input !== 'object') return { action: 'none', reason: 'no-input' };
  const supplied = suppliedThreadId(input);
  if (!supplied) {
    const next = Object.assign({}, input);
    next[THREAD_ARG] = want;
    return { action: 'inject', input: next };
  }
  if (supplied === want) return { action: 'none', reason: 'already-tagged' };
  return { action: 'conflict', supplied: supplied, wanted: want };
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
function wrapAllow(resolve, tag) {
  if (!tag || tag.action !== 'inject') return resolve;
  return function resolveWithThreadTag(result) {
    if (result && result.behavior === 'allow') {
      resolve(Object.assign({}, result, { updatedInput: tag.input }));
      return;
    }
    resolve(result);
  };
}

module.exports = {
  THREAD_ARG,
  isOutboundPost,
  suppliedThreadId,
  threadTagFor,
  allowResult,
  wrapAllow,
};
