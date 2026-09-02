/**
 * session-pin.ts — 🔒 THE SESSION DEFAULT WORKSPACE AN EXTERNAL CLIENT CAN SET,
 * and the one place it is stored.
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────
 *
 * `/api/mcp` is STATELESS (`sessionIdGenerator: undefined`) and `bootServer`
 * runs ONCE PER HTTP REQUEST, so there has never been anywhere for a "switch
 * workspace" to live: a caller with 2+ standard memberships and no
 * `X-Workspace-Id` header had to pass `workspace=` on EVERY call, forever.
 * Claude Code sends no such header, so every call from it was refused first and
 * retried second — the measured waste this module exists to delete.
 *
 * ── THE SHAPE, AND ITS THREE PROPERTIES ────────────────────────────────────
 *
 * 1. **PROCESS-LOCAL, KEYED ON THE CREDENTIAL.** The key is opaque and supplied
 *    by the transport ({@link BootOptions.sessionKey}); this module never reads
 *    it, renders it or compares it to anything but itself. There is no schema
 *    change and no new column: `mcp_tokens.workspace_id` is the container LOCK
 *    (INVARIANTS §4 step 1) and a soft DEFAULT stored beside a hard FENCE is
 *    exactly the two-mechanisms-drift trap that file warns about.
 *
 * 2. 🔒 **ITS FAILURE MODE IS THE ONLY ACCEPTABLE ONE — the same argument
 *    `tools/confirm-token.ts` makes for its own process-local store.** A pin
 *    written in one server process is UNKNOWN in another, and unknown means NO
 *    PIN, which means the caller gets the pre-existing `WORKSPACE_REQUIRED`
 *    refusal listing its workspaces. **A lost pin costs one repeated argument;
 *    it can never route a call into a workspace the caller did not name.**
 *    Never replace this with anything that fails the other way.
 *
 * 3. **IT IS A DEFAULT, NEVER A CAPABILITY.** Nothing here decides what a caller
 *    may reach. A pin is only ever consulted to pick among memberships the boot
 *    directory ALREADY proved, and a per-call `workspace=` still wins over it
 *    (`registrar.ts`). Under the container lock (B3) the only resolvable target
 *    is the container itself, so a locked session can pin nothing else.
 */

/**
 * How long a pin survives with no traffic.
 *
 * ⚠ THIRTY MINUTES IS AN ABUSE BOUND, NOT A SESSION LENGTH. Every read REFRESHES
 * it, so an active connection keeps its pin indefinitely and only an abandoned
 * one expires — which is what stops this map growing for the life of the
 * process. Expiring an ACTIVE session's pin would be the one behaviour a caller
 * cannot explain, since nothing on the wire would say the default had moved.
 */
export const SESSION_PIN_TTL_MS = 30 * 60_000;

/**
 * ⚠ A CEILING, so a hostile or looping caller cannot grow this map without
 * bound. Eviction is OLDEST-FIRST and its consequence is the ordinary one: the
 * evicted session's next call is refused with the workspace list, and it pins
 * again. Never evict by anything a caller controls.
 */
const MAX_PINS = 5_000;

interface Pin {
  workspaceId: string;
  /** Last read or write, ms. Drives both the TTL and the eviction order. */
  touchedAt: number;
}

const pins = new Map<string, Pin>();

/** Drop everything past the TTL. Runs on write only — a read that finds an
 *  expired entry deletes just that one, which is cheaper and just as correct. */
function sweep(now: number): void {
  for (const [key, pin] of pins) {
    if (now - pin.touchedAt >= SESSION_PIN_TTL_MS) pins.delete(key);
  }
}

/**
 * The workspace id this session pinned, or null.
 *
 * ⚠ A blank or absent key is NO PIN, never a shared bucket. A transport that
 * cannot identify its session must not inherit another session's default.
 */
export function readSessionPin(
  sessionKey: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!sessionKey) return null;
  const pin = pins.get(sessionKey);
  if (!pin) return null;
  if (now - pin.touchedAt >= SESSION_PIN_TTL_MS) {
    pins.delete(sessionKey);
    return null;
  }
  pin.touchedAt = now;
  return pin.workspaceId;
}

/**
 * Pin `workspaceId` for this session. Returns false when there is no session to
 * pin it to — ⚠ the caller must RENDER that refusal rather than reporting a
 * success, or an agent stops passing `workspace=` on the strength of a pin that
 * was never stored.
 *
 * ⚠ IT VALIDATES NOTHING. Resolution and the container lock are the CALLER's job
 * (`directory.resolveWorkspaceRef`), so this module holds no second opinion
 * about which workspaces exist.
 */
export function writeSessionPin(
  sessionKey: string | null | undefined,
  workspaceId: string,
  now: number = Date.now(),
): boolean {
  if (!sessionKey) return false;
  sweep(now);
  if (!pins.has(sessionKey) && pins.size >= MAX_PINS) {
    // Oldest touch first — `Map` preserves insertion order, not recency, so the
    // minimum is found rather than assumed.
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, pin] of pins) {
      if (pin.touchedAt < oldestAt) {
        oldestAt = pin.touchedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) pins.delete(oldestKey);
  }
  pins.set(sessionKey, { workspaceId, touchedAt: now });
  return true;
}

/** Forget this session's pin. Returns true when there was one to forget. */
export function clearSessionPin(
  sessionKey: string | null | undefined,
): boolean {
  if (!sessionKey) return false;
  return pins.delete(sessionKey);
}

/** Test seam — drops every pin. ⚠ Nothing in the server calls it. */
export function resetSessionPinsForTest(): void {
  pins.clear();
}
