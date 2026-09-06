import "server-only";
import {
  TaskForbiddenError,
  TaskNotFoundError,
} from "./errors";
import * as repoCollab from "./repository-collab";
import * as repoMessages from "./repository-messages";
import * as repoSessions from "./repository-sessions";
import * as repoTasks from "./repository-tasks";
import { canManageChannel, requireMemberChannel } from "./service-shared";
import type { ChannelContext } from "./service-shared";

/**
 * DELETE A THREAD — hard, cascading, permanent (Samuel, 2026-08-21).
 *
 * ⚠ THIS IS NOT A FINISHED STATE AND MUST NEVER BE READ AS ONE. A thread still
 * has no `close`, no outcome and no reopen (INVARIANTS §5, wiring plan Phase 4):
 * every thread that exists is live. What this adds is the ability to make one
 * STOP EXISTING, which is a different verb with a different audience — the
 * mistaken thread, the duplicate, the one opened against the wrong person. A
 * future reader must not resurrect closing by pointing at this file, and nothing
 * here may grow a status write.
 *
 * ⚠ IT IS OFF THE MCP SURFACE, DELIBERATELY. No `dopl_channel` op reaches it and
 * the route is `sessionOnly` (§3), because "no destructive ops over MCP" is the
 * standing rule and an agent token that could delete a thread could erase the
 * exchange it was losing. The only caller is an operator clicking through a
 * confirm dialog.
 *
 * ⚠ SPLIT OUT OF `service-tasks.ts` rather than added to it: that file is CREATE
 * plus set-mode, and this is a cascade over five tables with an ordering
 * argument. Two reasons to change, two files (INVARIANTS §1) — the same seam
 * `service-tasks-broadcast.ts` sits on.
 */

/**
 * WHO MAY DELETE: the thread's CREATOR, or someone who can manage the channel
 * (its owner, or a workspace admin) — Samuel's ruling, 2026-08-21.
 *
 * ⚠ THE ADDRESSEE IS DELIBERATELY NOT ON THIS LIST, and that asymmetry is the
 * point. A thread's two parties may both POST in it (`isThreadParticipant`, §5),
 * because writing is what a shared exchange is for; DESTROYING the shared record
 * is not symmetric with contributing to it. The person who opened the thread can
 * withdraw it, and the room's managers can clean the room. Everyone else — the
 * addressee included — is refused, and their remedy is to ask.
 *
 * ⚠ MEMBERSHIP IS CHECKED FIRST, so a public channel's non-member reader (who
 * CAN read a pair's thread, §5) is refused before any thread row is loaded.
 */
/**
 * ⚠ EXPORTED SINCE 2026-08-26 SO A TEST CAN DRIVE IT, and that is the whole
 * reason: `home/server/guest-claim-f319-closure.test.ts` used to RE-IMPLEMENT
 * this two-line rule inline (`created_by === userId || canManageChannel(...)`)
 * and assert on its own copy, under a docblock claiming nothing was mocked. A
 * rewrite of the real function would have left that case green — F-319's
 * delete-thread hole would have re-opened with its own closure test passing.
 * §14: a pin that does not drive the real function is not a pin.
 */
export function assertMayDeleteThread(
  ctx: ChannelContext,
  task: { created_by: string },
  membership: Parameters<typeof canManageChannel>[1]
): void {
  if (task.created_by === ctx.userId) return;
  if (canManageChannel(ctx, membership)) return;
  throw new TaskForbiddenError("delete this thread");
}

/**
 * Hard-delete one thread and everything that hangs off it.
 *
 * THE CASCADE, IN ORDER — CHILDREN FIRST, THE THREAD ROW LAST. There is no
 * transaction around these statements (they are separate PostgREST calls), so the
 * order is chosen for what a FAILURE half-way through leaves behind. Every prefix
 * of this list is a thread with LESS hanging off it, which every reader already
 * copes with and which re-clicking Delete finishes. The reverse order is the one
 * that breaks reads: the task row going first nulls `channel_sessions.task_id`
 * (its FK is `ON DELETE SET NULL`) and strands every `metadata.taskId` message on
 * an id that resolves to nothing.
 *
 *   1. `channel_messages` tagged `metadata->>'taskId'` — the transcript. No FK
 *      links them to the thread, so this statement IS the cascade, and it hands
 *      back the seqs it removed. ⚠ `channel_mention_reads` rides along inside it:
 *      its `message_id` FK is `ON DELETE CASCADE` (`20260818140000`), which was
 *      VERIFIED rather than assumed — no migration was needed.
 *   2. `channel_consent_requests` still PENDING against one of those seqs — flipped
 *      to `expired`, never deleted. `repository-collab.ts ›
 *      expireConsentForMessageSeqs` carries the audit argument.
 *   3. `channel_sessions` targeting the thread, EVERY member's. They are
 *      projections of a live desktop registry, not owned state.
 *   4. `channel_task_participants` — dead code, but rows written before breakout
 *      rooms were removed still exist.
 *   5. `channel_tasks` — the row itself.
 *
 * ⚠ THE PEER'S RUNNING AGENT IS NOT REACHABLE FROM HERE AND THAT IS ACCEPTED
 * (Samuel, 2026-08-21). Step 3 removes the ROW that says a peer's agent is on this
 * thread; the agent itself lives in another operator's main process, which this
 * server cannot address, and it stops on its own idle/abandon timer. The
 * OPERATOR'S OWN agents are ended client-side before this call
 * (`components/channels-v2/thread-manage.tsx`), which is the only side that can.
 *
 * ⚠ THE DOORBELL IS `channel_messages`, AND IT HAD TO BE BOUGHT — 2026-08-22.
 * `channel_tasks` stays out of the publication (§7) and so does `channel_sessions`,
 * and the consent step UPDATEs rather than deletes, so step 1's DELETEs on
 * `channel_messages` are the ONLY event this cascade can ring with.
 *
 * ⚠ THIS BLOCK USED TO CLAIM THAT ALREADY WORKED, AND IT WAS FALSE. It read
 * "`channel_messages` … carries `workspace_id` under `REPLICA IDENTITY FULL`
 * (`20260807150000`)". That migration set `USING INDEX` (not FULL) on eleven
 * tables and named `channel_messages` on its EXEMPTION list — "cascade from
 * `channels` / `workspaces` only", which was true before threads could be deleted.
 * So the table was at `REPLICA IDENTITY DEFAULT`: a DELETE's WAL record was the
 * primary key alone, both subscribers' `workspace_id=eq.<id>` filter could never
 * match it, and every frame was dropped SERVER-SIDE. The counterparty's transcript
 * and thread list kept showing a thread that no longer existed until a manual
 * refetch, then 404'd on click — with no error anywhere. `20260822130000` gives the
 * table the identity; INVARIANTS §5 and §7 were corrected in the same change.
 *
 * A thread with no messages at all still rings nothing and is corrected by the
 * deleting client's own invalidate.
 */
export async function deleteTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string
): Promise<void> {
  const { channel, membership } = await requireMemberChannel(
    ctx,
    ref,
    "delete a thread in this channel"
  );
  // ⚠ Channel-scoped load: a thread that is not in THIS channel is a 404, so the
  // id cannot be probed across rooms (the same collapse `getChannelTask` makes).
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  assertMayDeleteThread(ctx, task, membership);

  const seqs = await repoMessages.deleteMessagesByThread(channel.id, task.id);
  await repoCollab.expireConsentForMessageSeqs(channel.id, seqs);
  await repoSessions.deleteSessionStatesForThread(
    ctx.workspaceId,
    channel.id,
    task.id
  );
  await repoTasks.deleteTaskParticipants(task.id);
  await repoTasks.deleteTask(channel.id, task.id);
}
