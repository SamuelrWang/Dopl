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
 *
 * ⚠ CUSTODY, NOT VENDOR (2026-08-31, runtime-adapter port step 1). This header
 * answers "which kind of Dopl process spawned this", and a Dopl-driven Codex or
 * Cursor session is still a session the desktop app spawned. Widening this enum
 * with vendor words would flip every `=== DESKTOP_SESSION_RUNTIME` comparison
 * false for those sessions — `packages/mcp-server/src/tools/identity.ts ›
 * runtimeWord`, `packages/mcp-server/src/tools/channel-wake-guidance.ts`, and
 * `dopl-desktop-app/main/targeting.js › DESKTOP_RUNTIMES` all read it that way —
 * so the vendor is a SECOND DIMENSION on the same header set
 * ({@link VENDOR_HEADER}) and this enum never grows a vendor word.
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

/**
 * `X-Dopl-Vendor` — WHICH AGENT RUNTIME is driving the session the stamp above
 * says we spawned. The SECOND DIMENSION, added 2026-08-31 for the runtime-adapter
 * port, and deliberately not a widening of {@link RUNTIME_HEADER}.
 *
 * Custody and vendor are different facts and they are read by different code.
 * Custody ("the desktop spawned this") decides whether a requester window opens
 * and whether the desktop's own posts are its own; vendor ("this session is
 * Codex") decides what the MCP surface may TEACH — a tool-search verb, a
 * `mcp__<server>__` prefix, an await that only wakes on a client that
 * backgrounds. Every existing consumer of the custody stamp keeps its exact
 * meaning for a non-Claude session because the custody value is unchanged.
 *
 * ⚠ Same rules as the runtime stamp, for the same reasons: caller-supplied and
 * therefore a ROUTING HINT that grants nothing, recognized values only,
 * unrecognized reads as absent. An absent vendor is `undefined`, NEVER a guessed
 * `claude` — an older desktop build sends no vendor at all, and inferring one
 * from the custody stamp is exactly the conflation this dimension exists to
 * prevent.
 */
export const VENDOR_HEADER = "x-dopl-vendor";

/** The Claude Agent SDK runtime — every desktop session before 2026-08-31. */
export const CLAUDE_VENDOR = "claude";
/** OpenAI's Codex (`codex app-server`). */
export const CODEX_VENDOR = "codex";
/** Anysphere's Cursor agent. */
export const CURSOR_VENDOR = "cursor";

export type DoplVendor =
  | typeof CLAUDE_VENDOR
  | typeof CODEX_VENDOR
  | typeof CURSOR_VENDOR;

const RECOGNIZED_VENDORS: readonly string[] = [
  CLAUDE_VENDOR,
  CODEX_VENDOR,
  CURSOR_VENDOR,
];

/**
 * The recognized vendor this request's HEADER claims, or undefined. ⚠ Exact
 * match, no case folding, and no default — same discipline as
 * {@link readRuntimeHeader}, and an unrecognized value reads as absent so a new
 * vendor word on an older server is "unknown", never a mis-attribution.
 */
export function readVendorHeader(request: {
  headers: Headers;
}): DoplVendor | undefined {
  const value = request.headers.get(VENDOR_HEADER);
  return value && RECOGNIZED_VENDORS.includes(value)
    ? (value as DoplVendor)
    : undefined;
}

/**
 * What the server will carry as the caller's vendor.
 *
 * ⚠ NO CREDENTIAL BOUND, unlike {@link narrowRuntime}'s `desktop-ui` half, and
 * that is not an oversight: nothing is granted on the vendor, so there is no
 * privilege for a bound to protect. It exists as a function anyway so every
 * consumer coerces through one place and an unrecognized word can never reach a
 * branch.
 */
export function narrowVendor(
  value: string | null | undefined
): DoplVendor | undefined {
  return value && RECOGNIZED_VENDORS.includes(value)
    ? (value as DoplVendor)
    : undefined;
}
