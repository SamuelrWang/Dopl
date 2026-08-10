import "server-only";
import type { ChannelThread, ThreadMode } from "../types";
import type { TaskCreateInput } from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskSelfTargetError,
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
 * First-class channel threads (v15): CREATE and SET MODE. Split out of
 * `service-writes.ts` (§2 cap) — a thread is its own lifecycle with its own
 * authorization rules (creator vs. target), and its transcript rides on
 * `postMessage` from the message lane.
 *
 * The other two thirds of that lifecycle have their own modules, each split off
 * at the same cap and each on a real seam:
 *   - `service-tasks-lifecycle.ts` — CLOSE and REOPEN, the two writes that move
 *     `status`, which now share a guard-then-echo shape (C-26 / C-30).
 *   - `service-tasks-propose.ts`   — PROPOSE a close, the agent's terminal act,
 *     which mutates nothing (DECISION 2).
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
 * and `toUserId` (the responder the task is addressed to) must be a member of
 * THAT channel AND an active workspace member (C-20 — a departed teammate stays
 * in `channel_members` but can never answer). The requester's initial request
 * (`body`) is posted
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
  // C-20: a thread target must be a channel member AND an ACTIVE workspace
  // member. `channel_members` is never swept on workspace-leave, so a departed
  // teammate stays addressable here — `create_thread` would succeed, the opening
  // message would post, `openingSeq` would return, the requester would arm the
  // `await`, and nothing would ever answer. Same predicate trust checks at
  // consumption (`trust-service.isTrustedRequester`). Fail closed with the
  // existing undeliverability error. Channel check first, so the workspace
  // round-trip is only paid for an actual channel member.
  if (
    !(
      (await repo.findMembership(channel.id, input.toUserId)) &&
      (await repo.isActiveWorkspaceMember(ctx.workspaceId, input.toUserId))
    )
  ) {
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
 * Change a task's mode. CREATOR ONLY — the mode governs the creator's own
 * machine (interactive vs autonomous continuation). Posts NO message: the
 * change is intentionally realtime-invisible and the badge is eventually
 * consistent on the next tasks refetch.
 *
 * THE ONE STATUS-ADJACENT WRITE THAT STAYS SILENT, and deliberately so: a mode is
 * the creator's own machine's business, not a fact about the shared exchange. The
 * two writes that ARE facts about it — close and reopen — moved to
 * `service-tasks-lifecycle.ts` and both echo (C-26).
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
