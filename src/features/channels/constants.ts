/** Channels feature constants. */

import type { AgentToolProfile } from "./types";

/** Realtime tables watched by the web client (module-level, stable ref). */
export const CHANNEL_TABLES = [
  "channels",
  "channel_members",
  "channel_messages",
] as const;

/**
 * Watched separately from CHANNEL_TABLES so a consent/presence event refetches
 * only those views, not the whole channel list on every heartbeat, and so the
 * always-mounted sidebar can watch consent alone.
 * ⚠ Module-level stable refs — a fresh array per render resubscribes.
 */
export const CONSENT_TABLES = ["channel_consent_requests"] as const;
export const PRESENCE_TABLES = ["agent_presence"] as const;

/**
 * Consent-inbox liveness BACKSTOP, not the delivery path — realtime delivers
 * INSERT/UPDATE/DELETE (migration 20260727130000 set REPLICA IDENTITY FULL, so
 * the WAL record carries `operator_user_id` for the per-operator RLS policy).
 * The poll only earns its keep when the socket is broken, so 30s: worst case it
 * covers is a reconnect. 120 req/h from an idle focused tab, not 900 at 4s.
 *
 * ⚠ Passed ONLY by the channels-page inbox (`channels-view`). The
 * always-mounted sidebar badge stays realtime-only — an interval there is a
 * workspace-wide background poll on every page. TanStack's default
 * `refetchIntervalInBackground: false` pauses this while the tab is hidden.
 */
export const CONSENT_INBOX_POLL_MS = 30_000;

/**
 * Member count at which a channel stops behaving like a pair.
 *
 * `dopl-desktop-app/main/targeting.js` `classify` fires its implicit trigger
 * only on known-exact `memberCount === 2` + explicit membership. At 3+ an
 * UNADDRESSED ask triggers NOBODY — fail-closed by design (a broadcast trigger
 * turns the loop brake into a storm).
 *
 * ⚠ COPY threshold, not a gate — nothing here decides routing. Shared by the
 * composer's unaddressed hint and the invite dialog's group note so the copy
 * cannot drift from the desktop rule in one place and not the other.
 */
export const GROUP_CHANNEL_MIN_MEMBERS = 3;

/**
 * Agent counts as online when its last heartbeat is newer than this.
 * ⚠ In sync with the desktop heartbeat cadence (~30s) — three missed beats.
 */
export const PRESENCE_ONLINE_WINDOW_MS = 90_000;

/**
 * A thread is shown in the SIDEBAR TREE when it saw activity inside this window
 * (or is a standing request). Ruled by Samuel on 2026-08-18: threads never
 * close and never leave the Threads tab, so the sidebar needs a recency bound
 * of its own or it grows without limit.
 *
 * ⚠ CLIENT-SIDE ARITHMETIC over `ChannelThread.lastActivityAt`, exactly like
 * {@link PRESENCE_ONLINE_WINDOW_MS} over `lastSeenAt` — the repository read is a
 * plain bounded activity-ordered list and knows nothing about this window. A
 * server-side filter would need a second read for the Threads tab and the two
 * would answer "is this thread live" differently.
 *
 * ⚠ Stale data therefore reads INACTIVE, never active: the same fail-safe
 * direction presence has.
 */
export const SIDEBAR_THREAD_ACTIVE_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Trailing debounce on the presence-driven roster refetch. Listeners heartbeat
 * ~30s apiece, so a busy workspace drips realtime events; the freshness window
 * is 90s, so per-event refetching buys nothing. Coalesce the burst.
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

/**
 * Shown when a channel row carries NO tool profile. ⚠ Must match what the
 * desktop would actually RUN — this label is a containment claim, and "Full
 * access" over a session the desktop runs `read_only` is a fail-open lie.
 *
 * Sync target: `dopl-desktop-app/main/tool-profiles.js` `normalizeProfile`
 * resolves missing/unrecognized to `read_only`;
 * `targeting-window.resolveToolProfile` delegates to it.
 *
 * `channel_members.agent_tool_profile` is NOT NULL DEFAULT 'full', so null
 * means "this DTO does not know", never "no profile chosen".
 */
export const UNRESOLVED_TOOL_PROFILE: AgentToolProfile = "read_only";

/** Pending consent request TTL. ⚠ Must stay >= the desktop watcher's park
 *  window (24h) or a legitimately parked request is swept out from under it. */
export const CONSENT_TTL_MS = 24 * 60 * 60_000;

/**
 * F-060 (size-cap half): serialized byte cap on a post's free-form `metadata`.
 * Enforced in `ChannelMessageCreateSchema` as `JSON.stringify(metadata).length`
 * — the wire size the insert pays under the per-channel advisory lock.
 * F-060's RATE-LIMIT half (per-`(user, channel)` bucket → 429) is still OPEN.
 */
export const MAX_METADATA_SERIALIZED_BYTES = 16_384;

/**
 * Ceiling on one channel's thread list (`listTasksByChannel`). Threads never
 * leave the list, so this read needs a bound (INVARIANTS §9) — and a read
 * coming back AT the ceiling counts as CLIPPED, because at is indistinguishable
 * from over. The caller is told; nothing renders a clip as an exhausted list.
 *
 * 200 mirrors {@link MAX_MESSAGE_LIMIT} — the same order of magnitude as the
 * transcript page this list sits beside. ⚠ NOT derived from a production
 * measurement: nobody has counted threads-per-channel on the deployment, and
 * the number to check before moving this is
 * `SELECT channel_id, count(*) FROM channel_tasks GROUP BY 1 ORDER BY 2 DESC`.
 * (`20260807160000`'s header reports single-digit OPEN threads workspace-wide
 * as of 2026-08-07, which is a different question and an older one.)
 */
export const CHANNEL_THREAD_LIST_LIMIT = 200;

/** Default page size for a message read when `limit` is omitted. */
export const DEFAULT_MESSAGE_LIMIT = 100;

/** Hard cap on a message read page (contract: `limit <= 200`). */
export const MAX_MESSAGE_LIMIT = 200;

/** Await long-poll: hard cap on the client-requested timeout (ms). */
export const MAX_AWAIT_TIMEOUT_MS = 50_000;

/**
 * Await long-poll default when `timeoutMs` omitted. ⚠ Held at the 50s cap —
 * must stay under route maxDuration 60 and the client's 55s network timeout.
 */
export const DEFAULT_AWAIT_TIMEOUT_MS = 50_000;

/** Await long-poll: interval between DB polls (ms). */
export const AWAIT_POLL_INTERVAL_MS = 1_500;

/**
 * Await long-poll: background access recheck cadence, in poll ticks. Fires on
 * the first held tick then every Nth (1, 11, 21, …), NOT every tick — at 1.5s
 * that is ~15s bounded staleness on an IDLE hold. (The recheck was 2 of 3
 * queries per tick and ~99% of the bytes.)
 *
 * ⚠ THE INVARIANT (M2): NO FETCH OF MESSAGE ROWS MAY PRECEDE A PROOF OF ACCESS
 * WITHIN THE SAME TICK. The security property is enforced on the RETURN path,
 * not by this cadence. On a hit `awaitNewMessages` proves access before reading
 * rows, unless the periodic recheck already proved it that same tick — the
 * short-circuit removes a duplicate query, never an earlier one. So a member
 * revoked mid-hold is cut off on the very next message at any tick count.
 */
export const AWAIT_REVALIDATE_EVERY_TICKS = 10;
