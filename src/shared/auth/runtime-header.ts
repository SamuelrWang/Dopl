/**
 * `X-Dopl-Runtime` — which kind of Dopl process a request speaks for. Stamped
 * server-side as the reserved `metadata.runtime` key; the desktop uses it to
 * decide whether to open a requester window for a thread.
 *
 * Two recognized values:
 *   `desktop-session`  a session the desktop app SPAWNED. Deliberately
 *                      CREDENTIAL-AGNOSTIC — those posts arrive on the
 *                      operator's device token, i.e. as agent-token calls.
 *   `desktop-ui`       the desktop app's own UI window (a person typing).
 *                      Posts leave main, not the renderer, on a SESSION
 *                      credential.
 *
 * Anything else reads as external and stamps nothing. ⚠ Caller-supplied
 * `metadata.runtime` is always stripped — `resolvePostMetadata` is the single
 * stamping point, so the label cannot be spoofed through the message body.
 *
 * ⚠ The credential bound applies to `desktop-ui` ONLY (see {@link narrowRuntime});
 * `desktop-session` is reachable by any `dopl_at_*` holder, and
 * `targeting.requesterTaskOpen` accepts EITHER stamp. The real boundary is TOKEN
 * CUSTODY plus the identity pair (authored by me AND thread created by me), not
 * this header — F-145.
 *
 * ⚠ Routing hint, NEVER an authorization signal. Nothing may gate access on it.
 * A missing stamp costs a redundant window, never a delivery.
 */

export const RUNTIME_HEADER = "x-dopl-runtime";

/** A session spawned by the Dopl desktop app. */
export const DESKTOP_SESSION_RUNTIME = "desktop-session";

/** The Dopl desktop app's own UI window — the operator typing, not an agent. */
export const DESKTOP_UI_RUNTIME = "desktop-ui";

export type DoplRuntime =
  | typeof DESKTOP_SESSION_RUNTIME
  | typeof DESKTOP_UI_RUNTIME;

const RECOGNIZED: readonly string[] = [
  DESKTOP_SESSION_RUNTIME,
  DESKTOP_UI_RUNTIME,
];

/**
 * The recognized runtime this request's HEADER claims, or undefined. ⚠ Exact
 * match, no case folding — the only sender is our own desktop build, so a
 * near-miss is a bug to notice, not a value to rescue.
 *
 * ⚠ THE CLAIM, NOT THE VERDICT: no credential to judge against, so it cannot
 * apply the `desktop-ui` bound. Every consumer turning a claim into a stamp runs
 * {@link narrowRuntime} first. `/api/mcp` forwards this verbatim onto its
 * loopback, safe because the loopback carries the caller's own agent token and
 * narrows there.
 */
export function readRuntimeHeader(request: {
  headers: Headers;
}): DoplRuntime | undefined {
  const value = request.headers.get(RUNTIME_HEADER);
  return value && RECOGNIZED.includes(value)
    ? (value as DoplRuntime)
    : undefined;
}

/**
 * What the server will STAMP: the recognized value, bounded by the presenting
 * credential.
 *
 * `desktop-session` passes on the header alone — a desktop-spawned session
 * authenticates with the device's OAuth token, so requiring a session credential
 * would refuse the caller the value exists for.
 *
 * `desktop-ui` requires a NON-agent credential (no `agentTokenId`: a Supabase
 * cookie or the desktop main process's JWT bearer). Every remote-MCP caller,
 * external Claude Code session and device-token script is refused.
 *
 * ⚠ FAIL CLOSED both ways — unrecognized value, or a recognized one the
 * credential doesn't support, both answer undefined (unstamped, opens nothing).
 */
export function narrowRuntime(
  value: string | null | undefined,
  opts: { agentCredential: boolean }
): DoplRuntime | undefined {
  if (value === DESKTOP_SESSION_RUNTIME) return DESKTOP_SESSION_RUNTIME;
  if (value === DESKTOP_UI_RUNTIME && !opts.agentCredential) {
    return DESKTOP_UI_RUNTIME;
  }
  return undefined;
}
