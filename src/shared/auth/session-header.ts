/**
 * `X-Dopl-Session-Id` — which SESSION of an agent a request speaks for.
 *
 * One operator runs many concurrent sessions and a peer's ACCOUNT is what
 * authors an agent post, so `metadata.session_id` is the only field saying which
 * process wrote a line. Rendered as the transcript's session suffix
 * (`packages/mcp-server/src/tools/channel-render.ts`).
 *
 * ⚠ A LABEL, NOT A LOCK. Nothing enforces one live session per agent id; this
 * only makes sessions TELLABLE APART after the fact.
 *
 * ⚠ The header is the ONLY input: caller-supplied `metadata.session_id` is
 * stripped in `resolvePostMetadata` (the single stamping point). Absent header →
 * NO KEY AT ALL, which is what every non-desktop poster looks like.
 *
 * ⚠ ATTRIBUTION HINT, NEVER AN AUTHORIZATION SIGNAL (same framing as its two
 * siblings). Any device-token holder can send any value. Nothing may gate
 * access, capability, or trust on it.
 */

export const SESSION_ID_HEADER = "x-dopl-session-id";

/**
 * Desktop slot key shape `<channelId>:<agentId or threadId>` (empty tail for a
 * team session with no thread), plus room for other clients' opaque handles.
 * ⚠ Narrow on purpose — echoed onto another member's screen inside a message
 * line: no whitespace (a newline could forge a render line), no backticks,
 * bounded at 128 chars.
 */
const SESSION_ID_RE = /^[A-Za-z0-9:._-]{1,128}$/;

/** Recognized session id, or undefined. ⚠ No trimming, no coercion — a near-miss
 *  is a bug to notice. */
export function readSessionIdHeader(request: {
  headers: Headers;
}): string | undefined {
  const raw = request.headers.get(SESSION_ID_HEADER);
  return raw && SESSION_ID_RE.test(raw) ? raw : undefined;
}

/** Re-narrow a session id that crossed a layer boundary (auth ctx → channel
 *  ctx). ⚠ Same predicate applied twice, so no other path can widen it. */
export function narrowSessionId(
  value: string | null | undefined
): string | undefined {
  return typeof value === "string" && SESSION_ID_RE.test(value)
    ? value
    : undefined;
}
