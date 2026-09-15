// `X-Dopl-Session-Id` — WHICH SESSION OF THIS OPERATOR'S A MAIN-PROCESS POST IS ABOUT.
//
// ── THE DEFECT IT EXISTS FOR (2026-09-15, AGENT-BADGE-TRACE.md) ──────────────────────────────
//
// Samuel: *"occasionally I'll see a message that says agent ended. But this isn't one of Dopl's
// agents. The badge says just Agent … I notice it popping up randomly."*
//
// Those rows are `task_progress` posts THIS PROCESS writes about a session — the calm ended
// note (`trigger-outcomes.js › onEnded`) and the windowless denial counter — and they arrived
// carrying no identity at all. Two doors name an agent and both were shut:
//   1. the post STAMP on `client_msg_id`, which these writers cannot use (their ids are
//      `task_progress-<channelUUID>-<seq>` and `denied-<channelId>-<sessionId>`, and the
//      anchored pattern in `src/features/channels/lib/agent-post-stamp.ts` refuses both by
//      design — a channel UUID can begin with eight id-shaped characters); and
//   2. this HEADER, which `listener-io.js` never set. `resolvePostMetadata` strips any
//      caller-supplied `metadata.session_id` and re-stamps the reserved key from the header
//      ALONE, so an unstamped post is anonymous no matter what it puts in its body.
// `authorAgentIdOf` therefore answered null, the `channel_sessions.display_name` join was never
// attempted, and the transcript honestly rendered the bare noun "Agent" over a session the
// operator had named and could no longer recognise.
//
// ⚠ A SPAWNED SESSION ALREADY HAD THIS, from a seam main does not use:
// `runtime/claude/launch-spec.js` hands the slot key to `loader.js › withSessionStamp`, which
// pins the header onto the SDK's MCP entry. That asymmetry is the whole bug — an agent's own
// posts were attributable and the desktop's posts ABOUT that agent were not.
//
// ── WHY A MODULE RATHER THAN THREE LINES IN `listener-io.js` ─────────────────────────────────
//
// It is `app-version.js`'s shape, deliberately: a stamp with a shape rule, a header name and a
// `{}`-or-`{header}` helper, so a caller SPREADS it and never branches. That is what keeps an
// absent value from being sent as a blank header, it gives the rule one home to be corrected in,
// and it keeps `listener-io.js` (at the §2 500-line cap) to the two lines that actually post.
//
// ⚠ A LABEL, NOT A LOCK — the server's own header module says the same sentence and it is the
// one property that must never erode. Nothing is granted, nothing enforced, no session count
// limited: any device-token holder can send any value, so NOTHING may gate access, capability or
// trust on it. It makes one account's concurrent sessions TELLABLE APART after the fact, and
// that is all it does.

// ⚠ THE SHAPE IS THE SERVER'S, MIRRORED (`src/shared/auth/session-header.ts › SESSION_ID_RE`)
// and identical to `runtime/claude/loader.js › withSessionStamp`'s copy: id characters only, no
// whitespace, <=128. The narrowness is not tidiness — the value is echoed into the LINE HEAD of
// another member's transcript, outside the untrusted-body framing, so a newline in it could
// close the rendered line and forge a fresh one.
// ⚠ A NEAR-MISS SENDS NOTHING. The server drops a malformed value silently, and a stamp that
// vanishes with no error is worse than one that was never claimed.
const SESSION_ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;

const HEADER = 'X-Dopl-Session-Id';

/**
 * The header for one slot key, or `{}` when there is nothing honest to say.
 *
 * ⚠ `{}` IS THE COMMON CASE AND IS NOT A FAILURE. A post about the MACHINE rather than about a
 * session (`queued-notice.js`) passes nothing, and attributing it to whichever session happened
 * to hold the slot would name an agent that is not its subject. UNKNOWN is not EMPTY and is not
 * a guess (INVARIANTS §11): the row renders "Agent", which is true.
 *
 * ⚠ THE ARGUMENT IS THE SLOT KEY (`session-store.js › sessionKey`,
 * `<channelId>:<taskId>:<agentId>`) and NEVER the per-launch `sessionId`. The AGENT segment is
 * the one every reader wants — `lib/agent-post-stamp.ts › agentIdOfSessionKey` reads it from the
 * END — and the ephemeral id carries none, so stamping that would produce a header the server
 * accepts and no reader can resolve.
 */
function sessionHeaders(slotKey) {
  return typeof slotKey === 'string' && SESSION_ID_RE.test(slotKey) ? { [HEADER]: slotKey } : {};
}

module.exports = { HEADER, SESSION_ID_RE, sessionHeaders };
