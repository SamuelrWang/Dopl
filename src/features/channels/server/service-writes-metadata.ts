import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelRow, ChannelTaskRow } from "./dto";
import { ChannelTaskNotInChannelError } from "./errors";
import * as repo from "./repository";
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
 * `taskTitle`, `taskTarget`) are ALWAYS stripped from caller metadata and
 * re-added only from server-validated values. `taskId` stays caller-settable.
 */

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
 */
export async function resolvePostMetadata(
  ctx: ChannelContext,
  channel: ChannelRow,
  input: ChannelMessageCreateInput
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  delete metadata.to_user_id;
  delete metadata.summary;

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

  return metadata;
}
