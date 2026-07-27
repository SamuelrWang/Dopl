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

import type { ChannelMessage, ChannelMessageKind } from "../types";

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
 * A bare `task_failed` with none of these flags is a genuine `failed`.
 */
export type SessionStatus =
  | "active"
  | "done"
  | "failed"
  | "declined"
  | "dropped"
  | "interrupted";

/**
 * The calm terminal states — operator-chosen endings that share the muted
 * (never alarm-red) chip treatment. `failed` is intentionally NOT here.
 */
const CALM_TERMINAL_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "declined",
  "dropped",
  "interrupted",
]);

/** True for the operator-chosen calm terminal outcomes (declined/dropped/interrupted). */
export function isCalmTerminalStatus(status: SessionStatus): boolean {
  return CALM_TERMINAL_STATUSES.has(status);
}

/** One grouped agent session, ready to render as a card. */
export interface SessionGroup {
  /** The shared `metadata.taskId` that binds the session together. */
  taskId: string;
  status: SessionStatus;
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

/**
 * Map a terminal marker to the calm terminal status it announces, or null when
 * it is a genuine failure. The desktop encodes an operator-chosen ending as a
 * `task_failed` carrying a boolean metadata flag (no schema change): `declined`
 * (consent denied), `dropped` (outbound send cancelled), or `interrupted` (app
 * died mid-spawn). Each flag is read STRICTLY (`=== true`) so an
 * attacker-influenceable truthy value (e.g. the string "yes") can never
 * disguise a real failure as a calm outcome. A `task_failed` with none of the
 * flags returns null and stays a genuine `failed`.
 */
export function calmTerminalStatus(message: ChannelMessage): SessionStatus | null {
  if (message.kind !== "task_failed") return null;
  const { metadata } = message;
  if (metadata.declined === true) return "declined";
  if (metadata.dropped === true) return "dropped";
  if (metadata.interrupted === true) return "interrupted";
  return null;
}

/** Collapse whitespace and cap length with an ellipsis (header previews). */
export function truncateSummary(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Mutable accumulator; finalized into a {@link SessionGroup} at the end. */
interface Draft {
  taskId: string;
  head: ChannelMessage;
  entries: ChannelMessage[];
  startedEvent: ChannelMessage | null;
  endEvent: ChannelMessage | null;
  createdAt: string;
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
  // 2. A delivered agent reply implies the work completed, even with no
  //    `task_finished` — a terminal-mode session self-posts its reply and then
  //    falls silent, and a dropped finish still leaves a real answer on screen.
  //    Either way the session is Done, not a perpetual "Active" pulse.
  if (draft.entries.some((e) => e.kind === "message")) return "done";
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
 * Group a `seq`-ordered transcript into an ordered list of standalone messages
 * and session cards. A session card is emitted at the position of its first
 * event, so chronological order is preserved (sessions never interleave — one
 * runs per channel at a time).
 */
export function groupThread(messages: ChannelMessage[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  const drafts = new Map<string, Draft>();
  // The single open fallback window: the session whose `task_started` has fired
  // and not yet been closed. It exists ONLY to catch a terminal-mode agent
  // reply that arrives without its own taskId (the reply is self-posted via MCP
  // and no `task_finished` will ever follow). The window is deliberately narrow
  // — it opens on `task_started` and closes on the FIRST of: a human/system row
  // (`authorKind !== 'agent'` or `kind === 'system'`); a NEW `task_started`
  // (a different session supersedes the prior open one); the matching
  // `task_finished`/`task_failed`; or a no-taskId reply being folded in
  // (terminal mode delivers one reply, then the window is spent). Once closed,
  // an incidental no-taskId agent post is no longer contiguous with any open
  // session and renders as a standalone plain agent bubble — a session card can
  // never contain a message that follows an intervening boundary.
  let openTaskId: string | null = null;

  for (const message of messages) {
    const isTaskEvent = TASK_KINDS.has(message.kind);
    const isAgentReply =
      message.kind === "message" && message.authorKind === "agent";
    const ownTaskId = readTaskId(message.metadata);

    // Hard boundary: a human or system row ends any open fallback window, so a
    // later no-taskId agent post cannot fold into the session that preceded it.
    if (message.authorKind !== "agent" || message.kind === "system") {
      openTaskId = null;
    }

    // Resolve the session this message belongs to (if any). Human + system
    // rows, and agent chat with no session context, own themselves.
    let taskId: string | null = null;
    if (isTaskEvent) taskId = ownTaskId ?? openTaskId;
    else if (isAgentReply) taskId = ownTaskId ?? openTaskId;

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
        // An agent reply message — the substantive body of the session.
        draft.entries.push(message);
        // A fallback (no-taskId) reply spends the open window: terminal mode
        // posts its single result and goes quiet, so nothing after it folds in.
        if (viaFallback && openTaskId === taskId) openTaskId = null;
        break;
    }
  }

  // Finalize each draft in place (the items array holds live references).
  for (const draft of drafts.values()) {
    const session = draft as unknown as SessionGroup;
    session.status = computeStatus(draft);
    session.summary = computeSummary(draft);
  }

  return items;
}
