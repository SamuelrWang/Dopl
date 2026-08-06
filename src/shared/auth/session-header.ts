/**
 * `X-Dopl-Session-Id` — which SESSION of an agent a request speaks for (F2).
 *
 * WHY IT EXISTS. The incident was two concurrent sessions of ONE agent handle:
 * `channel_agents` held one row per handle, `as_agent` was validated per CALL
 * against ownership alone, and a ROOM slot `(channel, agent)` and a PAIR slot
 * `(channel, thread)` were disjoint key spaces — so several live sessions of one
 * handle was the documented design. Two of them issued a peer contradictory
 * instructions 79 seconds apart, and nothing ON THE WIRE said which had spoken;
 * "flint said X" was not a well-formed statement.
 *
 * THE MECHANISM IS GONE AND THE HEADER IS NOT (channels rollback §1). `as_agent`
 * is a removed param, nothing writes `channel_agents`, and the room slot shape
 * survives inert. The header outlives them because the question generalized: a
 * peer's ACCOUNT is what authors an agent post, one operator runs many sessions
 * at once, and `metadata.session_id` is still the only field that says which
 * process wrote a line. It is what the transcript's session suffix renders
 * (`packages/mcp-server/src/tools/channel-render.ts`) and what makes a named
 * session pill answerable.
 *
 * A LABEL, NOT A LOCK, and that distinction is the whole design. Nothing
 * enforces one live session per agent id — that would break the legitimate
 * three-slot design and would do nothing for an external CLI session that passes
 * `as_agent` anyway. This only makes the sessions TELLABLE APART after the fact.
 *
 * The header is the ONLY input, exactly like `X-Dopl-Runtime` and
 * `X-Dopl-App-Version`: caller-supplied `metadata.session_id` is stripped in
 * `resolvePostMetadata` (the single stamping point), so the label cannot be
 * spoofed through the message body. Absent header → NO KEY AT ALL, which is what
 * every non-desktop poster looks like.
 *
 * A DIAGNOSTIC / ATTRIBUTION HINT, NEVER AN AUTHORIZATION SIGNAL — the same
 * framing as its two siblings. Any holder of a device token can send any value,
 * so it cannot attest which process actually ran; it labels what the sender says
 * it is. Nothing may gate access, capability, or trust on it. It fails safe in
 * both directions: an absent stamp costs a forensic, never a delivery, and a
 * lied-about stamp costs a misleading attribution line, never a permission.
 */

export const SESSION_ID_HEADER = "x-dopl-session-id";

/**
 * The desktop's slot key shape — `<channelId>:<agentId or threadId>`, where the
 * tail is empty for a team session with no thread — plus room for any other
 * client's opaque handle. Deliberately narrow for the same reason
 * `APP_VERSION_RE` is: this string is echoed back onto another member's screen
 * as part of a message line, so it is an id-shaped token or it is nothing. No
 * whitespace (a newline could forge a render line), no backticks, bounded at
 * 128 characters.
 */
const SESSION_ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;

/**
 * The recognized session id this request carries, or undefined. No trimming and
 * no coercion — a near-miss is a bug to notice rather than a value to rescue.
 * (Surrounding whitespace never reaches here: the Headers layer strips it off a
 * field value first.)
 */
export function readSessionIdHeader(request: {
  headers: Headers;
}): string | undefined {
  const raw = request.headers.get(SESSION_ID_HEADER);
  return raw && SESSION_ID_RE.test(raw) ? raw : undefined;
}

/**
 * Re-narrow a session id that has already crossed a layer boundary (the auth
 * context → the channel context). Same predicate, applied twice, so no other
 * construction path can widen what counts as one.
 */
export function narrowSessionId(
  value: string | null | undefined
): string | undefined {
  return typeof value === "string" && SESSION_ID_RE.test(value)
    ? value
    : undefined;
}
