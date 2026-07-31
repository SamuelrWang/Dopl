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
 * Liveness fallback for the consent inbox. `channel_consent_requests` INSERTs
 * are not reliably delivered by Supabase Realtime (its RLS-on-the-WAL-record
 * evaluation of the per-operator `operator_user_id = auth.uid()` policy is a
 * known gotcha — a row is SELECT-able on reload yet its INSERT never reaches the
 * postgres_changes stream), so a pending request could sit invisible until the
 * operator reloaded. This poll guarantees it surfaces within a few seconds.
 *
 * Scoped deliberately: only the CHANNELS PAGE inbox (`channels-view`) passes it,
 * so the fast poll lives with the panel that renders the requests. The
 * always-mounted sidebar badge stays realtime-only (no interval) so we don't add
 * a workspace-wide background poll on every page. TanStack's default
 * `refetchIntervalInBackground: false` also pauses this poll while the tab is
 * hidden, so a backgrounded channels tab stops polling on its own.
 */
export const CONSENT_INBOX_POLL_MS = 4_000;

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

/** Pending consent requests expire this long after creation. Requests are now a
 *  durable "parked" item the operator answers whenever (Round B pending-requests
 *  model), so this must be long enough that a legitimately-parked request is not
 *  swept out from under the desktop watcher (which parks up to 24h). */
export const CONSENT_TTL_MS = 24 * 60 * 60_000;

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

/**
 * Await long-poll: how often the BACKGROUND access recheck runs, counted in
 * poll ticks. It fires on the first held tick and then every Nth after it
 * (ticks 1, 11, 21, …), NOT on every tick — at 1.5s that is a bounded
 * staleness of ~15s for a revocation that lands while the hold sits idle
 * (Q8 egress diet: the recheck was 2 of the 3 queries per tick and ~99% of
 * the bytes).
 *
 * The staleness is bounded for the IDLE hold only. The security property is
 * "no message is delivered to someone who lost access", and that is enforced
 * on the RETURN path, not by the cadence.
 *
 * THE INVARIANT, STATED EXACTLY (M2 — the older wording said "ALWAYS
 * revalidates", which the code does not literally do and never has): NO FETCH
 * OF MESSAGE ROWS MAY PRECEDE A PROOF OF ACCESS WITHIN THE SAME TICK. On a
 * hit, `awaitNewMessages` proves access before reading rows — unless the
 * periodic recheck ALREADY proved it during that same tick, in which case the
 * proof is younger than the existence probe that found the message and a
 * second identical query would tell us nothing new. Both paths satisfy the
 * invariant; the short-circuit only removes a duplicate query, never an
 * earlier one. A member revoked mid-hold is therefore cut off on the very next
 * message whatever the tick count, and at worst ~15s later on an idle hold.
 */
export const AWAIT_REVALIDATE_EVERY_TICKS = 10;
