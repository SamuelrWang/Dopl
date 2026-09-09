/** Channels feature constants. */

import type { AgentToolProfile, ThreadMode } from "./types";

/** Realtime tables watched by the web client (module-level, stable ref). */
export const CHANNEL_TABLES = [
  "channels",
  "channel_members",
  "channel_messages",
] as const;

/**
 * Watched separately from CHANNEL_TABLES so a consent/presence event refetches only
 * those views, not the whole channel list on every heartbeat, and so the sidebar can
 * watch consent alone. ⚠ Module-level stable refs — a fresh array per render
 * resubscribes.
 */
export const CONSENT_TABLES = ["channel_consent_requests"] as const;
export const PRESENCE_TABLES = ["agent_presence"] as const;

/**
 * Consent-inbox liveness BACKSTOP, not the delivery path — realtime delivers the row
 * changes (migration 20260727130000 set REPLICA IDENTITY FULL so the WAL record
 * carries `operator_user_id` for the per-operator RLS policy). 30s is 120 req/h from
 * an idle focused tab, not 900 at 4s.
 *
 * ⚠ Passed only by the surfaces that RENDER a pending draft
 * (`components/channels-v2/channel-surface-data.ts`, `.../agent-window.tsx`) — an
 * interval belongs to a surface that can act on the rows. The always-mounted nav
 * badge this rule once exempted is DELETED (Samuel, 2026-08-25 — INVARIANTS §6).
 */
export const CONSENT_INBOX_POLL_MS = 30_000;

/**
 * Member count at which a channel stops behaving like a pair. ⚠ COPY threshold, not
 * a gate: `dopl-desktop-app/main/targeting.js › classify`'s implicit
 * `memberCount === 2` trigger went on 2026-08-18 (wiring plan Phase 3) with the
 * server-side DM auto-address, so **an UNADDRESSED ask now triggers NOBODY at every
 * size** — fail-closed by design (never add a broadcast trigger).
 *
 * ⚠ **ONE READER LEFT, AND IT IS IN THE OTHER TREE:** the deliberate duplicate
 * `packages/mcp-server/src/tools/channel-addressing.ts › GROUP_CHANNEL_MIN_MEMBERS`
 * picks whether the ROSTER LINE names a count or says "the other member", pinned to
 * this number by `channel-addressing-rule.test.ts`.
 * `components/invite-dialog.tsx › GroupChannelRoutingNote` stopped reading it on
 * 2026-08-18 (wave-2 fix pass) — it recited the rule Phase 3 retired.
 */
export const GROUP_CHANNEL_MIN_MEMBERS = 3;

/**
 * Agent counts as online when its last heartbeat is newer than this AND its stored
 * `status` is not the literal `'away'` (`server/repository-collab.ts ›
 * derivePresence`).
 *
 * ⚠ **120s — FOUR BEATS, RAISED FROM 90s (THREE) ON 2026-09-08, AND THE REASON IS
 * THE FOURTH BEAT AND NOTHING ELSE.** The heartbeat is 30s ±3s jitter
 * (`main/presence-core.js`), so at 90s three unlucky beats put a wide-awake machine
 * offline — the flicker Samuel reported (*"sometimes i see myself go offline, even
 * though my computer is on and dopl is open"*).
 *
 * ⚠ **DO NOT TUNE THIS TO PAPER OVER A HEARTBEAT BUG.** It was widened once, in the
 * change that removed the cause (one user-scoped POST per tick, abort-not-skip).
 *
 * ⚠ ALSO `agents-model.ts › peerRowStale`'s window — one number, so the roster
 * cannot call a member offline while their session card reads live (§11).
 */
export const PRESENCE_ONLINE_WINDOW_MS = 120_000;

/**
 * A thread shows in the SIDEBAR TREE when it saw activity inside this window (or is
 * a standing request). Samuel, 2026-08-18: threads never close and never leave the
 * Threads tab, so the sidebar needs a recency bound or it grows without limit.
 *
 * ⚠ CLIENT-SIDE ARITHMETIC over `ChannelThread.lastActivityAt`, like
 * {@link PRESENCE_ONLINE_WINDOW_MS} over `lastSeenAt` — a server-side filter would
 * need a second read for the Threads tab and the two would answer "is this thread
 * live" differently. Stale data therefore reads INACTIVE, never active.
 */
export const SIDEBAR_THREAD_ACTIVE_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Trailing debounce on the presence-driven roster refetch: listeners heartbeat ~30s
 * apiece and the freshness window is {@link PRESENCE_ONLINE_WINDOW_MS}, so coalesce
 * the burst. ⚠ **A DEBOUNCE IS NOT A BACKSTOP** — it fires only when an event
 * ARRIVES, so a dropped frame leaves the roster frozen on the SERVER's `online` flag
 * (since 2026-09-08). {@link PRESENCE_ROSTER_BACKSTOP_MS} is the other half.
 */
export const PRESENCE_REFETCH_DEBOUNCE_MS = 10_000;

/**
 * How a thread is worked, as a word (`types.ts › ThreadMode`).
 *
 * ⚠ ONE MAP, TWO SURFACES (2026-08-21): `channels-v2/thread-info-tab.tsx` DISPLAYS
 * the mode and the thread Settings tab CHOOSES it, and a second copy of the labels
 * is how the read-out and the control come to word one value differently.
 * ⚠ NO DESCRIPTIONS BESIDE THEM — a name plus a control (INVARIANTS §5, the
 * minimal-copy ruling).
 */
export const THREAD_MODE_LABELS: Record<ThreadMode, string> = {
  interactive: "Interactive",
  autonomous: "Autonomous",
};

/**
 * Human labels for the per-channel agent tool scope.
 *
 * ⚠ ONE CONSUMER TODAY, and this docblock claimed two until 2026-08-21:
 * `channels-v2/settings-agent.tsx` (re-measure: `grep -rn
 * AGENT_TOOL_PROFILE_LABELS src`). The second was the consent card, and both halves
 * of that claim had expired — `components/consent-card.tsx` is DELETED (INVARIANTS
 * §6) and no surface has said "Allow" since the affirmative became **Launch agent**.
 */
export const AGENT_TOOL_PROFILE_LABELS: Record<AgentToolProfile, string> = {
  full: "Full access",
  dopl_only: "Dopl only",
  read_only: "Read only",
};

/**
 * Shown when a channel row carries NO tool profile. ⚠ Must match what the desktop
 * would actually RUN — the label is a containment claim, and "Full access" over a
 * session the desktop runs `read_only` is a fail-open lie. Sync target:
 * `dopl-desktop-app/main/tool-profiles.js` `normalizeProfile` (missing/unrecognized →
 * `read_only`). The column is NOT NULL DEFAULT 'full', so null means "this DTO does
 * not know", never "no profile chosen".
 */
export const UNRESOLVED_TOOL_PROFILE: AgentToolProfile = "read_only";

/** Pending consent request TTL. ⚠ Must stay >= the desktop watcher's park
 *  window (24h) or a legitimately parked request is swept out from under it. */
export const CONSENT_TTL_MS = 24 * 60 * 60_000;

/**
 * F-060 (size-cap half): serialized byte cap on a post's free-form `metadata`,
 * enforced in `ChannelMessageCreateSchema` as `JSON.stringify(metadata).length` — the
 * wire size the insert pays under the per-channel advisory lock. F-060's RATE-LIMIT
 * half (per-`(user, channel)` bucket → 429) is still OPEN.
 */
export const MAX_METADATA_SERIALIZED_BYTES = 16_384;

/**
 * Ceiling on one channel's thread list (`listTasksByChannel`). Threads never leave
 * the list, so the read needs a bound (INVARIANTS §9), and AT the ceiling counts as
 * CLIPPED. 200 mirrors {@link MAX_MESSAGE_LIMIT}; ⚠ NOT from a production
 * measurement — check
 * `SELECT channel_id, count(*) FROM channel_tasks GROUP BY 1 ORDER BY 2 DESC` first.
 */
export const CHANNEL_THREAD_LIST_LIMIT = 200;

/**
 * Ceiling on ONE channel's mentions-of-me page (`service-mentions.ts ›
 * listMyChannelMentions`). Mentions never leave the inbox — it is a record, not a
 * to-do pile — so the read needs a bound (INVARIANTS §9) and AT the ceiling counts as
 * CLIPPED. ⚠ Deliberately a QUARTER of {@link MAX_MESSAGE_LIMIT}: this is a 380px
 * accordion nobody pages through.
 */
export const CHANNEL_MENTION_LIST_LIMIT = 50;

/**
 * Character cap on a mention row's `snippet`. ⚠ Clipped SERVER-SIDE, not by a
 * `line-clamp`: shipping a 16k body per row to draw two lines of it is the read
 * paying for the whole message N times (INVARIANTS §9 — heavy fields belong to the
 * detail path, here the transcript itself).
 */
export const MENTION_SNIPPET_MAX_CHARS = 240;

/**
 * Hard cap on how many mentions ONE mark-read call may name. ⚠ It is the page
 * ceiling, and that is the point: "Mark all read" sends the ids the client is
 * DISPLAYING, so a larger request is a caller that built the list some other way.
 */
export const CHANNEL_MENTION_MARK_MAX = CHANNEL_MENTION_LIST_LIMIT;

/**
 * Hard cap on the addressees of ONE request fan-out
 * (`server/service-tasks-broadcast.ts › createTaskFanOut`).
 *
 * ⚠ A BOUND ON WORK, not a product rule: the fan-out is N sequential `createTask`
 * calls through the channel's advisory lock, so an unbounded roster turns one Send
 * into an unbounded request — and it bites with a 400 rather than a timeout.
 * **Nothing about "how many agents may be addressed" is decided here**
 * ({@link GROUP_CHANNEL_MIN_MEMBERS} is the copy threshold, not a gate).
 */
export const CHANNEL_FANOUT_MAX_ADDRESSEES = 25;

/** Default page size for a message read when `limit` is omitted. */
export const DEFAULT_MESSAGE_LIMIT = 100;

/** Hard cap on a message read page (contract: `limit <= 200`). */
export const MAX_MESSAGE_LIMIT = 200;

/**
 * ONE PAGE OF TRANSCRIPT, MEASURED IN ESTIMATED RENDERED LINES — what the channel
 * surface asks for on open and what each scroll-up page adds
 * (`hooks/use-channel-messages.ts`).
 *
 * ⚠ **IT REPLACED `CHANNEL_TRANSCRIPT_PAGE_SIZE` (50 ROWS) ON 2026-09-08** (Samuel:
 * *"chunks shouldnt be by messages. Because a message can be like 20 lines or it can
 * be 2 lines. So we should chunk by lines instead … lets do 300 as the line
 * chunk."*). There is NO alias, so a caller still paging by rows is a compile error.
 *
 * ⚠ **AN ESTIMATE, AND ONLY FOR PAGING** — the formula is in
 * `lib/transcript-line-budget.ts › estimateMessageLines`; nothing may lay anything
 * out from it.
 *
 * ⚠ **A SMALLER FIRST PAGE IS A SMALLER DERIVATION WINDOW, AND THAT IS THE TRADE.**
 * Thread and escalation cards and the outbound send-box join are derived from the
 * messages ON SCREEN (`components/channels-v2/channel-surface-data.ts`), so a thread
 * older than this page has no card until the reader pages back; "what threads exist"
 * is the Threads tab's question, with its own ceiling
 * ({@link CHANNEL_THREAD_LIST_LIMIT}). 300 is roughly two screens of prose.
 */
export const CHANNEL_TRANSCRIPT_LINE_BUDGET = 300;

/**
 * HARD ROW CAP ON ONE TRANSCRIPT PAGE — the bound that survives when
 * {@link CHANNEL_TRANSCRIPT_LINE_BUDGET} cannot bite (INVARIANTS §9: every read is
 * bounded, in rows, always). ⚠ **IT IS {@link MAX_MESSAGE_LIMIT}, THE SCHEMA'S OWN
 * CEILING, AND NOT THE 50 THE OLD PAGE SIZE USED** — 50 was never a cap, just what
 * the hook requested, so naming the real one makes the request sent and the maximum
 * honoured one number by construction. It bites only below ~1.5 estimated lines per
 * message.
 */
export const CHANNEL_TRANSCRIPT_PAGE_MAX_ROWS = MAX_MESSAGE_LIMIT;

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
 * Await long-poll: background access recheck cadence, in poll ticks. Fires on the
 * first held tick then every Nth (1, 11, 21, …) — ~15s bounded staleness on an IDLE
 * hold, where the recheck had been 2 of 3 queries per tick.
 *
 * ⚠ THE INVARIANT (M2): NO FETCH OF MESSAGE ROWS MAY PRECEDE A PROOF OF ACCESS
 * WITHIN THE SAME TICK — enforced on the RETURN path, not by this cadence.
 * `awaitNewMessages` proves access before reading rows unless the periodic recheck
 * already proved it that tick, so a member revoked mid-hold is cut off on the very
 * next message at any tick count.
 */
export const AWAIT_REVALIDATE_EVERY_TICKS = 10;

/**
 * HOW LONG A LAUNCH DIRECTIVE STAYS ANSWERABLE (2026-08-22).
 *
 * ⚠ **A LIVENESS BOUND, NOT A PATIENCE BOUND.** A directive asks a machine to start a
 * process NOW; unclaimed after two minutes it is asleep, signed out, or has the
 * launch toggle off, and starting an agent against a goal whose context has moved on
 * is worse than not starting one. Compare {@link CONSENT_TTL_MS} (24h), which bounds
 * a HUMAN decision; nothing parks here.
 *
 * ⚠ Longer than the MCP op's own hold (`wait_ms` default 15s, cap 30s), and that gap
 * is the point: the hold timing out is NOT the directive expiring, and re-issuing
 * would queue a second agent.
 *
 * ⚠ **ENFORCED LAZILY, AT READ TIME, AND THERE IS NO CRON** — `server/
 * service-launch.ts › toDirective` reports a non-terminal row past this window as
 * `expired`, so the stored `status` and the reported one may disagree.
 */
export const LAUNCH_DIRECTIVE_TTL_MS = 120_000;

/**
 * HOW LONG A PRIVATE DIRECTION STAYS ANSWERABLE (2026-08-31).
 *
 * ⚠ **LONGER THAN A LAUNCH'S, AND THE DIFFERENCE IS THE WORK, NOT THE PATIENCE.** A
 * launch is answered by a process START; a direction is answered by a TURN, which is
 * minutes of real work queued behind a turn already in flight (`priority: 'next'`).
 *
 * ⚠ Still a LIVENESS bound, and far longer than the MCP op's own hold (default 15s,
 * cap 30s): the hold timing out is NOT the direction expiring. Enforced LAZILY at
 * read time in `service-directions.ts › toDirection`; **there is no cron.**
 */
export const AGENT_DIRECTION_TTL_MS = 600_000;


/**
 * **HOW RECENT A `channel_sessions` ROW MUST BE FOR THE SERVER TO ACT ON IT**
 * (2026-09-02, A9 — the delivery keystone).
 *
 * ⚠ **`channel_sessions` IS A PROJECTION, NOT A REGISTRY** (see
 * `server/repository-sessions.ts` and **F-418**): the desktop pushes it ON STATE
 * CHANGE, never on a timer (`main/session-state-push.js`), so *a quiet row means
 * nobody said anything, not that nothing is running*.
 *
 * ⚠ **SO THE RULE IS ASYMMETRIC AND MUST STAY SO.** A row inside this window is
 * evidence enough to RESOLVE a recipient and to REFUSE a direction naming an agent
 * not in it; outside it the server resolves nothing and refuses nothing, and the
 * machine answers. Never invert it: "no fresh row" may not become "no such agent".
 *
 * ⚠ Deliberately LONGER than `PRESENCE_ONLINE_WINDOW_MS`: this table is written only
 * when a session's derived state MOVES, and an agent thinking for four minutes writes
 * nothing.
 */
export const SESSION_PROJECTION_FRESH_MS = 5 * 60_000;

/**
 * BACKSTOP REFETCH for the roster (2026-09-08). The presence dot is decided
 * SERVER-side now, so a missed `agent_presence` event can no longer be corrected by
 * the client's own clock — the rendered boolean stays put until something refetches.
 *
 * ⚠ **A BACKSTOP, NOT THE MECHANISM.** `usePresenceRealtime` makes presence feel
 * live; this makes a surface that loses its subscription degrade to "up to 60s late"
 * instead of "wrong until you switch channels" — the failure with no error shape §7
 * keeps paying for.
 */
export const PRESENCE_ROSTER_BACKSTOP_MS = 60_000;
