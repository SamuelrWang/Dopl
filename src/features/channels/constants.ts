/** Channels feature constants. */

import type { AgentToolProfile, ThreadMode } from "./types";

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
 * ⚠ Passed by the surfaces that RENDER a pending draft, and by nothing else:
 * `components/channels-v2/channel-surface-data.ts` (both hosts of the per-channel
 * surface) and `components/channels-v2/agent-window.tsx` (its own BrowserWindow,
 * which inherits no provider state). (This anchor read `channels-view` until the
 * Phase 12 cutover deleted that page, 2026-08-18, and `channels-v2-core.tsx`
 * until the surface extraction on 2026-08-23.)
 *
 * ⚠ THE ALWAYS-MOUNTED NAV BADGE THAT THIS SENTENCE EXEMPTED IS DELETED (Samuel,
 * 2026-08-25 — INVARIANTS §6): the app shell reads no consent at all now, so
 * there is no longer a page in the app that would poll the workspace in the
 * background. The rule survives the badge — an interval belongs to a surface
 * that can act on the rows. TanStack's default `refetchIntervalInBackground:
 * false` pauses this while the tab is hidden.
 */
export const CONSENT_INBOX_POLL_MS = 30_000;

/**
 * Member count at which a channel stops behaving like a pair.
 *
 * ⚠ IT NO LONGER MARKS A BEHAVIOUR BOUNDARY. `dopl-desktop-app/main/targeting.js
 * › classify` used to fire an IMPLICIT trigger on a known-exact
 * `memberCount === 2` plus explicit membership; that branch was removed
 * 2026-08-18 (wiring plan Phase 3) together with the server-side DM
 * auto-address. **An UNADDRESSED ask now triggers NOBODY at every size** —
 * fail-closed by design, and no longer only above a threshold (a broadcast
 * trigger turns the loop brake into a storm; never add one).
 *
 * ⚠ COPY threshold, not a gate — nothing here decides routing, and now nothing
 * downstream branches on it either.
 *
 * ⚠ **ONE READER LEFT, AND IT IS IN THE OTHER TREE.** Its deliberate duplicate
 * `packages/mcp-server/src/tools/channel-addressing.ts › GROUP_CHANNEL_MIN_MEMBERS`
 * still picks whether the ROSTER LINE names a count or says "the other member",
 * and `channel-addressing-rule.test.ts` pins the two numbers together so one
 * tree cannot restate the rule and leave the other saying the old thing.
 * **`components/invite-dialog.tsx › GroupChannelRoutingNote` stopped reading it
 * on 2026-08-18 (wave-2 fix pass)**: that note both gated on the threshold and
 * recited it ("In a channel of 3 or more…"), which taught the trigger rule
 * Phase 3 retired and hid the note from the two-member channel that needs it
 * most. Nothing in `src/**` outside this file names the constant now.
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
 * How a thread is worked, as a word rather than an enum. Two values, both real
 * (`types.ts › ThreadMode`) — there is no third and no unknown to degrade to.
 *
 * ⚠ ONE MAP, TWO SURFACES (2026-08-21). It began as a local const in
 * `components/channels-v2/thread-info-tab.tsx`, which DISPLAYS the mode; the
 * thread Settings tab CHOOSES it, and a second copy of the labels is how the
 * read-out and the control come to word the same value differently.
 * ⚠ NO DESCRIPTIONS BESIDE THEM, deliberately — the Settings tab is a name plus a
 * control (INVARIANTS §5, the minimal-copy ruling), and a per-option sentence
 * here would be an explainer under a control.
 */
export const THREAD_MODE_LABELS: Record<ThreadMode, string> = {
  interactive: "Interactive",
  autonomous: "Autonomous",
};

/**
 * Human labels for the per-channel agent tool scope.
 *
 * ⚠ ONE CONSUMER TODAY, and this docblock claimed two until 2026-08-21:
 * `channels-v2/settings-agent.tsx`, where the scope is CHOSEN (re-measured:
 * `grep -rn AGENT_TOOL_PROFILE_LABELS src`). The second was "the consent card,
 * where the operator needs to know what **Allow** will run with" — and BOTH
 * halves of that sentence had expired. `components/consent-card.tsx` is DELETED
 * (INVARIANTS §6; the decision moved inline), and no consent surface has said
 * "Allow" since the affirmative became **Launch agent** on all three of them
 * (`thread-consent.tsx › ThreadAwaitingStrip`, `channels-v2/transcript.tsx ›
 * ThreadCardMessage`, and the Inbox pane's `InboxRow`). ⚠ All three of THOSE
 * are deleted too — the first two with the inbound retirement, the Inbox pane
 * on 2026-08-25 — so the sentence is kept as history, not as a census.
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

/**
 * Ceiling on ONE channel's mentions-of-me page (`service-mentions.ts ›
 * listMyChannelMentions`). Mentions never leave the inbox — it is a record, not
 * a to-do pile — so the read needs a bound (INVARIANTS §9), and a read coming
 * back AT the ceiling counts as CLIPPED.
 *
 * ⚠ Deliberately a QUARTER of {@link MAX_MESSAGE_LIMIT}: the transcript page is
 * the surface a human scrolls, and this one is a 380px accordion nobody pages
 * through. Raising it buys rows nothing renders well.
 */
export const CHANNEL_MENTION_LIST_LIMIT = 50;

/**
 * Character cap on a mention row's `snippet`. ⚠ Clipped SERVER-SIDE, not by a
 * `line-clamp`: the inbox is a pointer at the transcript row, and shipping a
 * 16k body per row to draw two lines of it is the read paying for the whole
 * message N times (INVARIANTS §9 — heavy fields belong to the detail path,
 * which here is the transcript itself).
 */
export const MENTION_SNIPPET_MAX_CHARS = 240;

/**
 * Hard cap on how many mentions ONE mark-read call may name.
 *
 * ⚠ It is the page ceiling, and that is the point: "Mark all read" sends the
 * ids the client is DISPLAYING, so it can never name more than one page. A
 * larger request is not a bigger mark-all, it is a caller that built the list
 * some other way.
 */
export const CHANNEL_MENTION_MARK_MAX = CHANNEL_MENTION_LIST_LIMIT;

/**
 * Hard cap on the addressees of ONE request fan-out
 * (`server/service-tasks-fanout.ts › createTaskFanOut`).
 *
 * ⚠ A BOUND ON WORK, not a product rule. The fan-out is N sequential
 * `createTask` calls, each of which posts through the channel's advisory lock —
 * so an unbounded roster turns one Send into an unbounded request. The UI can
 * only offer one pill per OTHER channel member, so this bites a large room, and
 * it bites it with a 400 rather than a timeout. **Nothing about "how many
 * agents may be addressed" is decided here; addressing is explicit either way
 * ({@link GROUP_CHANNEL_MIN_MEMBERS} is the copy threshold, not a gate).**
 */
export const CHANNEL_FANOUT_MAX_ADDRESSEES = 25;

/** Default page size for a message read when `limit` is omitted. */
export const DEFAULT_MESSAGE_LIMIT = 100;

/** Hard cap on a message read page (contract: `limit <= 200`). */
export const MAX_MESSAGE_LIMIT = 200;

/**
 * ONE PAGE OF TRANSCRIPT — what the channel surface asks for on open, and what
 * each scroll-up page then adds (`hooks/use-channel-messages.ts`).
 *
 * ⚠ IT REPLACED {@link MAX_MESSAGE_LIMIT} AS THE TRANSCRIPT'S READ SIZE
 * (2026-09-01). The surface used to open on the newest 200 with no way to reach
 * message 201 — bounded, so never the unbounded read §9 forbids, but a hard
 * FLOOR under the channel's history: everything older than the ceiling was
 * simply unreachable from the UI, and the mention jump said so out loud
 * (`message-pane.tsx › SCROLL_TARGET_MISSING_NOTE`). Paging up removes the
 * floor, which is what lets the first paint be a QUARTER of what it was.
 *
 * ⚠ **A SMALLER FIRST PAGE IS A SMALLER DERIVATION WINDOW, AND THAT IS THE
 * TRADE.** The channel view's thread cards, the escalation cards and the
 * outbound send-box join are all derived from the messages ON SCREEN
 * (`channel-surface-data.ts`), so a thread whose last activity is older than
 * this page has no card until the reader pages back to it. The Threads tab is
 * the surface that answers "what threads exist" — it has its own read and its
 * own ceiling ({@link CHANNEL_THREAD_LIST_LIMIT}) — so the transcript is not
 * the record of record for that question and does not need to be sized as if it
 * were.
 *
 * 50 is a screen and a half at typical row heights, so the reader has somewhere
 * to scroll before the next page is asked for; the page fetch itself is bounded
 * by {@link MAX_MESSAGE_LIMIT} at the schema, not by this.
 */
export const CHANNEL_TRANSCRIPT_PAGE_SIZE = 50;

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

/**
 * HOW LONG A LAUNCH DIRECTIVE STAYS ANSWERABLE (2026-08-22).
 *
 * ⚠ **IT IS A LIVENESS BOUND, NOT A PATIENCE BOUND.** A directive asks a machine
 * to start a process NOW; if no desktop has claimed it in two minutes, the
 * machine that would have run it is asleep, signed out, or has the launch toggle
 * off — and starting an agent later, against a goal whose context has moved on,
 * is worse than not starting one. Compare {@link CONSENT_TTL_MS} (24h), which
 * bounds a HUMAN decision and must outlast the desktop watcher's park window;
 * nothing parks here.
 *
 * ⚠ Comfortably longer than the MCP op's own hold (`wait_ms` default 15s, cap
 * 30s), and that gap is the point: the hold timing out is NOT the directive
 * expiring. The agent is told the request is still pending and told where to
 * look for the result — re-issuing instead would queue a second agent.
 *
 * ⚠ **ENFORCED LAZILY, AT READ TIME, AND THERE IS NO CRON** — `server/
 * service-launch.ts › toDirective` reports a non-terminal row past this window
 * as `expired`, so the stored `status` and the reported one may disagree. A
 * sweep would be a scheduled job whose only output is cosmetic, and this repo's
 * standing lesson is that a cron is an environment fact nothing in the tree can
 * observe.
 */
export const LAUNCH_DIRECTIVE_TTL_MS = 120_000;

/**
 * HOW LONG A PRIVATE DIRECTION STAYS ANSWERABLE (2026-08-31).
 *
 * ⚠ **LONGER THAN A LAUNCH'S, AND THE DIFFERENCE IS THE WORK, NOT THE PATIENCE.**
 * A launch is answered by a process START — a machine either has a free slot now
 * or does not. A direction is answered by a TURN: the agent has to read the
 * direction, possibly use tools, and produce a final text, and that is minutes of
 * real work on a busy session where the direction queues behind a turn already in
 * flight (`priority: 'next'`).
 *
 * ⚠ IT IS STILL A LIVENESS BOUND, NOT A PATIENCE ONE, and it is deliberately far
 * longer than the MCP op's own hold (default 15s, cap 30s): the hold timing out is
 * NOT the direction expiring, and the op says so. Enforced LAZILY at read time in
 * `service-directions.ts › toDirection`; **there is no cron.**
 */
export const AGENT_DIRECTION_TTL_MS = 600_000;
