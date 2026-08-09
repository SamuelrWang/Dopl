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
 * The idempotency key for a close proposal, keyed by
 * **(thread, outcome, activity anchor)** — C-6, 2026-08-08, F-172.
 *
 * It used to be `(thread, outcome)` alone, which made `propose_close` ONE-SHOT
 * FOREVER: `postMessage`'s `client_msg_id` short-circuit returned the stored
 * row and wrote nothing, so the second genuine proposal in a long exchange was
 * silently swallowed and the first, stale prompt reloaded forever. The agent's
 * only terminal act was permanently consumed by its first use. The client had
 * always assumed the opposite — `readCloseProposal` takes the LATEST proposal,
 * and `session-card.tsx` keeps "Keep open" dismissals local and per-message-id
 * so the next real proposal renders. Nothing on the client needed changing;
 * the server simply had to be capable of writing that next proposal.
 *
 * The anchor is {@link repoMessages.latestThreadActivitySeq} — the newest seq
 * in the thread that is not itself a proposal — so a retry of the SAME proposal
 * still collapses (nothing moved) while a proposal raised after more exchange
 * writes a new row. That function's docblock owns the three cases.
 *
 * **THE PREFIX IS ALSO A NAMESPACE, and the stale-thread cron deliberately does
 * NOT share it.** Until now the cron restated this exact key so the two rows
 * would collide, which is how a scheduled sweep could land first and replace an
 * agent's stated reason with "no activity for a while" on the card. The two are
 * different authors saying different things and now write different keys; the
 * sweep's RPC additionally refuses to select a thread whose newest message is
 * already a proposal, so it cannot talk over a live prompt either.
 */
export function closeProposalClientMsgId(
  taskId: string,
  outcome: ThreadOutcome,
  anchorSeq: number
): string {
  return `close-proposed-${taskId}-${outcome}-${anchorSeq}`;
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
 * RE-RAISABLE, AND IDEMPOTENT PER (thread, outcome, activity anchor) — Samuel,
 * 2026-08-08 (C-6, F-172). A responder that fires the same proposal twice with
 * nothing in between still leaves ONE prompt; a responder that proposes, is
 * told "keep open", does another hour of work and proposes again writes a
 * SECOND prompt — which is what both client surfaces already assumed
 * (`readCloseProposal` returns the LATEST; `session-card.tsx` dismisses per
 * message id). {@link closeProposalClientMsgId} holds the reasoning.
 *
 * ✅ THE MCP TOOL DESCRIPTIONS WERE UPDATED TO MATCH (2026-08-07, F-172). Both
 * `channel-description.ts`'s `propose_close` entry and `channel-ops-threads.ts`'s
 * close refusal used to end "do not propose twice"; each now teaches ONCE PER
 * STATE OF THE THREAD. That sentence, left alone, would have stopped a
 * well-behaved agent from ever re-proposing — defeating this change entirely
 * from the one place no test looks. `dist/` rebuilt.
 *
 * The anchor read is one extra query on a path that runs at most once per unit
 * of work, and it is deliberately taken BEFORE the post rather than derived
 * from the returned row — the key has to exist before there is anything to key.
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
