/** Channels feature constants. */

import type { AgentToolProfile } from "./types";

/** Realtime tables watched by the web client (module-level, stable ref). */
export const CHANNEL_TABLES = [
  "channels",
  "channel_members",
  "channel_messages",
] as const;

/**
 * Collaboration tables (v1.2) watched separately from CHANNEL_TABLES so a
 * consent / presence event refetches the consent inbox + presence-derived
 * views without re-pulling the whole channel list on every heartbeat, and
 * so the always-mounted sidebar can watch just consent. Module-level stable
 * refs (a fresh array per render would resubscribe).
 */
export const CONSENT_TABLES = ["channel_consent_requests"] as const;
export const PRESENCE_TABLES = ["agent_presence"] as const;

/**
 * A member's agent is "online / listening" when its last heartbeat is newer
 * than this window. Kept in sync with the desktop heartbeat cadence (~30s) —
 * three missed beats mark it offline.
 */
export const PRESENCE_ONLINE_WINDOW_MS = 90_000;

/**
 * Trailing debounce applied to the presence-driven roster refetch. Every
 * listener heartbeats every ~30s, so a busy workspace emits a steady drip of
 * realtime events; the freshness window above is 90s, so refetching on each
 * one buys nothing. Coalesce a burst into a single refetch.
 */
export const PRESENCE_REFETCH_DEBOUNCE_MS = 10_000;

/**
 * Human labels for the per-channel agent tool scope. Shared by the settings
 * popover (where it is chosen) and the consent card (where the operator needs
 * to know what "Allow" will run with).
 */
export const AGENT_TOOL_PROFILE_LABELS: Record<AgentToolProfile, string> = {
  full: "Full access",
  dopl_only: "Dopl only",
  read_only: "Read only",
};

/** Pending consent requests expire this long after creation. */
export const CONSENT_TTL_MS = 30 * 60_000;

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
