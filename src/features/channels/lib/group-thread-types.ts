/**
 * Thread grouping — THE RENDER MODEL. The shapes `groupThread` produces and
 * every channels surface consumes. A new render field is a contract change for
 * every card; a new routing rule is invisible outside the reducer.
 *
 * Types only — no behavior, so nothing here can drift from the state machine
 * without the compiler saying so.
 */

import type { ChannelMessage, ThreadMode } from "../types";

/**
 * A session's lifecycle state, derived from its task lifecycle events.
 *
 * ⚠ Beyond `active`/`done`/`failed` there is a CALM TERMINAL family — outcomes
 * the operator chose, posted by the desktop as a `task_failed` carrying a
 * boolean metadata flag (no schema change), which must read as ordinary endings
 * and never a red error:
 * - `declined`    — consent request denied.
 * - `dropped`     — outbound send cancelled.
 * - `interrupted` — app died mid-spawn.
 * - `capped`      — turn/cost cap reached; ⚠ the task stays OPEN.
 * - `ended`       — operator ended the session; ⚠ the task stays OPEN.
 * A bare `task_failed` with none of these is a genuine `failed`.
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
 * Authoritative overlay for a first-class THREAD (the `channel_tasks` row),
 * keyed by wire `metadata.taskId`. ⚠ Its `status` and `title` WIN over
 * message-derived values — a mid-flight thread with delivered replies still
 * reads "active" until the row closes, which the lifecycle-only heuristic could
 * never know. Legacy `task-{channel}-{seq}` sessions have no row and keep the
 * derived render.
 */
export interface ThreadOverlay {
  status: SessionStatus;
  title: string | null;
  mode: ThreadMode | null;
  /** Close summary (`channel_tasks.outcome_summary`), or null. Optional so a
   *  legacy overlay literal stays valid; `groupThread` normalizes absent → null. */
  outcomeSummary?: string | null;
}

/** One grouped agent session, ready to render as a card. */
export interface SessionGroup {
  /** ⚠ BOUNDARY: the WIRE value verbatim, keeping the `task` spelling (storage
   *  stays `channel_tasks` / `metadata.task*`). In domain terms it is the thread
   *  id, and it renames only when storage migrates. */
  taskId: string;
  status: SessionStatus;
  /** Overlay title, authoritative when present; null for a legacy session, where
   *  the card falls back to {@link SessionGroup.summary}. */
  title: string | null;
  /** The first-class task mode (overlay), or null for a legacy session. */
  mode: ThreadMode | null;
  /** Identity + time source for the header: the agent-authored message that
   *  opened the session (`task_started`, or the first event seen). */
  head: ChannelMessage;
  /** Body content in seq order: agent replies and `task_progress` lines.
   *  ⚠ Excludes the lifecycle markers — those become the header chip. */
  entries: ChannelMessage[];
  /** One-line header summary (see `computeSummary` precedence). */
  summary: string | null;
  /** Overlay close summary, shown in the card footer near the status chip; null
   *  for a legacy session or a task closed without one. */
  outcomeSummary: string | null;
  /** Calm session-end status when the session stopped WITHOUT a restart after
   *  its terminal marker. ⚠ Lets the card show the honest end note in place of
   *  "Working…" even when an overlay pins {@link SessionGroup.status} "active". */
  calmEndStatus: SessionStatus | null;
  /** Earliest event time in the session, for the header relative time. */
  createdAt: string;
}

/** An ordered transcript item: a standalone message, or a grouped session. */
export type ThreadItem =
  | { type: "message"; key: string; message: ChannelMessage }
  | { type: "session"; key: string; session: SessionGroup };

/**
 * ⚠ `CloseProposal` USED TO LIVE HERE — the shape a card rendered as a
 * confirmable "close this thread?" prompt, read off the reserved server-stamped
 * `closeProposed` / `closeOutcome` keys. DELETED with thread closing (wiring
 * plan Phase 4, 2026-08-18): no proposal, no prompt, no reserved keys.
 */
