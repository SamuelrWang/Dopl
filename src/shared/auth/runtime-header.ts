/**
 * `X-Dopl-Runtime` — which kind of agent process a request speaks for.
 *
 * WHY IT EXISTS (WAKE-V1): a channel message written by a DESKTOP-spawned
 * session and one written by the user's own external Claude Code session are
 * otherwise indistinguishable server-side, and the desktop uses that
 * distinction to decide whether to open a requester window for a thread. An
 * external session that already owns the exchange must NOT get a competing
 * window opened for it (it would steal the reply), so the server stamps the
 * origin onto the message as the reserved `metadata.runtime` key.
 *
 * The header is the ONLY input, and only its exact recognized value counts:
 * anything else (absent, blank, padded, a made-up label) reads as external and
 * stamps nothing. Caller-supplied `metadata.runtime` is always stripped —
 * `resolvePostMetadata` is the single stamping point, so the label cannot be
 * spoofed through the message body.
 *
 * Header-only, deliberately: this is a routing hint that fails safe (a missing
 * stamp costs a redundant window, never a delivery), NOT an authorization
 * signal. Nothing may gate access on it.
 */

export const RUNTIME_HEADER = "x-dopl-runtime";

/** A session spawned by the Dopl desktop app (the only recognized runtime). */
export const DESKTOP_SESSION_RUNTIME = "desktop-session";

export type DoplRuntime = typeof DESKTOP_SESSION_RUNTIME;

/**
 * The recognized runtime this request carries, or undefined. Exact match and
 * no case folding: the one sender is our own desktop build, so a near-miss is
 * a bug to notice rather than a value to rescue. (Surrounding whitespace never
 * reaches here — the Headers layer strips it off a field value first.)
 */
export function readRuntimeHeader(request: {
  headers: Headers;
}): DoplRuntime | undefined {
  return request.headers.get(RUNTIME_HEADER) === DESKTOP_SESSION_RUNTIME
    ? DESKTOP_SESSION_RUNTIME
    : undefined;
}
