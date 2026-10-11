// `X-Dopl-Session-Id` — WHICH SESSION OF THIS OPERATOR'S A MAIN-PROCESS POST IS ABOUT.
//
// WHY: the posts this process writes ABOUT a session (the calm ended note, the windowless denial
// counter) arrived anonymous and rendered as a bare "Agent" (2026-09-15, docs/traces/
// AGENT-BADGE-TRACE.md). Their `client_msg_id`s cannot carry the post stamp, and the server
// re-stamps `metadata.session_id` from this HEADER alone. A spawned session's own posts already
// had it (`loader.js › withSessionStamp`); this gives main's posts about it the same.
//
// Shaped like `app-version.js`: a rule, a header name, and a `{}`-or-`{header}` helper the caller
// SPREADS, so an absent value is never sent as a blank header.
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
