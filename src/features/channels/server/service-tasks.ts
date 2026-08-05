import "server-only";
import type { ChannelThread, ThreadMode, ThreadOutcome } from "../types";
import type { TaskCreateInput } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskSelfTargetError,
  ThreadCloseIsHumanOnlyError,
} from "./errors";
import type { ChannelTaskRow } from "./dto";
import { mapTaskRow } from "./dto";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import {
  loadVisibleChannel,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * First-class channel threads (v15): create / close / set mode / reopen. Split
 * out of `service-writes.ts` (§2 cap) — a thread is its own lifecycle with its
 * own authorization rules (creator vs. target), and its transcript rides on
 * `postMessage` from the message lane.
 *
 * THE SERVER BOUNDARY: wire/storage name `task` == domain name `thread`. This
 * lane sits on the STORAGE side, so it deliberately keeps the `task` spelling
 * throughout — the `channel_tasks` table and its columns, `metadata.taskId`,
 * the request schemas, the error codes, and the `/tasks` route paths. It
 * returns {@link ChannelThread} values, and everything a human or an agent
 * reads (the web UI, the `dopl_channel` MCP ops) says `thread`.
 */

/**
 * The initiating request's idempotency key, derived from the task id. The task
 * row and its opening message are two writes with no transaction around them,
 * so the key is what makes the PAIR converge: whichever attempt gets there
 * posts, every later one dedups on `channel_messages_client_msg_key`. See
 * {@link postOpeningMessage}.
 */
function openingMessageClientId(taskId: string): string {
  return `task-open-${taskId}`;
}

/**
 * Post (or re-post) a task's initiating request — EXACTLY ONCE per task, on
 * every path that returns that task.
 *
 * Why this exists: `create_task` used to insert the row and then post the
 * request as a separate, unguarded step. If the insert landed and the post
 * threw (a transient DB error, an addressee removed mid-flight, a CHECK
 * failure), the retry hit the `client_msg_id` short-circuit, returned the
 * stored task and NEVER posted — leaving a thread that exists in the panel
 * with no message for the responder's desktop to route, so no session ever
 * spawned. The idempotency key permanently swallowed the request.
 *
 * The fix keeps both writes in the SAME idempotency envelope instead of
 * moving them into one RPC: `postMessage` owns the addressee check, the DM
 * auto-address, the reserved-key strip and the task-key stamping, and forking
 * that logic into PL/pgSQL would give the metadata contract two homes. So the
 * message gets its own deterministic key (`task-open-<taskId>`), the post is
 * re-driven on every create path, and `postMessage`'s own idempotency
 * (findMessageByClientId → the unique index) collapses the repeats.
 *
 * Fields come from the STORED task row, never the retry's input, so a re-send
 * cannot rewrite the title or re-address the request.
 */
async function postOpeningMessage(
  ctx: ChannelContext,
  channelId: string,
  task: { id: string; title: string; target_user_id: string | null },
  body: string,
  // SPAWN-WITH-HANDOFF (rollback §3.5). When the create declared it, the opener
  // carries the reserved `metadata.handoff` stamp so the OPERATOR'S desktop
  // opens the requester session rather than leaving it with the external
  // session that posted the create. Server-internal only — see
  // `PostMessageOptions.handoff`.
  handoff?: boolean
): Promise<number> {
  const message = await postMessage(
    ctx,
    channelId,
    {
      body,
      kind: "message",
      toUserId: task.target_user_id ?? undefined,
      summary: task.title,
      metadata: { taskId: task.id },
      clientMsgId: openingMessageClientId(task.id),
    },
    { handoff }
  );
  // The seq travels back out (WAKE-V1): it is the requester's `await` cursor,
  // and it is only known here. Every return path above is idempotent, so a
  // dedup'd re-post yields the STORED message — the same seq, never a new one.
  return message.seq;
}

/**
 * The seq of a thread's opening message as ALREADY STORED — a pure READ of the
 * derived key, never a post.
 *
 * This is what a caller that converged on SOMEONE ELSE's thread gets instead of
 * a re-post. It used to get `null`, which was honest but useless: a caller that
 * lost an open race held the right thread id and no cursor, so its only way to
 * arm `await` was `read limit=1` — the exact round-trip-and-race WAKE-V1
 * removed, and one that mis-fires precisely when the winner has already said
 * something.
 *
 * Reading is safe where posting is not: the opening message is in a channel the
 * caller is a member of and would come back from an ordinary `read`. What must
 * not happen is the loser POSTING into the winner's thread, and it does not.
 *
 * Still `null` when there is genuinely no stored opening message (the winner
 * crashed between its insert and its post). Never a fabricated number — a
 * caller with no cursor must find one another way rather than arm one on a
 * guess, which is the failure this field exists to prevent.
 */
async function storedOpeningSeq(
  channelId: string,
  taskId: string
): Promise<number | null> {
  const stored = await repoMessages.findMessageByClientId(
    channelId,
    openingMessageClientId(taskId)
  );
  return stored?.seq ?? null;
}

/**
 * What `createTask` hands back: the thread, plus the seq of its opening message
 * — the cursor a requester passes straight to `dopl_channel(op="await")`.
 *
 * WHY THE SEQ RIDES ALONG (WAKE-V1): without it the requester had to call
 * `read limit=1` to learn where to start watching, which is an extra round-trip
 * AND a race — a peer that answers between the create and that read makes the
 * "newest message" its reply, so the await starts one message too late and the
 * requester waits forever for something already delivered.
 *
 * `null` only when no opening message exists to name: the creator re-posts its
 * own (idempotently), and a caller that converged on someone else's thread READS
 * that thread's stored opening seq — see {@link storedOpeningSeq}.
 */
export interface TaskCreateResult {
  thread: ChannelThread;
  openingSeq: number | null;
}

/**
 * Finish a create that landed on an EXISTING thread — the `client_msg_id`
 * short-circuit and the lost-insert race, which are the same situation reached
 * two ways and must therefore answer identically.
 *
 * THE CALLER GETS THE STORED THREAD, always. Not an error, not a second row: a
 * retry of one's own create has to come away holding the thread it already
 * opened.
 *
 * What differs is what it may WRITE. **The creator** re-drives its opening post,
 * because that is the repair for a create that half-landed (the row inserted,
 * the message did not). **Anyone else** posts NOTHING and only READS the stored
 * opening seq: a colliding key from another member must not put a message into
 * their thread.
 *
 * The other-caller branch used to be load-bearing for the TWO-AGENT HANDSHAKE —
 * two agents addressed by one instruction both called `create_thread` with a
 * derived `thread-open-<channel>-<seq>` key and collapsed onto one thread, with
 * a server-derived participant set making that thread writable by the loser.
 * Addressing is gone (rollback §1), so nothing manufactures a shared key any
 * more; the branch stays because a plain `client_msg_id` collision between two
 * members is still possible and still must not cross-post.
 */
async function convergeOnThread(
  ctx: ChannelContext,
  channelId: string,
  task: ChannelTaskRow,
  input: TaskCreateInput
): Promise<TaskCreateResult> {
  const isCreator = task.created_by === ctx.userId;
  const openingSeq = isCreator
    ? await postOpeningMessage(ctx, channelId, task, input.body, input.handoff)
    : await storedOpeningSeq(channelId, task.id);
  return { thread: mapTaskRow(task), openingSeq };
}

/**
 * Create a first-class task in a channel. The caller must be a channel member
 * and `toUserId` (the responder the task is addressed to) must be an active
 * member of THAT channel. The requester's initial request (`body`) is posted
 * as the task's first message, tagged `metadata.taskId` so it groups into the
 * task card and the server stamps the reserved task keys onto it.
 *
 * A thread is between its CREATOR and its TARGET, and that pair is the whole
 * write gate (`service-writes-metadata-thread.ts`). It used to be able to carry
 * a wider participant set — a BREAKOUT ROOM, seeded from `input.participants`
 * and from a handshake `client_msg_id` — and both are gone with the addressing
 * that made them necessary (rollback §1).
 */
export async function createTask(
  ctx: ChannelContext,
  ref: string,
  rawInput: TaskCreateInput
): Promise<TaskCreateResult> {
  const input = stripNulDeep(rawInput);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("create a task in this channel");
  }
  if (!(await repo.findMembership(channel.id, input.toUserId))) {
    throw new ChannelAddresseeNotMemberError(input.toUserId);
  }
  // A thread addressed to its own creator is DEAD ON ARRIVAL: only the creator
  // and the target may post into it, and here they are the same person, so the
  // one member allowed to answer is the one who asked. It was accepted silently
  // — the panel rendered a live request "addressed to <caller>", the peer's
  // desktop logged `verdict ignore`, and nothing ever came. The web composer
  // already filters the caller out of its address picker
  // (`components/address-picker.tsx`), so this guard regresses no UI path; it
  // closes the agent path, where `to` is whatever user id the model resolved
  // (an agent on a session with two dopl connections self-addressed one live).
  //
  // IT SITS BEFORE THE IDEMPOTENCY SHORT-CIRCUIT ON PURPOSE. Behind it, a retry
  // carrying the same `client_msg_id` would find the stored dead thread and
  // return it as a success, so the caller would be told the thread is fine
  // exactly once it is unfixable. In front, every attempt errors identically.
  if (input.toUserId === ctx.userId) {
    throw new TaskSelfTargetError();
  }

  // Idempotency: a re-sent client_msg_id returns the already-created task
  // WITHOUT inserting a second row. Whether the caller may then re-drive the
  // opening post depends on whether the caller IS that thread's creator; see
  // {@link convergeOnThread}, which is also the 23505 branch's answer so the
  // two ways of losing a race cannot drift apart.
  if (input.clientMsgId) {
    const existing = await repoTasks.findTaskByClientId(
      channel.id,
      input.clientMsgId
    );
    if (existing) return convergeOnThread(ctx, channel.id, existing, input);
  }

  let task;
  try {
    task = await repoTasks.insertTask({
      channel_id: channel.id,
      workspace_id: ctx.workspaceId,
      title: input.title,
      mode: input.mode ?? "interactive",
      created_by: ctx.userId,
      target_user_id: input.toUserId,
      client_msg_id: input.clientMsgId ?? null,
    });
  } catch (err) {
    // Lost an idempotency race — converge on the stored winner. Re-driving the
    // post here is safe (same derived key as the winner's own call, so at most
    // one message lands) and covers the winner having crashed before posting.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientMsgId) {
      const raced = await repoTasks.findTaskByClientId(
        channel.id,
        input.clientMsgId
      );
      if (raced) return convergeOnThread(ctx, channel.id, raced, input);
    }
    throw err;
  }

  const openingSeq = await postOpeningMessage(
    ctx,
    channel.id,
    task,
    input.body,
    input.handoff
  );

  return { thread: mapTaskRow(task), openingSeq };
}

/**
 * What `closeTask` hands back: the closed thread, plus the seq of the lifecycle
 * echo it posted — the mirror of {@link TaskCreateResult}'s `openingSeq`.
 *
 * WHY THE SEQ RIDES ALONG: a close writes a message into the transcript, so
 * every seq the requester knew is now one short. Live incident: a requester
 * closed a thread, GUESSED the echo's seq, armed `await` one past that guess,
 * and silently skipped the peer's actual deliverable — the reply was already
 * below the cursor, so the hold waited for something that had arrived. The
 * echo's seq is only known here; returning it removes the guess.
 *
 * `null` when no echo landed — the close itself succeeded but the marker post
 * did not (see {@link closeTask}). Never a fabricated number: a caller that
 * gets null must find its cursor another way rather than arm one on a guess,
 * which is the failure this field exists to prevent.
 */
export interface TaskCloseResult {
  thread: ChannelThread;
  echoSeq: number | null;
}

/**
 * Close a task with an outcome. Permitted for the task's creator OR its target
 * (`created_by` / `target_user_id`) — and, since 2026-08-04, only on the HUMAN
 * lane: an agent-token caller is refused and told to propose instead (see
 * {@link ThreadCloseIsHumanOnlyError}). Posts a lifecycle marker so the other
 * member's thread updates live: completed -> `task_finished` (calm "done");
 * failed -> `task_failed` (a close with outcome=failed IS a genuine failure).
 */
export async function closeTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  outcome: ThreadOutcome,
  summary?: string
): Promise<TaskCloseResult> {
  // FIRST, ahead of every lookup: a refusal about WHO is asking needs nothing
  // else resolved, and refusing before the reads means an agent probing for
  // thread ids learns nothing from the shape of the error either.
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

  // A caller-supplied `summary` (a one-line outcome) is persisted on the task
  // row AND becomes the lifecycle echo's body; absent (or blank), the echo
  // keeps its calm default. The kind (task_finished/task_failed) is unchanged.
  const updated = await repoTasks.updateTask(task.id, {
    status: "closed",
    outcome,
    closed_at: new Date().toISOString(),
    // A blank/whitespace summary stores as null, not "" (render guards on null).
    outcome_summary: summary && summary.trim().length > 0 ? summary.trim() : null,
  });

  // THE CLOSE HAS ALREADY LANDED by the time the echo is written — the row is
  // closed whether or not the marker posts. Letting the echo's failure throw
  // would report a close that did not happen, and the caller's retry would
  // re-close an already-closed thread; the honest report is "closed, no echo",
  // which `echoSeq: null` says exactly. Every error the close ITSELF can raise
  // (not a member, not creator/target, unknown task) is untouched above.
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
      },
      // P0-2 — THE ONE EXEMPTION, and it is stated at the call site rather than
      // inferred from identity. This echo is the SERVER speaking about a close
      // that just landed, and it is raised inside whatever request asked for the
      // close: on the human lane that is a cookie session, but nothing stops a
      // future internal caller arriving with an agent ctx, and the guard must
      // not depend on which. `postMessage` accepts this option from server code
      // only — it is not a field of `ChannelMessageCreateInput` and no route
      // parses it — so an HTTP caller can never set it.
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
 * Change a task's mode. CREATOR ONLY — the mode governs the creator's own
 * machine (interactive vs autonomous continuation). Posts NO message: the
 * change is intentionally realtime-invisible and the badge is eventually
 * consistent on the next tasks refetch.
 */
export async function setTaskMode(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  mode: ThreadMode
): Promise<ChannelThread> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("change a task's mode in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId) {
    throw new TaskForbiddenError("set the mode of this task");
  }

  const updated = await repoTasks.updateTask(task.id, { mode });
  return mapTaskRow(updated);
}

/**
 * Reopen a closed task. WEB-ONLY (no MCP op — agents do not reopen). Permitted
 * for the task's creator OR its target (`created_by` / `target_user_id`),
 * mirroring {@link closeTask}'s authorization. Clears the closed state in a
 * single update — `status` back to `open`, and `outcome` / `closed_at` /
 * `outcome_summary` all nulled — which keeps the `closed ⇔ outcome` CHECK
 * satisfied ((status='closed') = (outcome IS NOT NULL)). Posts NO lifecycle
 * echo: the web overlay flips the card back to `active` on the next tasks
 * refetch, so no `task_*` marker is needed (and none would be coherent).
 */
export async function reopenTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string
): Promise<ChannelThread> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("reopen a task in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("reopen this task");
  }

  const updated = await repoTasks.updateTask(task.id, {
    status: "open",
    outcome: null,
    closed_at: null,
    outcome_summary: null,
  });
  return mapTaskRow(updated);
}
