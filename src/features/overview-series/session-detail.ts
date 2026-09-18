import type { SessionDetailKey } from "@/features/channels/types-sessions";

/**
 * The six closed situation keys `channel_sessions.detail` may carry, narrowed
 * once for both Overviews.
 *
 * `detail` is the one peer-visible telemetry column, and it is peer-visible only
 * because this vocabulary is closed. The DB deliberately does not `CHECK` it — a
 * newer desktop shipping a seventh key must be able to STORE it rather than 400
 * its whole push — so the closed-value test belongs on the read side.
 *
 * `channels/server/collab-dto.ts › narrowSessionDetail` is the channels feature's
 * own copy and stays there (§2 forbids reaching into another feature's `server/`).
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
