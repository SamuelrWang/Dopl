/**
 * Thread grouping — THE RENDER MODEL.
 *
 * The shapes `groupThread` produces and every channels surface consumes. Split
 * out of `group-thread.ts` (§2, 819 lines) because the types are the one part of
 * this module that changes for a DIFFERENT reason than the grouping state
 * machine does: a new render field is a contract change for every card, while a
 * new routing rule is invisible outside the reducer.
 *
 * Types only — no behavior lives here, so nothing in this file can drift from
 * the state machine without the compiler saying so.
 */

import type { ChannelMessage, ThreadMode } from "../types";

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
  /** One-line header summary (see `computeSummary` precedence). */
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

/**
 * DECISION 2 (2026-08-04) — the CLOSE PROPOSAL a card renders as a confirmable
 * prompt. Reserved and server-stamped (`service-writes-metadata.CLOSE_PROPOSAL_KEYS`),
 * so a marker on the wire is a proposal somebody was entitled to make, never a
 * claim a peer wrote into their own metadata.
 *
 * The OUTCOME rides with it because the confirm prefills from it: the agent is
 * proposing "completed" or "failed", and the human should be agreeing or
 * disagreeing with a specific thing rather than re-deciding from scratch.
 */
export interface CloseProposal {
  /** The proposing message — its body is the reason, its author is who asked. */
  message: ChannelMessage;
  outcome: "completed" | "failed";
}
