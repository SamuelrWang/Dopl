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
 * Liveness fallback for the consent inbox — a BACKSTOP, not the delivery path.
 *
 * Q11 — this was 4s, which is 900 requests an hour from one idle focused tab,
 * and the comment justifying that number rested on a diagnosis the repo had
 * already corrected. It claimed `channel_consent_requests` INSERTs "are not
 * reliably delivered by Supabase Realtime". They are. The undelivered events
 * were UPDATEs and DELETEs, because the default REPLICA IDENTITY (primary key
 * only) leaves the WAL record without the `operator_user_id` column that the
 * per-operator RLS policy needs to authorize delivery — an INSERT record has
 * always carried every column. Migration 20260727130000 says exactly this
 * ("INSERT already carries all columns; this is chiefly for live delivery of the
 * UPDATE … and DELETE paths") and set REPLICA IDENTITY FULL, which fixed the
 * other two. So the case the poll was tuned for — a pending request appearing
 * and sitting invisible — is the case realtime handles, and has since July 27.
 *
 * 30s, and the poll STAYS: realtime has dropped on this project before, the
 * failure mode is an operator's approval sitting unseen while an agent waits on
 * it, and a backstop that only fires when the socket is already broken should be
 * priced for that. At 30s an idle focused tab makes 120 requests an hour instead
 * of 900, and the worst-case latency it has to cover is a socket outage, where
 * 30s is a rounding error against the reconnect. Anything faster is paying a
 * per-request cost 7 times over for a path that normally delivers in under a
 * second.
 *
 * Scoped deliberately: only the CHANNELS PAGE inbox (`channels-view`) passes it,
 * so the poll lives with the panel that renders the requests. The always-mounted
 * sidebar badge stays realtime-only (no interval) so we don't add a
 * workspace-wide background poll on every page. TanStack's default
 * `refetchIntervalInBackground: false` also pauses this poll while the tab is
 * hidden, so a backgrounded channels tab stops polling on its own.
 */
export const CONSENT_INBOX_POLL_MS = 30_000;

/**
 * The member count at which a channel stops behaving like a pair, and the ONE
 * number the N-party copy is allowed to restate.
 *
 * Below it, an unaddressed message still has an implicit recipient: the desktop
 * listener's `classify` fires its implicit trigger only on a known-exact
 * `memberCount === 2` plus explicit membership (`dopl-desktop-app/main/targeting.js`).
 * At three or more there is no implicit recipient, so an UNADDRESSED ask
 * triggers NOBODY at all — it is delivered to the transcript and picked up by
 * no agent. That is fail-closed BY DESIGN (a broadcast trigger would turn the
 * loop brake into a storm) and it is exactly the fact the product used to keep
 * to itself.
 *
 * Shared by the two surfaces that state it — the composer's unaddressed hint
 * and the invite dialog's group-channel note — so the copy and the desktop rule
 * cannot drift apart in one place and not the other. It is a COPY threshold,
 * not a gate: nothing here decides whether a message routes.
 */
export const GROUP_CHANNEL_MIN_MEMBERS = 3;

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

/**
 * What the UI shows when a channel row carries NO tool profile — and it must be
 * whatever the desktop would actually RUN, because this label is a claim about
 * containment, not a placeholder.
 *
 * `dopl-desktop-app/main/tool-profiles.js` `normalizeProfile` resolves a missing
 * or unrecognized profile to `read_only` and reports the degradation (C-11,
 * 2026-08-08); `targeting-window.resolveToolProfile` delegates to it, so there is
 * exactly ONE answer on that side. This constant is the web's half of that single
 * answer. It was `"full"` in two places, which is the same fail-OPEN the desktop
 * just removed — and worse here, because a label reading "Full access" over a
 * session the desktop is about to run `read_only` is a lie in the direction that
 * makes the operator relax.
 *
 * A member's `channel_members.agent_tool_profile` is `NOT NULL DEFAULT 'full'`, so
 * null means "this DTO does not know", never "no profile was chosen".
 */
export const UNRESOLVED_TOOL_PROFILE: AgentToolProfile = "read_only";

/** Pending consent requests expire this long after creation. Requests are now a
 *  durable "parked" item the operator answers whenever (Round B pending-requests
 *  model), so this must be long enough that a legitimately-parked request is not
 *  swept out from under the desktop watcher (which parks up to 24h). */
export const CONSENT_TTL_MS = 24 * 60 * 60_000;

/**
 * F-060 (size-cap half): serialized byte cap on a post's free-form `metadata`
 * blob — the one caller-supplied post field that had NO bound (`body`/`summary`
 * are length-capped). Enforced in `ChannelMessageCreateSchema` as
 * `JSON.stringify(metadata).length`, the wire size the insert pays under the
 * per-channel advisory lock. The RATE-LIMIT half of F-060 (a per-`(user,
 * channel)` token bucket surfaced as 429) is deliberately still OPEN — it needs
 * tuning judgement and is deferred.
 */
export const MAX_METADATA_SERIALIZED_BYTES = 16_384;

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
