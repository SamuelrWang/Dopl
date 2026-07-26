/** Channels feature constants. */

/** Realtime tables watched by the web client (module-level, stable ref). */
export const CHANNEL_TABLES = [
  "channels",
  "channel_members",
  "channel_messages",
] as const;

/** Default page size for a message read when `limit` is omitted. */
export const DEFAULT_MESSAGE_LIMIT = 100;

/** Hard cap on a message read page (contract: `limit <= 200`). */
export const MAX_MESSAGE_LIMIT = 200;

/** Await long-poll: hard cap on the client-requested timeout (ms). */
export const MAX_AWAIT_TIMEOUT_MS = 50_000;

/**
 * Await long-poll: default timeout when the caller omits `timeoutMs` (ms).
 * Held at the 50s cap so an omitted-timeout listener still gets a full
 * long-poll window (well under route maxDuration 60 and the client's 55s
 * network timeout).
 */
export const DEFAULT_AWAIT_TIMEOUT_MS = 50_000;

/** Await long-poll: interval between DB polls (ms). */
export const AWAIT_POLL_INTERVAL_MS = 1_500;
