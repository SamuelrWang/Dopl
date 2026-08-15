import "server-only";
import type { ChannelThread, ThreadOutcome } from "../types";
import {
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
} from "./errors";
import { mapTaskRow } from "./dto";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";

/**
 * PROPOSE-THEN-CONFIRM. ⚠ Closing MUTATES the shared thread and belongs to the
 * HUMAN lane (`service-tasks-lifecycle.closeTask` refuses an agent-token caller
 * outright); proposing mutates NOTHING and is the agent's terminal act. Two
 * authorities over one exchange, so two files.
 */

/**
 * What a close PROPOSAL hands back: the thread plus the seq of the marker it
 * posted — like `openingSeq` / `echoSeq`, so a proposing agent can arm its wait
 * past its own marker rather than guess.
 */
export interface TaskCloseProposal {
  thread: ChannelThread;
  /** The proposal marker's seq; null when the post itself failed. */
  markerSeq: number | null;
  outcome: ThreadOutcome;
}

/**
 * Idempotency key for a close proposal: **(thread, outcome, activity anchor)**.
 *
 * ⚠ `(thread, outcome)` alone makes `propose_close` ONE-SHOT FOREVER —
 * `postMessage`'s `client_msg_id` short-circuit returns the stored row and
 * writes nothing, so the second genuine proposal is silently swallowed and the
 * stale first prompt reloads forever. Both client surfaces already assume
 * otherwise (`readCloseProposal` takes the LATEST; `session-card.tsx` dismisses
 * per message id).
 *
 * Anchor is {@link repoMessages.latestThreadActivitySeq} — the newest
 * non-proposal seq — so a retry collapses while a proposal raised after more
 * exchange writes a new row. That docblock owns the three cases.
 *
 * ⚠ THE PREFIX IS ALSO A NAMESPACE, and the stale-thread cron must NOT share it:
 * sharing lets a scheduled sweep land first and replace an agent's stated reason
 * with "no activity for a while". Different authors, different claims, different
 * keys. The sweep's RPC additionally refuses a thread whose newest message is
 * already a proposal, so it cannot talk over a live prompt.
 */
export function closeProposalClientMsgId(
  taskId: string,
  outcome: ThreadOutcome,
  anchorSeq: number
): string {
  return `close-proposed-${taskId}-${outcome}-${anchorSeq}`;
}

/**
 * PROPOSE a close — the agent's terminal act, and the only one it has. See
 * {@link ThreadCloseIsHumanOnlyError} for why the close itself is a human's.
 *
 * ⚠ Writes NOTHING to the task row: the thread stays open, `status` untouched,
 * every routing property unchanged. It only puts a marked message in the thread,
 * which the human's surfaces render as a confirmable prompt.
 *
 * ⚠ A `task_progress`, not a lifecycle kind, and every part is load-bearing:
 *  - NON-TERMINAL, so a proposal can never paint the shared thread as finished
 *    on the peer's card the way a `task_finished` does;
 *  - its body IS rendered (`splitSessionEntries`), so the agent's one-line
 *    reason is visible rather than swallowed;
 *  - no new `channel_messages.kind` value, and that column carries a CHECK
 *    constraint — a new kind is a DB migration for a render hint.
 *
 * Authorization mirrors the close exactly (creator or target): nothing here
 * should be reachable by a member who could not close it either.
 *
 * ⚠ RE-RAISABLE, idempotent per (thread, outcome, activity anchor). Same
 * proposal twice with nothing in between leaves ONE prompt; a proposal after
 * "keep open" plus more work writes a SECOND.
 * {@link closeProposalClientMsgId} holds the reasoning.
 *
 * ⚠ SYNC TARGETS: `channel-description.ts`'s `propose_close` entry and
 * `channel-ops-threads.ts`'s close refusal must teach ONCE PER STATE OF THE
 * THREAD, never "do not propose twice" — that wording stops a well-behaved agent
 * from ever re-proposing, from the one place no test looks.
 *
 * ⚠ The anchor read is taken BEFORE the post, never derived from the returned
 * row — the key has to exist before there is anything to key.
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
  const anchorSeq = await repoMessages.latestThreadActivitySeq(
    channel.id,
    task.id
  );
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
        clientMsgId: closeProposalClientMsgId(task.id, outcome, anchorSeq),
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
