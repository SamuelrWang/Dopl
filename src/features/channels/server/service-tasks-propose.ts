import "server-only";
import type { ChannelThread, ThreadOutcome } from "../types";
import {
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
} from "./errors";
import { mapTaskRow } from "./dto";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";

/**
 * DECISION 2 (Samuel, 2026-08-04) — PROPOSE-THEN-CONFIRM.
 *
 * Split out of `service-tasks.ts` at the §2 500-line cap when this landed, and the
 * seam is the product decision itself: closing MUTATES the shared thread and
 * belongs to the human lane (`service-tasks.closeTask`, which refuses an
 * agent-token caller outright), while proposing mutates NOTHING and is the
 * agent's terminal act. Two different authorities over one exchange, so two
 * files.
 */

/**
 * What a close PROPOSAL hands back: the thread it names, plus the seq of the
 * marker message it posted — the same courtesy `openingSeq` / `echoSeq` do, so a
 * proposing agent can arm its wait past its own marker rather than guess.
 */
export interface TaskCloseProposal {
  thread: ChannelThread;
  /** The proposal marker's seq; null when the post itself failed. */
  markerSeq: number | null;
  outcome: ThreadOutcome;
}

/**
 * PROPOSE a close — the agent's terminal act, and the only one it has.
 *
 * DECISION (Samuel, 2026-08-04): thread close is PROPOSE-then-CONFIRM. See
 * {@link ThreadCloseIsHumanOnlyError} for why the close itself is a human's.
 * This writes NOTHING to the task row: the thread stays open, `status` is
 * untouched, and every routing property of it is exactly what it was. All it
 * does is put a marked message in the thread, which the human's surfaces render
 * as a confirmable prompt ("your agent thinks this can be closed — Close /
 * Keep open").
 *
 * A `task_progress`, not a lifecycle kind, and that is the whole design:
 *  - it is NON-TERMINAL, so a proposal can never paint the shared thread as
 *    finished on the peer's card the way a `task_finished` does;
 *  - its body IS rendered (`splitSessionEntries`), so the agent's one-line
 *    reason for proposing is visible rather than swallowed;
 *  - it needs no new `channel_messages.kind` value, and that column carries a
 *    CHECK constraint — a new kind would be a DB migration for a render hint.
 *
 * Authorization mirrors the close exactly (creator or target): proposing is
 * only meaningful from a party to the exchange, and nothing about it should be
 * reachable by a member who could not close it either.
 *
 * IDEMPOTENT PER (thread, outcome). A responder that proposes twice in one
 * exchange leaves one prompt, not a pile of them: the `client_msg_id` collapses
 * repeats server-side, exactly as `queued-notice.js` does for its milestone.
 */
export async function proposeTaskClose(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  outcome: ThreadOutcome,
  summary?: string
): Promise<TaskCloseProposal> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("propose a close in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("propose closing this task");
  }

  const reason = summary?.trim();
  let markerSeq: number | null = null;
  try {
    const marker = await postMessage(
      ctx,
      channel.id,
      {
        body: reason || "I think this thread can be closed.",
        kind: "task_progress",
        summary: task.title,
        metadata: { taskId: task.id },
        clientMsgId: `close-proposed-${task.id}-${outcome}`,
      },
      // The marker keys are RESERVED — stripped from any caller's metadata and
      // re-stamped only from here, so nothing on the wire can manufacture a
      // "close this thread?" prompt on somebody else's exchange.
      { closeProposal: outcome }
    );
    markerSeq = marker.seq;
  } catch {
    // The proposal IS the marker, so a lost post means nothing was proposed —
    // but the thread is untouched, so this is a plain retryable nothing rather
    // than a half-applied state. `markerSeq: null` says so.
  }
  return { thread: mapTaskRow(task), markerSeq, outcome };
}
