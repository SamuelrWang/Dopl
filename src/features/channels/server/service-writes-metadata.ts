import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { parseLegacyTaskSeq } from "../lib/group-thread";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelRow, ChannelTaskRow } from "./dto";
import { ChannelTaskNotInChannelError, TaskForbiddenError } from "./errors";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import type { ChannelContext } from "./service-shared";

/**
 * The ONE place that decides what lands in `channel_messages.metadata`. Split
 * out of `service-writes.ts` (§2 cap) because it is its own reason to change:
 * the reserved-key anti-spoof fold, DM auto-addressing, and the task-key
 * stamping all answer the same question — what may a caller put in metadata,
 * and what does the server stamp itself.
 *
 * Reserved keys (`to_user_id`, `summary`, `taskMode`, `taskCreatedBy`,
 * `taskTitle`, `taskTarget`, and the five calm-terminal flags) are ALWAYS
 * stripped from caller metadata and re-added only from server-validated
 * values. `taskId` stays caller-settable — but a first-class thread id now
 * also has to BELONG to the poster (see {@link resolvePostMetadata}).
 */

/**
 * The calm-terminal flags a `task_failed` may carry (`declined`, `dropped`,
 * `interrupted`, `capped`, `ended` — see `lib/group-thread.ts`). They decide
 * whether the other side's card reads as a calm, operator-chosen ending or a
 * red failure, and the message receipt shows Declined / Interrupted off the
 * same bits. Reserved, because a member who could set them on someone else's
 * thread could fabricate that thread's outcome ("This request was declined.")
 * without ever touching the session it describes.
 */
const CALM_FLAG_KEYS = [
  "declined",
  "dropped",
  "interrupted",
  "capped",
  "ended",
] as const;

/**
 * The other member of a DIRECT channel, or undefined when it cannot be
 * resolved unambiguously. A DM is exactly two members (enforced when it opens,
 * immutable afterwards), so any other shape — a torn-down roster, an
 * unexpected third row — is ambiguous and resolves to nothing rather than
 * guessing at an addressee. The peer is read OFF the channel roster, the same
 * table the explicit `to` path validates against, so an auto-addressed peer
 * satisfies the v1.1 addressee-is-an-active-member rule by construction.
 */
async function resolveDirectPeer(
  channel: ChannelRow,
  authorUserId: string
): Promise<string | undefined> {
  if (!channel.is_direct) return undefined;
  const members = await repo.listMembers(channel.id);
  if (members.length !== 2) return undefined;
  const peers = members.filter((m) => m.user_id !== authorUserId);
  if (peers.length !== 1) return undefined;
  return peers[0].user_id;
}

/**
 * The single OPEN task of a direct channel whose two participants are exactly
 * {author, peer}, or null. Deliberately all-or-nothing: with 0 candidates
 * there is nothing to thread into, and with 2+ the reply could belong to
 * either, so guessing would attach a turn to the wrong task card (and route it
 * to the wrong session window on the peer's machine).
 */
async function resolveInheritableTask(
  channel: ChannelRow,
  authorUserId: string,
  peerUserId: string
): Promise<ChannelTaskRow | null> {
  const tasks = await repoTasks.listTasksByChannel(channel.id);
  const candidates = tasks.filter(
    (task) =>
      task.status === "open" &&
      ((task.created_by === authorUserId &&
        task.target_user_id === peerUserId) ||
        (task.created_by === peerUserId &&
          task.target_user_id === authorUserId))
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Strip every calm-terminal flag from caller metadata and report which ones
 * were asked for. Only a literal `true` counts — a truthy-but-not-true value
 * (`"yes"`, `1`) is dropped and never re-stamped, so the wire can only ever
 * carry the strict booleans the renderers read (`=== true`).
 */
function takeCalmFlags(
  metadata: Record<string, unknown>
): Array<(typeof CALM_FLAG_KEYS)[number]> {
  const requested: Array<(typeof CALM_FLAG_KEYS)[number]> = [];
  for (const key of CALM_FLAG_KEYS) {
    if (metadata[key] === true) requested.push(key);
    delete metadata[key];
  }
  return requested;
}

/** The two people a first-class thread belongs to (creator + addressee). */
function isThreadParticipant(task: ChannelTaskRow, userId: string): boolean {
  return task.created_by === userId || task.target_user_id === userId;
}

/**
 * Whether `userId` is one of the two participants of a LEGACY
 * `task-{channelId}-{seq}` exchange. A legacy session has no `channel_tasks`
 * row, so the only server-side record of who it belongs to is its opening
 * request: the message at that seq, whose author is the requester and whose
 * `metadata.to_user_id` is the responder — exactly the pair `groupThread`
 * joins on. Fails CLOSED (unknown id shape, missing opener, or an
 * unaddressed opener → not a participant).
 */
async function isLegacyThreadParticipant(
  channelId: string,
  taskId: string,
  userId: string
): Promise<boolean> {
  const seq = parseLegacyTaskSeq(taskId, channelId);
  if (seq === null) return false;
  const opener = await repoMessages.findMessageBySeq(channelId, seq);
  if (!opener) return false;
  if (opener.author_user_id === userId) return true;
  const meta = (opener.metadata ?? {}) as Record<string, unknown>;
  return meta.to_user_id === userId;
}

/**
 * Build the stored `metadata` for a post. `input.toUserId` must ALREADY have
 * passed the addressee-is-a-channel-member check (the caller runs it, so a bad
 * addressee 400s before the idempotency short-circuit).
 *
 * Three server-owned folds, in order:
 *
 * 1. **Anti-spoof strip (v1.1).** `to_user_id` / `summary` are settable ONLY
 *    via the validated top-level fields: a raw metadata copy would bypass both
 *    the addressee-membership check and the schema's summary length cap
 *    (consent-prompt spoofing on non-members).
 * 2. **DM auto-address.** In a DIRECT channel with no caller `to`, the peer is
 *    stamped as `to_user_id`. The MCP `post` path could not be relied on to
 *    pass `to`, and an UNADDRESSED agent message is deliberately ignorable on
 *    the receiving desktop (the v1.3.1 loop brake) — so a legitimate DM reply
 *    was posted successfully and then never delivered. Addressing is what the
 *    web composer already does for a DM (v1.6); doing it server-side means the
 *    model cannot forget the parameter. NEVER auto-addressed in a non-direct
 *    channel: with 3+ members the intended recipient is ambiguous, and a wrong
 *    guess would prompt the wrong operator.
 * 3. **Task keys.** The reserved four are stripped and re-stamped from the
 *    resolved task row, so `taskMode` reflects the latest `set_task_mode` and
 *    cannot be spoofed. `taskId` itself stays caller-settable (a responder
 *    legitimately replies within a task); a UUID that resolves to no task in
 *    THIS channel is rejected (v1.7 server-validated threading), while a
 *    legacy `task-<uuid>-<seq>` id is not a UUID, never resolves, and stamps
 *    nothing. A caller-supplied taskId also SUPPRESSES inheritance — an
 *    explicit thread (or an explicit legacy id) is the caller's decision.
 *    Inheritance only fires for a plain `message` in a DM addressed to the
 *    peer: it exists so a session reply reaches the requester's waiting window
 *    (the desktop routes by taskId), and stamping a task id onto a lifecycle
 *    marker would let an unrelated `task_failed` land on that task's card.
 * 4. **Thread participation (v2.9).** Resolving in this channel is not enough:
 *    in a 3+ member channel every member can read every thread id, and a
 *    stamped `taskId` is what puts a message inside that thread's card AND
 *    routes it to the responder's session window. So a caller-supplied
 *    first-class id must belong to the poster (`created_by` / `target_user_id`)
 *    — otherwise the post is REFUSED (403), not silently unthreaded: a message
 *    the author believes landed in a thread and the recipient never sees is the
 *    invisible-delivery failure this whole feature exists to prevent. Closing
 *    and reopening were already gated this way; writing into a thread now is
 *    too. Inherited ids need no check — inheritance only resolves a task whose
 *    participants are {author, peer} by construction.
 * 5. **Calm-terminal flags (v2.9).** Stripped like any reserved key and
 *    re-stamped only for a thread participant: the first-class case is already
 *    covered by (4), and a legacy `task-{channel}-{seq}` id (no task row, but
 *    the shape the installed desktop still posts most of its lifecycle events
 *    with) is checked against its opening request's {author, to_user_id} pair.
 *    A flag on a thread that is not the poster's is dropped, so the victim's
 *    card keeps rendering the outcome its OWN session produced.
 */
export async function resolvePostMetadata(
  ctx: ChannelContext,
  channel: ChannelRow,
  input: ChannelMessageCreateInput
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  delete metadata.to_user_id;
  delete metadata.summary;
  const calmFlags = takeCalmFlags(metadata);

  const peerUserId = await resolveDirectPeer(channel, ctx.userId);
  const toUserId = input.toUserId ?? peerUserId;
  if (toUserId) metadata.to_user_id = toUserId;
  if (input.summary) metadata.summary = input.summary;

  delete metadata.taskMode;
  delete metadata.taskCreatedBy;
  delete metadata.taskTitle;
  delete metadata.taskTarget;

  const callerTaskId =
    typeof metadata.taskId === "string" && metadata.taskId.trim().length > 0
      ? metadata.taskId
      : undefined;

  let task: ChannelTaskRow | null = null;
  if (callerTaskId) {
    if (isUuid(callerTaskId)) {
      task = await repoTasks.findTaskByChannelAndId(channel.id, callerTaskId);
      if (!task) throw new ChannelTaskNotInChannelError(callerTaskId);
      // Membership in the channel is not membership in the THREAD.
      if (!isThreadParticipant(task, ctx.userId)) {
        throw new TaskForbiddenError("post into this task");
      }
    }
  } else if (
    peerUserId &&
    toUserId === peerUserId &&
    (input.kind ?? "message") === "message"
  ) {
    task = await resolveInheritableTask(channel, ctx.userId, peerUserId);
    if (task) metadata.taskId = task.id;
  }

  if (task) {
    metadata.taskMode = task.mode;
    metadata.taskCreatedBy = task.created_by;
    metadata.taskTitle = task.title;
    // A null target (an unaddressed task) stamps nothing — the desktop's
    // suppression predicate then cannot match and falls through to the
    // trigger rules.
    if (task.target_user_id) metadata.taskTarget = task.target_user_id;
  }

  // Re-stamp the calm-terminal flags only for the thread's own participants. A
  // resolved first-class task already passed the participation gate above; a
  // legacy id is checked against its opening request's pair. Anything else
  // (a foreign thread, an unresolvable id, no thread at all) keeps the strip.
  if (calmFlags.length > 0) {
    const mayStamp =
      task !== null ||
      (callerTaskId !== undefined &&
        (await isLegacyThreadParticipant(
          channel.id,
          callerTaskId,
          ctx.userId
        )));
    if (mayStamp) {
      for (const key of calmFlags) metadata[key] = true;
    }
  }

  return metadata;
}
