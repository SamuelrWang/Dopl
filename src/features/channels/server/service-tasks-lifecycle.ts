import "server-only";
import type { ChannelThread, ThreadOutcome } from "../types";
import {
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
  ThreadCloseIsHumanOnlyError,
} from "./errors";
import type { ChannelTaskRow } from "./dto";
import { mapTaskRow } from "./dto";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";

/**
 * Thread status transitions — close and reopen, the only writes that move
 * `channel_tasks.status`. Shared shape: guard the transition atomically, echo it
 * into the transcript, degrade honestly if the echo is lost.
 *
 * Server boundary — wire/storage name `task` == domain name `thread`. This lane
 * is STORAGE side, so it keeps the `task` spelling throughout.
 *
 * ⚠ WHY THESE ECHO AT ALL: `channel_tasks` is in NEITHER realtime table set —
 * not `constants.ts` `CHANNEL_TABLES` (web), not `main/ui-sync.js` `SYNC_TABLES`
 * (desktop). A row change reaches nobody's screen by itself; the marker post
 * rings the `channel_messages` doorbell and peers refetch behind it.
 *
 * ⚠ Do NOT "fix" this by publishing `channel_tasks` — the echo IS the fix. A
 * published table with no subscriber costs WAL decode + per-subscription RLS on
 * every write forever, and `channel_messages` is already subscribed by both.
 */

/**
 * Anchor the lifecycle echoes key on: the timestamp of the close they are about.
 * Falls back to `updated_at` for rows predating `closed_at` — a key that
 * silently collapses is worse than one off a second-best column.
 *
 * ⚠ Timestamp off the ROW, never a message-seq anchor: the echo is itself the
 * newest message in the thread the moment it lands, so a retried close/reopen
 * would read a MOVED anchor, compute a different key, and post the second echo
 * the key exists to prevent. (The sibling `closeProposalClientMsgId` keys on
 * activity seq only because a proposal mutates no state to point at.)
 *
 * Key moves when the situation genuinely changes — close → reopen → close writes
 * a new `closed_at` — and does NOT move on a retry.
 */
function closeAnchor(task: ChannelTaskRow): string {
  return task.closed_at ?? task.updated_at;
}

/**
 * Close echo's idempotency key — (thread, the close's own `closed_at`).
 * Belt and braces with {@link closeTask}'s guard: the guard settles the ROW, the
 * key settles the TRANSCRIPT.
 *
 * ⚠ THE OUTCOME IS DELIBERATELY NOT IN THE KEY. The case being deduplicated is
 * exactly the one where callers DISAGREE (A closes `completed`, B closes
 * `failed`); keying on outcome — as the close PROPOSAL legitimately does — gives
 * the racers different keys and lets both echoes through.
 */
export function closeEchoClientMsgId(taskId: string, closedAt: string): string {
  return `thread-closed-${taskId}-${closedAt}`;
}

/**
 * Reopen echo's idempotency key — (thread, the `closed_at` it undoes).
 *
 * ⚠ Must be computed BEFORE the update, which nulls the column.
 *
 * Cases: retried reopen short-circuits in {@link reopenTask} (row already open);
 * two concurrent reopens read the same `closed_at`, so the loser finds the
 * winner's echo by this key; a genuine later reopen is a different close and
 * therefore a different key, so it posts (a one-shot-forever key breaks that —
 * the C-6 regression in `propose_close`).
 */
export function reopenEchoClientMsgId(
  taskId: string,
  closedAt: string
): string {
  return `thread-reopened-${taskId}-${closedAt}`;
}

/**
 * Reopen echo body. Names the outcome it undid because the reopen destroys it —
 * `outcome` / `outcome_summary` are nulled to keep the `closed ⇔ outcome` CHECK
 * satisfied, so this line is the only surviving tie to that close.
 * Close SUMMARY deliberately not restated (already the close echo's own body).
 */
function reopenEchoBody(priorOutcome: ThreadOutcome | null): string {
  return priorOutcome
    ? `Thread reopened (was closed as ${priorOutcome}).`
    : "Thread reopened.";
}

/**
 * What `closeTask` hands back — mirror of `TaskCreateResult`'s `openingSeq`.
 *
 * The echo's seq rides along because a close writes a message, so every seq the
 * requester knew is now one short. Incident: a requester GUESSED the echo seq,
 * armed `await` past it, and silently skipped the peer's deliverable.
 *
 * ⚠ `null` when no echo landed (close succeeded, marker post did not). NEVER a
 * fabricated number — a caller getting null must find its cursor another way.
 */
export interface TaskCloseResult {
  thread: ChannelThread;
  echoSeq: number | null;
}

/** Shape of {@link TaskCloseResult}, same reason — a reopen writes a message
 *  too, so it moves the cursor the same way a close does. */
export interface TaskReopenResult {
  thread: ChannelThread;
  echoSeq: number | null;
}

/**
 * Close a task. Creator OR target (`created_by` / `target_user_id`), HUMAN LANE
 * ONLY — an agent-token caller is refused and told to propose instead
 * ({@link ThreadCloseIsHumanOnlyError}). Posts a lifecycle marker so the peer's
 * thread updates live: completed → `task_finished`, failed → `task_failed`.
 *
 * ⚠ FIRST CLOSE WINS — the update is `WHERE status = 'open'`
 * ({@link repoTasks.updateTaskIfStatus}). Unconditional, both parties could
 * close one thread with different outcomes and last-write-wins picked the
 * record.
 *
 * The loser gets a 200 naming the STORED outcome, deliberately not a 409:
 * retrying is documented behaviour here (an `echoSeq: null` caller has no
 * cursor), two people agreeing work is done is not an error, and
 * `use-thread-writes.ts` renders any failure as "Couldn't close the thread" over
 * a visibly closed thread. The no-op also returns the stored echo's seq via
 * {@link closeEchoClientMsgId}, so a retry recovers its cursor.
 */
export async function closeTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  outcome: ThreadOutcome,
  summary?: string
): Promise<TaskCloseResult> {
  // ⚠ Ahead of every lookup: refusing before the reads means an agent probing
  // for thread ids learns nothing from the shape of the error.
  if (ctx.source === "agent") throw new ThreadCloseIsHumanOnlyError();
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("close a task in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("close this task");
  }

  // `summary` is persisted on the row AND becomes the echo's body; absent or
  // blank, the echo keeps its default. Kind is unaffected.
  const updated = await repoTasks.updateTaskIfStatus(task.id, "open", {
    status: "closed",
    outcome,
    closed_at: new Date().toISOString(),
    // A blank/whitespace summary stores as null, not "" (render guards on null).
    outcome_summary: summary && summary.trim().length > 0 ? summary.trim() : null,
  });

  // Somebody closed it first (or our own retry). Nothing written; report what
  // stands. Docblock has why this is a 200.
  if (!updated) return alreadyClosed(channel.id, taskId);

  // ⚠ The close has ALREADY landed by the time the echo is written, so an echo
  // failure must NOT throw — that reports a close that did happen as a failure
  // and sends the caller to re-close. "Closed, no echo" is `echoSeq: null`.
  // Errors the close itself raises are all above this point.
  let echoSeq: number | null = null;
  try {
    const echo = await postMessage(
      ctx,
      channel.id,
      {
        body:
          (summary && summary.trim()) ||
          (outcome === "completed" ? "Task completed" : "Task failed"),
        kind: outcome === "completed" ? "task_finished" : "task_failed",
        summary: task.title,
        metadata: { taskId: task.id },
        // Keyed on the close this echo describes; {@link closeEchoClientMsgId}
        // has why the OUTCOME is not in the key.
        clientMsgId: closeEchoClientMsgId(task.id, closeAnchor(updated)),
      },
      // Exemption declared at the CALL SITE, never inferred from identity —
      // this echo is the SERVER speaking. See
      // `PostMessageOptions.internalLifecycle`.
      { internalLifecycle: true }
    );
    echoSeq = echo.seq;
  } catch {
    // Marker lost. The thread is closed; the peer's panel catches up on its
    // next tasks refetch instead of on a realtime marker.
  }

  return { thread: mapTaskRow(updated), echoSeq };
}

/**
 * No-op close: re-read the row that beat us and report IT, plus the seq of the
 * echo that close already posted. ⚠ The re-read is required — the row we hold
 * says `open` and is known stale. Empty re-read = deleted between statements →
 * 404.
 */
async function alreadyClosed(
  channelId: string,
  taskId: string
): Promise<TaskCloseResult> {
  const current = await repoTasks.findTaskByChannelAndId(channelId, taskId);
  if (!current) throw new TaskNotFoundError(taskId);
  const stored = await repoMessages.findMessageByClientId(
    channelId,
    closeEchoClientMsgId(taskId, closeAnchor(current))
  );
  return { thread: mapTaskRow(current), echoSeq: stored?.seq ?? null };
}

/**
 * Reopen a closed task. Creator OR target, mirroring {@link closeTask}'s authz.
 * Clears the closed state in ONE update — `status` → `open`, `outcome` /
 * `closed_at` / `outcome_summary` all nulled — keeping the `closed ⇔ outcome`
 * CHECK satisfied ((status='closed') = (outcome IS NOT NULL)).
 *
 * ⚠ THE ECHO KIND IS `task_progress`, NOT a lifecycle kind. Every part is
 * load-bearing:
 *  - No migration: `channel_messages.kind` has a CHECK over `message |
 *    task_started | task_progress | task_finished | task_failed | system`, so a
 *    `thread_reopened` kind is a schema change shipped ahead of every writer.
 *  - Cannot be mistaken for an ending: `groupThread` folds `task_finished` /
 *    `task_failed` into `draft.endEvent` and reads that as the outcome. A
 *    `task_progress` structurally cannot reach that slot.
 *  - `task_started` is WRONG here — it sets `draft.head` (card header identity
 *    and author become the reopener, not the opener) and opens `groupThread`'s
 *    single fallback window (a later untagged agent post folds into this card).
 *  - Renders with no client change: `splitSessionEntries` routes
 *    `task_progress` into the milestones lane. `system`, the other candidate,
 *    lands in NEITHER lane — an invisible marker is worse than none.
 *
 * Agent-reachable by design: no `source` check, PATCH route is not
 * `sessionOnly`. `task_progress` is not in `LIFECYCLE_KINDS`, so an
 * agent-triggered reopen goes through the ordinary guard with no exemption and
 * `postMessage` attributes it `authorKind: "agent"` off the caller's ctx.
 *
 * ⚠ Second reopen is a no-op success. Without the guard a retry computes its key
 * from a now-`null` `closed_at`, gets a DIFFERENT key, and posts the second echo
 * the key exists to prevent. `echoSeq` is null there — the anchor naming the
 * original echo was erased by the reopen that already won.
 */
export async function reopenTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string
): Promise<TaskReopenResult> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("reopen a task in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("reopen this task");
  }

  // Already open: write nothing, echo nothing, report the thread as it stands.
  if (task.status !== "closed") {
    return { thread: mapTaskRow(task), echoSeq: null };
  }

  // ⚠ Captured BEFORE the update, which erases both the anchor naming this
  // reopen and the outcome its body reports.
  const anchor = closeAnchor(task);
  const priorOutcome = (task.outcome as ThreadOutcome | null) ?? null;

  const updated = await repoTasks.updateTaskIfStatus(task.id, "closed", {
    status: "open",
    outcome: null,
    closed_at: null,
    outcome_summary: null,
  });

  // Lost a concurrent reopen. Nothing to write, but we still hold the anchor the
  // winner keyed on, so their echo is findable and the caller gets a real cursor.
  if (!updated) {
    const current = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
    if (!current) throw new TaskNotFoundError(taskId);
    const stored = await repoMessages.findMessageByClientId(
      channel.id,
      reopenEchoClientMsgId(taskId, anchor)
    );
    return { thread: mapTaskRow(current), echoSeq: stored?.seq ?? null };
  }

  // ⚠ Reopen has ALREADY landed — same contract as {@link closeTask}. An echo
  // failure degrades to `echoSeq: null` and NEVER throws.
  let echoSeq: number | null = null;
  try {
    const echo = await postMessage(
      ctx,
      channel.id,
      {
        body: reopenEchoBody(priorOutcome),
        kind: "task_progress",
        summary: task.title,
        metadata: { taskId: task.id },
        clientMsgId: reopenEchoClientMsgId(task.id, anchor),
      },
      // ⚠ RESERVED marker key — stripped from any caller's metadata and
      // re-stamped only here, so nothing on the wire can paint somebody else's
      // settled thread as live again.
      { reopened: true }
    );
    echoSeq = echo.seq;
  } catch {
    // Marker lost. Thread is open; peer's panel catches up on its next tasks
    // refetch.
  }

  return { thread: mapTaskRow(updated), echoSeq };
}
