import type { SessionDetailKey } from "@/features/channels/types-sessions";

/**
 * THE SIX CLOSED SITUATION KEYS `channel_sessions.detail` MAY CARRY, narrowed
 * once for both Overviews (wave 8).
 *
 * 🔒 `detail` is the ONE peer-visible telemetry column, and it is peer-visible
 * only because this vocabulary is CLOSED. The DB deliberately does not `CHECK`
 * it — a newer desktop shipping a seventh key must be able to STORE it rather
 * than 400 its whole push — so the closed-value test belongs on the read side.
 *
 * ⚠ `channels/server/collab-dto.ts › narrowSessionDetail` is the channels
 * feature's own copy and stays there: §2 forbids reaching into another
 * feature's `server/`, and `src/features/channels/**` is do-not-touch.
 */
const SESSION_DETAILS: readonly SessionDetailKey[] = [
  "thinking",
  "tool",
  "posting",
  "permission",
  "awaiting_peer",
  "awaiting_inbound",
];

/** An unrecognised key answers `null` — the surfaces then draw the plain state
 *  rather than printing a raw token. */
export function narrowSessionDetail(raw: string | null): string | null {
  return raw !== null && SESSION_DETAILS.includes(raw as SessionDetailKey)
    ? raw
    : null;
}
