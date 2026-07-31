/**
 * Thread grouping — turn the flat channel message list into an ordered render
 * model where one spawned-agent SESSION collapses into a single card.
 *
 * A session is the run of messages/events sharing one `metadata.taskId`
 * (deterministic `task-{channelId}-{seq}`): `task_started` →
 * (`task_progress`) → agent reply message(s) → `task_finished` /
 * `task_failed`. The web renders it as ONE card whose header carries the
 * status chip, so the flat "Started working…/Finished this request." rows are
 * replaced by the chip and never shown on their own.
 *
 * Human messages, `system` rows, and plain agent chat WITHOUT a taskId stay as
 * their own items and render unchanged.
 *
 * Pure + deterministic so it can be unit-tested in isolation. Input is the
 * transcript in `seq` order (the repository returns messages ascending).
 */

import type { ChannelMessage, ChannelMessageKind, ThreadMode } from "../types";

/**
 * A session's lifecycle state, derived from its task lifecycle events.
 *
 * Beyond the plain outcomes (`active`/`done`/`failed`) there is a family of
 * CALM TERMINAL states — outcomes the operator deliberately chose, which the
 * desktop posts as a `task_failed` carrying a boolean metadata flag (no schema
 * change) and which must read as ordinary endings, never a scary red error:
 * - `declined`    — the operator denied a consent request (`metadata.declined`).
 * - `dropped`     — the operator cancelled the outbound send (`metadata.dropped`).
 * - `interrupted` — the app died mid-spawn (`metadata.interrupted`).
 * - `capped`      — a turn/cost cap was reached (`metadata.capped`); the task
 *                   stays open, reopen the window to continue.
 * - `ended`       — the operator ended the session on the desktop
 *                   (`metadata.ended`); the task stays open.
 * A bare `task_failed` with none of these flags is a genuine `failed`.
 */
export type SessionStatus =
  | "active"
  | "done"
  | "failed"
  | "declined"
  | "dropped"
  | "interrupted"
  | "capped"
  | "ended";

/**
 * The calm terminal states — operator-chosen endings that share the muted
 * (never alarm-red) chip treatment. `failed` is intentionally NOT here.
 */
const CALM_TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "declined",
  "dropped",
  "interrupted",
  "capped",
  "ended",
]);

/**
 * The calm SESSION-END states — a running session that stopped without a reply
 * (app died, cap hit, operator ended it). A strict SUBSET of the calm terminals:
 * `declined`/`dropped` are request-level decisions (work never ran), excluded so
 * only these three replace a lying "Working…" line on an open-task card.
 */
const CALM_SESSION_END_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "interrupted",
  "capped",
  "ended",
]);

/** True for the operator-chosen calm terminal outcomes (declined/dropped/interrupted). */
export function isCalmTerminalStatus(status: SessionStatus): boolean {
  return CALM_TERMINAL_STATUSES.has(status);
}

/**
 * The authoritative overlay for a first-class THREAD (the `channel_tasks` row —
 * storage keeps the `task` spelling), keyed by the wire `metadata.taskId`. When
 * a group's `taskId` resolves to one of these, its `status` and `title` win over
 * the message-derived values — a mid-flight thread with delivered replies still
 * reads "active" until the row is closed, which the lifecycle-only heuristic
 * could never know. Old `task-{channel}-{seq}` sessions have no row and keep the
 * derived render.
 */
export interface ThreadOverlay {
  status: SessionStatus;
  title: string | null;
  mode: ThreadMode | null;
  /**
   * The task's human-readable close summary (`channel_tasks.outcome_summary`),
   * or null. Optional so a legacy overlay literal (and any pre-v1.7 caller)
   * stays valid; `groupThread` normalizes an absent value to null.
   */
  outcomeSummary?: string | null;
}

/** One grouped agent session, ready to render as a card. */
export interface SessionGroup {
  /**
   * The shared `metadata.taskId` that binds the session together. BOUNDARY: this
   * is the WIRE value verbatim, so it deliberately keeps the `task` spelling per
   * the v3.0 vocabulary contract (storage stays `channel_tasks` /
   * `metadata.task*`); in domain terms it is the thread id. It renames only when
   * storage migrates (F-081).
   */
  taskId: string;
  status: SessionStatus;
  /**
   * The first-class task title (overlay), authoritative when present; null for
   * a legacy session with no `channel_tasks` row (the card falls back to
   * {@link SessionGroup.summary}).
   */
  title: string | null;
  /** The first-class task mode (overlay), or null for a legacy session. */
  mode: ThreadMode | null;
  /**
   * Identity + time source for the header: the agent-authored message that
   * opened the session (the `task_started`, or the first event we saw).
   */
  head: ChannelMessage;
  /**
   * Body content in seq order: the agent reply message(s) and any
   * `task_progress` lines. Excludes the `task_started/finished/failed`
   * lifecycle markers (those become the header chip).
   */
  entries: ChannelMessage[];
  /** One-line header summary (see {@link computeSummary} precedence). */
  summary: string | null;
  /**
   * The first-class task's human-readable close summary (overlay), shown in the
   * card footer near the status chip; null for a legacy session with no
   * `channel_tasks` row, or a task closed without a summary.
   */
  outcomeSummary: string | null;
  /**
   * The calm session-end status (interrupted / capped / ended) when the session
   * stopped WITHOUT a restart (`task_started`) after its terminal marker; null
   * otherwise. Lets the card show the honest end note in place of "Working…"
   * even when an open-task overlay pins {@link SessionGroup.status} to "active".
   */
  calmEndStatus: SessionStatus | null;
  /** Earliest event time in the session, for the header relative time. */
  createdAt: string;
}

/** An ordered transcript item: a standalone message, or a grouped session. */
export type ThreadItem =
  | { type: "message"; key: string; message: ChannelMessage }
  | { type: "session"; key: string; session: SessionGroup };

const TASK_KINDS: ReadonlySet<ChannelMessageKind> = new Set([
  "task_started",
  "task_progress",
  "task_finished",
  "task_failed",
]);

function readTaskId(metadata: Record<string, unknown>): string | null {
  const value = metadata.taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readSummary(metadata: Record<string, unknown>): string | null {
  const value = metadata.summary;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The addressed recipient of a message (`metadata.to_user_id`), or null. */
function readToUserId(metadata: Record<string, unknown>): string | null {
  const value = metadata.to_user_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Parse the trailing seq `N` from a legacy deterministic task id of the shape
 * `task-{channelId}-{N}` (the desktop spawner's id). The channelId is a UUID
 * that itself contains hyphens, so we anchor on the KNOWN channel id rather
 * than splitting on '-'. Returns null for any other id shape (a first-class
 * UUID task id, etc.), which is how the legacy-only backfill/pair-join stay
 * scoped to legacy exchanges.
 */
export function parseLegacyTaskSeq(taskId: string, channelId: string): number | null {
  const prefix = `task-${channelId}-`;
  if (!taskId.startsWith(prefix)) return null;
  const rest = taskId.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

/**
 * Map a terminal marker to the calm terminal status it announces, or null when
 * it is a genuine failure. The desktop encodes an operator-chosen ending as a
 * `task_failed` carrying a boolean metadata flag (no schema change): `declined`
 * (consent denied), `dropped` (outbound send cancelled), `interrupted` (app died
 * mid-spawn), `capped` (a turn/cost cap was reached), or `ended` (the operator
 * ended the session on the desktop). Each flag is read STRICTLY (`=== true`) so
 * an attacker-influenceable truthy value (e.g. the string "yes") can never
 * disguise a real failure as a calm outcome. A `task_failed` with none of the
 * flags returns null and stays a genuine `failed`.
 */
export function calmTerminalStatus(message: ChannelMessage): SessionStatus | null {
  if (message.kind !== "task_failed") return null;
  const { metadata } = message;
  if (metadata.declined === true) return "declined";
  if (metadata.dropped === true) return "dropped";
  if (metadata.interrupted === true) return "interrupted";
  if (metadata.capped === true) return "capped";
  if (metadata.ended === true) return "ended";
  return null;
}

/**
 * The calm SESSION-END status a terminal marker announces (interrupted/capped/
 * ended), or null — a strict subset of {@link calmTerminalStatus} that excludes
 * the request-level `declined`/`dropped`. Drives the honest "Working…"
 * replacement so a session that stopped mid-work stops claiming it is working.
 */
export function calmSessionEndStatus(message: ChannelMessage): SessionStatus | null {
  const status = calmTerminalStatus(message);
  return status !== null && CALM_SESSION_END_STATUSES.has(status) ? status : null;
}

/** Collapse whitespace and cap length with an ellipsis (header previews). */
export function truncateSummary(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Split a session's body entries into the two render lanes the card shows
 * separately: `task_progress` milestones (the live accomplishment log) and
 * `message` chat replies. Both preserve the input seq order. This is a pure
 * RENDER-layer split — `groupThread` deliberately keeps `task_progress` inside
 * {@link SessionGroup.entries} (its output is byte-for-byte unchanged), and the
 * card separates the two lanes only at render time.
 */
export function splitSessionEntries(entries: ChannelMessage[]): {
  milestones: ChannelMessage[];
  replies: ChannelMessage[];
} {
  const milestones: ChannelMessage[] = [];
  const replies: ChannelMessage[] = [];
  for (const entry of entries) {
    if (entry.kind === "task_progress") milestones.push(entry);
    else if (entry.kind === "message") replies.push(entry);
  }
  return { milestones, replies };
}

/** Mutable accumulator; finalized into a {@link SessionGroup} at the end. */
interface Draft {
  taskId: string;
  head: ChannelMessage;
  entries: ChannelMessage[];
  startedEvent: ChannelMessage | null;
  endEvent: ChannelMessage | null;
  createdAt: string;
  /**
   * The responder — the `task_started` author (the operator whose agent runs
   * the task). Anchors the {requester, responder} pair for the pair-join.
   */
  responder: string | null;
  /**
   * The requester — the human who opened the exchange: the author of the legacy
   * seq-N message addressed to the responder. Set when the `task_started` fires
   * (from the seq-N opener), or during the seq-N backfill. Drives the pair-join.
   */
  requester: string | null;
  /** The `N` in a legacy `task-{channelId}-{N}` id, for the seq-N backfill. */
  legacySeq: number | null;
}

function computeStatus(draft: Draft): SessionStatus {
  // Precedence, most authoritative first:
  // 1. An explicit terminal marker always wins. A `task_failed` is a genuine
  //    failure UNLESS it carries an operator-chosen calm-terminal flag
  //    (declined/dropped/interrupted), in which case it takes that calm state.
  if (draft.endEvent) {
    if (draft.endEvent.kind === "task_failed") {
      return calmTerminalStatus(draft.endEvent) ?? "failed";
    }
    return "done";
  }
  // 2. A delivered AGENT reply implies the work completed, even with no
  //    `task_finished` — a terminal-mode session self-posts its reply and then
  //    falls silent, and a dropped finish still leaves a real answer on screen.
  //    Either way the session is Done, not a perpetual "Active" pulse. Only an
  //    agent reply counts: a session can now also carry the requester's own
  //    (human) messages (seq-N backfill / pair-join), which must not, on their
  //    own, mark an unanswered started task as Done.
  if (draft.entries.some((e) => e.kind === "message" && e.authorKind === "agent"))
    return "done";
  // 3. Started, but nothing delivered yet — genuinely in flight.
  if (draft.startedEvent) return "active";
  // 4. No markers and no reply (only stray progress lines): nothing is live.
  return "done";
}

function computeSummary(draft: Draft): string | null {
  // 1. An explicit `metadata.summary` on any event wins.
  const candidates = [draft.startedEvent, draft.endEvent, ...draft.entries];
  for (const event of candidates) {
    if (!event) continue;
    const summary = readSummary(event.metadata);
    if (summary) return truncateSummary(summary);
  }
  // 2. The last agent reply's text, truncated.
  const replies = draft.entries.filter((e) => e.kind === "message");
  const lastReply = replies[replies.length - 1];
  if (lastReply && lastReply.body.trim()) return truncateSummary(lastReply.body);
  // 3. Fall back to the task event's human-readable body.
  const taskEvent = draft.startedEvent ?? draft.endEvent;
  if (taskEvent && taskEvent.body.trim()) return truncateSummary(taskEvent.body);
  return null;
}

/**
 * Which session, if any, an untagged agent post may take from the open fallback
 * window. The window is CHANNEL-WIDE but a session belongs to ONE operator: the
 * responder whose agent runs it. In a DM those are the same thing; in a channel
 * with a third member, or with two pairs working at once, they are not, so the
 * author must be checked before the post is folded in.
 *
 * - `"join"`   — the post is the open session's own responder, or the session
 *   has no known responder at all, which keeps an anonymous transcript
 *   byte-for-byte unchanged. A null responder is a REAL shape, not just a test
 *   fixture: `author_user_id` is `ON DELETE SET NULL`, so a departed member's
 *   history loses its author. Such a session keeps the old ungated behavior on
 *   purpose — there is no identity left to compare against.
 * - `"close"`  — the post comes from OUTSIDE the open session's
 *   {requester, responder} pair. It stands alone AND spends the window, exactly
 *   as an addressed third party already does in the pair-join: a stranger's post
 *   means the exchange moved on, so nothing after it folds in either.
 * - `"stand-alone"` — inside the pair but not the responder (the requester's own
 *   agent). It is not the session's answer so it does not join, but it is not a
 *   stranger either, so the window stays open for the responder's real reply.
 */
type OpenWindowVerdict = "join" | "close" | "stand-alone";

function classifyOpenWindowPost(
  openDraft: Draft | undefined,
  authorUserId: string | null
): OpenWindowVerdict {
  // No draft behind the open id (unreachable — the window is only opened right
  // after its draft exists): fall back to the pre-gate behavior.
  if (!openDraft) return "join";
  if (openDraft.responder === null) return "join";
  if (openDraft.responder === authorUserId) return "join";
  if (authorUserId !== null && openDraft.requester === authorUserId) {
    return "stand-alone";
  }
  return "close";
}

/**
 * Group a `seq`-ordered transcript into an ordered list of standalone messages
 * and session cards. A session card is emitted at the position of its first
 * event, so chronological order is preserved; concurrent sessions each keep
 * their own card and route later events by `taskId`.
 *
 * Sessions DO interleave. "One session runs per channel at a time" is a DM
 * invariant — a three-member channel, or two pairs working at once, breaks it
 * outright — which is why the single open fallback window below is author-gated
 * rather than trusted (see {@link classifyOpenWindowPost}).
 *
 * `taskOverlays` (optional) carries the authoritative `channel_tasks` state
 * keyed by task id. When a group's `taskId` is present, its `status`/`title`
 * are taken from the overlay; every other group falls back to the
 * message-derived status/summary. Calling `groupThread(messages)` with no map
 * is byte-for-byte the legacy behavior.
 */
export function groupThread(
  messages: ChannelMessage[],
  taskOverlays?: Map<string, ThreadOverlay>
): ThreadItem[] {
  const items: ThreadItem[] = [];
  const drafts = new Map<string, Draft>();
  // Index by seq for the legacy seq-N backfill: a legacy `task-{channelId}-{N}`
  // id points back at the seq of the opening request that spawned it.
  const bySeq = new Map<number, ChannelMessage>();
  for (const m of messages) bySeq.set(m.seq, m);
  // The single open fallback window: the session whose `task_started` has fired
  // and not yet been closed. It exists ONLY to catch a terminal-mode agent
  // reply that arrives without its own taskId (the reply is self-posted via MCP
  // and no `task_finished` will ever follow). The window is deliberately narrow
  // — it opens on `task_started` and closes on the FIRST of: a human/system row
  // (`authorKind !== 'agent'` or `kind === 'system'`); a NEW `task_started`
  // (a different session supersedes the prior open one); the matching
  // `task_finished`/`task_failed`; an agent post from OUTSIDE the session's
  // pair (see {@link classifyOpenWindowPost}); or a no-taskId reply being folded
  // in (terminal mode delivers one reply, then the window is spent). Once
  // closed, an incidental no-taskId agent post is no longer contiguous with any
  // open session and renders as a standalone plain agent bubble — a session card
  // can never contain a message that follows an intervening boundary.
  //
  // The window is channel-wide, so it is ALSO gated on authorship: only the open
  // session's own responder may take it. Without that gate a third member's
  // unrelated agent note becomes another pair's reply — retitling their card and
  // flipping a still-running request to Done — and, with two concurrent
  // exchanges, one pair's untagged reply lands in the other pair's card and
  // suppresses its "Working…" line.
  let openTaskId: string | null = null;

  for (const message of messages) {
    const isTaskEvent = TASK_KINDS.has(message.kind);
    const isAgentReply =
      message.kind === "message" && message.authorKind === "agent";
    const ownTaskId = readTaskId(message.metadata);
    const toUserId = readToUserId(message.metadata);

    // B2 OPEN-SESSION PAIR-JOIN — an ADDRESSED message with no task id of its
    // own that fits the open session's {requester, responder} pair joins that
    // session, even across the human/system boundary that would otherwise close
    // the window. This keeps a requester's follow-up (and the responder's
    // addressed reply) inside a legacy `task-{channel}-{seq}` exchange whose
    // follow-ups never carry the task id. A message to/from a THIRD party is not
    // in the pair: it does not join, and it terminates the window. Gated
    // strictly on `to_user_id`, so a transcript with no addressing metadata is
    // byte-for-byte unchanged.
    if (
      toUserId !== null &&
      ownTaskId === null &&
      message.kind === "message" &&
      openTaskId !== null
    ) {
      const openDraft = drafts.get(openTaskId);
      if (
        openDraft &&
        openDraft.startedEvent &&
        openDraft.requester !== null &&
        openDraft.responder !== null
      ) {
        const pair = new Set([openDraft.requester, openDraft.responder]);
        const author = message.authorUserId;
        const inPair =
          author !== null &&
          author !== toUserId &&
          pair.has(author) &&
          pair.has(toUserId);
        if (inPair) {
          openDraft.entries.push(message);
          if (Date.parse(message.createdAt) < Date.parse(openDraft.createdAt)) {
            openDraft.createdAt = message.createdAt;
          }
          // A responder-authored reply answers the exchange: spend the window
          // so that, if this session's task_finished never arrives, the NEXT
          // task's seq-N opener can't be absorbed into this stale card.
          if (author === openDraft.responder) {
            openTaskId = null;
          }
          continue;
        }
        // Addressed, but a third party is involved: the exchange moved on —
        // stop accepting into this session (the message itself stands alone).
        openTaskId = null;
      }
    }

    // Hard boundary: a human or system row ends any open fallback window, so a
    // later no-taskId agent post cannot fold into the session that preceded it.
    if (message.authorKind !== "agent" || message.kind === "system") {
      openTaskId = null;
    }

    // Resolve the session this message belongs to (if any).
    //  - An EXPLICIT `metadata.taskId` binds ANY row (a human request, an agent
    //    reply, or a lifecycle marker) to that group. A first-class task's
    //    request + replies + markers all share one id, so the requester's own
    //    message folds into the card alongside the answers.
    //  - With NO explicit id, only task events and agent replies fall back to
    //    the open window (legacy terminal-mode sessions that self-post without
    //    an id), and only when the author is that session's own responder —
    //    the window is channel-wide, the session is not. Human / system rows
    //    with no id always own themselves.
    let taskId: string | null = null;
    if (ownTaskId !== null) taskId = ownTaskId;
    else if ((isTaskEvent || isAgentReply) && openTaskId !== null) {
      const verdict = classifyOpenWindowPost(
        drafts.get(openTaskId),
        message.authorUserId
      );
      if (verdict === "join") taskId = openTaskId;
      else if (verdict === "close") openTaskId = null;
    }

    if (taskId === null) {
      items.push({ type: "message", key: message.id, message });
      continue;
    }

    // A no-taskId agent reply that reaches its session through the open window
    // (not by its own taskId) consumes that window — the terminal reply has
    // been delivered, so a LATER unrelated no-taskId post must not attach here.
    const viaFallback = isAgentReply && ownTaskId === null;

    let draft = drafts.get(taskId);
    if (!draft) {
      draft = {
        taskId,
        head: message,
        entries: [],
        startedEvent: null,
        endEvent: null,
        createdAt: message.createdAt,
        responder: null,
        requester: null,
        legacySeq: null,
      };
      drafts.set(taskId, draft);
      // Placeholder session object; finalized in place after the full pass.
      items.push({
        type: "session",
        key: `session:${taskId}`,
        session: draft as unknown as SessionGroup,
      });
    }

    if (Date.parse(message.createdAt) < Date.parse(draft.createdAt)) {
      draft.createdAt = message.createdAt;
    }

    switch (message.kind) {
      case "task_started":
        draft.startedEvent = message;
        // Prefer the lifecycle-opening event as the identity/time head.
        draft.head = message;
        // Establish the pair for the pair-join: the responder is this event's
        // author; the requester is the legacy seq-N opener's author IF that
        // opener addressed this responder (the same test the backfill applies).
        draft.responder = message.authorUserId;
        draft.legacySeq = parseLegacyTaskSeq(taskId, message.channelId);
        if (draft.requester === null && draft.legacySeq !== null) {
          const opener = bySeq.get(draft.legacySeq);
          if (
            opener &&
            draft.responder !== null &&
            readToUserId(opener.metadata) === draft.responder
          ) {
            draft.requester = opener.authorUserId;
          }
        }
        // A new start opens (and, if one was already open, supersedes/closes)
        // the fallback window.
        openTaskId = taskId;
        break;
      case "task_finished":
      case "task_failed":
        draft.endEvent = message;
        if (openTaskId === taskId) openTaskId = null;
        break;
      case "task_progress":
        draft.entries.push(message);
        break;
      default:
        // A substantive body message — an agent reply, or (for a first-class
        // task) the requester's own explicit-taskId request.
        draft.entries.push(message);
        // A fallback (no-taskId) reply spends the open window: terminal mode
        // posts its single result and goes quiet, so nothing after it folds in.
        if (viaFallback && openTaskId === taskId) openTaskId = null;
        break;
    }
  }

  // Finalize each draft in place (the items array holds live references). The
  // overlay (a first-class `channel_tasks` row) is authoritative for
  // status/title; without one, the message-derived render is used unchanged.
  for (const draft of drafts.values()) {
    // B1 LEGACY TRIGGER BACKFILL — a legacy `task-{channelId}-{N}` session whose
    // opening request (the standalone seq-N message, addressed to the responder)
    // is still loose in the stream: pull it into the session as the OPENING
    // entry so the card leads with the request that started the work, and remove
    // it from the standalone stream. Only when the session actually started (has
    // a `task_started`); a lone decision-echo card (declined/dropped/interrupted
    // with no start and no entries) is deliberately left untouched.
    if (
      draft.startedEvent &&
      draft.legacySeq !== null &&
      draft.responder !== null
    ) {
      const idx = items.findIndex(
        (it) => it.type === "message" && it.message.seq === draft.legacySeq
      );
      if (idx !== -1) {
        const found = items[idx];
        if (
          found.type === "message" &&
          readToUserId(found.message.metadata) === draft.responder
        ) {
          draft.entries.unshift(found.message);
          if (draft.requester === null) {
            draft.requester = found.message.authorUserId;
          }
          items.splice(idx, 1);
        }
      }
    }

    const session = draft as unknown as SessionGroup;
    const overlay = taskOverlays?.get(draft.taskId);
    session.status = overlay ? overlay.status : computeStatus(draft);
    session.summary = computeSummary(draft);
    session.title = overlay?.title ?? null;
    session.mode = overlay?.mode ?? null;
    session.outcomeSummary = overlay?.outcomeSummary ?? null;
    // Honest end signal: a calm session-end marker (interrupted/capped/ended)
    // with NO restart after it means the session stopped, not that it is still
    // working. A later `task_started` (a resume that re-opened work) clears it.
    // Kept independent of `status` so an "active" overlay can't hide the end.
    const endEvent = draft.endEvent;
    const endStatus = endEvent ? calmSessionEndStatus(endEvent) : null;
    const restarted =
      endEvent !== null &&
      draft.startedEvent !== null &&
      draft.startedEvent.seq > endEvent.seq;
    session.calmEndStatus = endStatus !== null && !restarted ? endStatus : null;
  }

  return items;
}
