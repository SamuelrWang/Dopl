/**
 * `X-Dopl-Runtime` — which kind of Dopl process a request speaks for.
 *
 * WHY IT EXISTS (WAKE-V1): a channel message written by a DESKTOP-spawned
 * session and one written by the user's own external Claude Code session are
 * otherwise indistinguishable server-side, and the desktop uses that
 * distinction to decide whether to open a requester window for a thread. An
 * external session that already owns the exchange must NOT get a competing
 * window opened for it (it would steal the reply), so the server stamps the
 * origin onto the message as the reserved `metadata.runtime` key.
 *
 * TWO RECOGNIZED VALUES (the second added 2026-08-05, rollback plan §3.4):
 *
 *   `desktop-session`  a session the desktop app SPAWNED. Its MCP entry carries
 *                      the header (`main/sdk-loader.js`, `main/mcp-config.js`)
 *                      on the operator's device token, so this value is
 *                      deliberately credential-agnostic — those posts arrive as
 *                      OAuth agent-token calls and always have.
 *   `desktop-ui`       the desktop app's OWN UI window: a PERSON typing in the
 *                      bundled SPA. Its posts leave main, not the renderer
 *                      (`main/ui-bridge.js` builds every header; the preload
 *                      exposes no header surface), on the operator's own
 *                      SESSION credential.
 *
 * Anything else — absent, blank, padded, a made-up label — reads as external
 * and stamps nothing. Caller-supplied `metadata.runtime` is always stripped:
 * `resolvePostMetadata` is the single stamping point, so the label cannot be
 * spoofed through the message body.
 *
 * THE HONESTY BOUND ON `desktop-ui`, and why it is different from its sibling.
 * A header is a header: the public API can be reached by anything holding a
 * credential, so no header can ATTEST who called. What the server CAN do is
 * refuse to stamp a claim the presented credential does not support, and that
 * is {@link narrowRuntime}: `desktop-ui` says "a person typed this in the app",
 * so it is refused outright for an AGENT credential (a `dopl_at_*` OAuth /
 * device token — every remote-MCP and external-Claude-Code caller). That is the
 * whole population the desktop's routing cares about telling apart, and it is
 * the reason an external MCP post can never acquire this stamp no matter what
 * header it sends. What is left inside the bound is a first-party SESSION
 * credential — the operator's own login — declaring its own surface. That is
 * as far as evidence goes, and the claim is written to be worth exactly that
 * much.
 *
 * Header-only, deliberately: this is a routing hint that fails safe (a missing
 * stamp costs a redundant window, never a delivery), NOT an authorization
 * signal. Nothing may gate access on it. What makes the desktop's routing safe
 * is the conjunct that DOES carry identity — the message is authored by me and
 * belongs to a thread I created — which no peer can forge; read alone, the
 * stamp decides nothing.
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
 * The recognized runtime this request's HEADER claims, or undefined. Exact
 * match and no case folding: the one sender is our own desktop build, so a
 * near-miss is a bug to notice rather than a value to rescue. (Surrounding
 * whitespace never reaches here — the Headers layer strips it off a field value
 * first.)
 *
 * THIS IS THE CLAIM, NOT THE VERDICT. It has no credential to judge against, so
 * it cannot apply the `desktop-ui` bound; every consumer that turns a claim into
 * a stamp runs it through {@link narrowRuntime} first. `/api/mcp` forwards this
 * value verbatim onto its loopback, which is safe precisely because the
 * loopback carries the caller's own agent token and the narrowing happens there.
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
 * What the server is willing to STAMP for this request: the recognized value,
 * bounded by the credential that presented it.
 *
 * `desktop-session` passes on the header alone — a desktop-spawned session
 * authenticates with the device's OAuth token, so requiring a session
 * credential here would refuse the exact caller the value was invented for.
 *
 * `desktop-ui` requires a NON-agent credential (`agentCredential: false`, i.e.
 * no `agentTokenId`: a Supabase cookie or the desktop main process's Supabase
 * JWT bearer). Every remote-MCP caller, every external Claude Code session and
 * every device-token script is an agent credential and is refused, which is the
 * property rollback-plan §3.4 leans on: an external MCP post cannot buy itself
 * the window the operator's own typing gets.
 *
 * FAIL CLOSED in both directions — an unrecognized value, and a recognized one
 * the credential does not support, both answer undefined (an unstamped post,
 * which opens nothing).
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
