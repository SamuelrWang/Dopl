import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { slugify } from "@/shared/lib/slug/slugify";
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelTask,
  TaskMode,
  TaskOutcome,
} from "../types";
import type {
  ChannelCreateInput,
  ChannelMessageCreateInput,
  ChannelUpdateInput,
  TaskCreateInput,
} from "../schema";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
  ChannelInviteeNotMemberError,
  ChannelLastOwnerError,
  ChannelMemberExistsError,
  ChannelSlugConflictError,
  DirectChannelImmutableError,
  DirectSelfTargetError,
  TaskForbiddenError,
  TaskNotFoundError,
} from "./errors";
import type { AgentToolProfile, NotifyScope } from "../types";
import { mapMemberRow, mapMessageRow, mapTaskRow } from "./dto";
import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import { getChannel } from "./service-reads";
import {
  canManageChannel,
  loadVisibleChannel,
  profilesById,
  stripNulDeep,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * Write-side channels service: create, header update (incl. archive),
 * soft-delete, post message / activity event, and membership add / remove.
 * Every mutation re-checks the channel-scoped gate (member to post, owner
 * or workspace admin to manage) — the route-level `minRole` is only the
 * workspace floor.
 */

// ─── Channel lifecycle ──────────────────────────────────────────────

export async function createChannel(
  ctx: ChannelContext,
  input: ChannelCreateInput
): Promise<Channel> {
  if (input.direct === true) {
    return createDirectChannel(ctx, input.memberUserId);
  }
  const clean = stripNulDeep(input);
  const taken = await repo.existingSlugs(ctx.workspaceId);
  const slug = slugify(clean.slug ?? clean.name, "channel", taken);

  let channel;
  try {
    channel = await repo.insertChannel({
      workspace_id: ctx.workspaceId,
      created_by: ctx.userId,
      slug,
      name: clean.name,
      topic: clean.topic ?? "",
      visibility: clean.visibility ?? "private",
    });
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChannelSlugConflictError(slug);
    }
    throw err;
  }

  // The creator is the channel owner.
  await repo.insertMember({
    channel_id: channel.id,
    user_id: ctx.userId,
    workspace_id: ctx.workspaceId,
    role: "owner",
    added_by: ctx.userId,
  });

  return getChannel(ctx, channel.id);
}

/**
 * Open (or dedup-return) a direct (1:1) channel with `memberUserId`. The
 * `direct_key` is the two user-ids sorted and joined ':'; a lookup by
 * (workspace, direct_key) makes repeat opens idempotent ("open existing"). The
 * peer must be an active workspace member, a self-DM is refused, and exactly
 * two members are inserted (membership-of-2 lives here — a CHECK can't count).
 */
async function createDirectChannel(
  ctx: ChannelContext,
  memberUserId: string
): Promise<Channel> {
  if (memberUserId === ctx.userId) {
    throw new DirectSelfTargetError();
  }
  if (!(await repo.isActiveWorkspaceMember(ctx.workspaceId, memberUserId))) {
    throw new ChannelInviteeNotMemberError(memberUserId);
  }

  const directKey = [ctx.userId, memberUserId].sort().join(":");
  // Idempotent open. Look up INCLUDING soft-deleted rows: the partial unique
  // index counts a soft-deleted DM, so a fresh insert for a deleted pair would
  // 23505. A live row is returned as-is (dedup); a soft-deleted row is REVIVED
  // — un-hidden and its two member rows restored — so the same conversation
  // (and its history) reopens. A DM delete is "hide until reopened".
  const existing = await repo.findDirectChannelAnyStatus(
    ctx.workspaceId,
    directKey
  );
  if (existing) {
    if (existing.deleted_at) {
      await repo.reviveChannel(ctx.workspaceId, existing.id);
      await ensureDirectMember(ctx, existing.id, ctx.userId, "owner");
      await ensureDirectMember(ctx, existing.id, memberUserId, "member");
    }
    return getChannel(ctx, existing.id);
  }

  const taken = await repo.existingSlugs(ctx.workspaceId);
  const slug = slugify("direct-message", "dm", taken);

  let channel;
  try {
    channel = await repo.insertChannel({
      workspace_id: ctx.workspaceId,
      created_by: ctx.userId,
      slug,
      // Stored but ignored by the DM UI (it renders the peer). NOT NULL / CHECK
      // still require a non-empty name.
      name: "Direct message",
      topic: "",
      visibility: "private",
      is_direct: true,
      direct_key: directKey,
    });
  } catch (err) {
    // A concurrent open collides on the partial unique index — converge on the
    // existing row instead of surfacing the race.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      const raced = await repo.findDirectChannel(ctx.workspaceId, directKey);
      if (raced) return getChannel(ctx, raced.id);
    }
    throw err;
  }

  await repo.insertMember({
    channel_id: channel.id,
    user_id: ctx.userId,
    workspace_id: ctx.workspaceId,
    role: "owner",
    added_by: ctx.userId,
  });
  await repo.insertMember({
    channel_id: channel.id,
    user_id: memberUserId,
    workspace_id: ctx.workspaceId,
    role: "member",
    added_by: ctx.userId,
  });

  return getChannel(ctx, channel.id);
}

/**
 * Restore one member of a revived direct channel. A soft-delete leaves the
 * `channel_members` rows in place, but be robust to a partially torn-down DM:
 * re-insert only the row that went missing, with its original role.
 */
async function ensureDirectMember(
  ctx: ChannelContext,
  channelId: string,
  userId: string,
  role: "owner" | "member"
): Promise<void> {
  if (await repo.findMembership(channelId, userId)) return;
  await repo.insertMember({
    channel_id: channelId,
    user_id: userId,
    workspace_id: ctx.workspaceId,
    role,
    added_by: ctx.userId,
  });
}

export async function updateChannel(
  ctx: ChannelContext,
  ref: string,
  rawPatch: ChannelUpdateInput
): Promise<Channel> {
  const patch = stripNulDeep(rawPatch);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!canManageChannel(ctx, membership)) {
    throw new ChannelForbiddenError("manage this channel");
  }
  // A DM is always private (DB CHECK). Reject a visibility change here so it
  // returns a clean 400 instead of surfacing the raw CHECK-constraint 500.
  if (channel.is_direct && patch.visibility !== undefined) {
    throw new DirectChannelImmutableError("visibility");
  }

  const dbPatch: Parameters<typeof repo.updateChannel>[2] = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.topic !== undefined) dbPatch.topic = patch.topic;
  if (patch.visibility !== undefined) dbPatch.visibility = patch.visibility;
  if (patch.archived !== undefined) {
    dbPatch.archived_at = patch.archived ? new Date().toISOString() : null;
  }

  await repo.updateChannel(ctx.workspaceId, channel.id, dbPatch);
  return getChannel(ctx, channel.id);
}

/** Soft-delete: hide from active reads, keep the row (`deleted_at`). */
export async function deleteChannel(
  ctx: ChannelContext,
  ref: string
): Promise<void> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!canManageChannel(ctx, membership)) {
    throw new ChannelForbiddenError("delete this channel");
  }
  await repo.softDeleteChannel(ctx.workspaceId, channel.id);
}

// ─── Messages ───────────────────────────────────────────────────────

export async function postMessage(
  ctx: ChannelContext,
  ref: string,
  rawInput: ChannelMessageCreateInput
): Promise<ChannelMessage> {
  const input = stripNulDeep(rawInput);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("post to this channel");
  }

  // Addressing (v1.1): a `toUserId` must name an actual channel member —
  // otherwise the message would target a listener that will never see it.
  if (input.toUserId && !(await repo.findMembership(channel.id, input.toUserId))) {
    throw new ChannelAddresseeNotMemberError(input.toUserId);
  }

  // Idempotency: a re-sent client_msg_id returns the stored message.
  if (input.clientMsgId) {
    const existing = await repo.findMessageByClientId(channel.id, input.clientMsgId);
    if (existing) return hydrateOne(existing);
  }

  // Fold addressing into metadata as `{to_user_id, summary}` (jsonb — no
  // schema change), preserving any caller-supplied structured payload.
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  // Reserved keys are settable ONLY via the validated top-level fields: raw
  // metadata copies would bypass the addressee-membership check above and the
  // schema's summary length cap (consent-prompt spoofing on non-members).
  delete metadata.to_user_id;
  delete metadata.summary;
  if (input.toUserId) metadata.to_user_id = input.toUserId;
  if (input.summary) metadata.summary = input.summary;

  // Reserved task keys (v15) are server-controlled — strip any caller copy,
  // then stamp fresh from the resolved task row so `taskMode` reflects the
  // latest set_task_mode and can't be spoofed (Q4). `taskId` itself stays
  // caller-settable (a responder legitimately replies within a task); spoofing
  // it alone can't fabricate a mode because we only stamp when it resolves to a
  // real task IN THIS CHANNEL. An old `task-<uuid>-<seq>` id is not a UUID, so
  // it never resolves and stamps nothing (old sessions unchanged). `taskTarget`
  // (the task's responder) binds the desktop's task-reply suppression to the
  // real responder: only a reply whose author IS the target is passive news, so
  // a third member posting into the task still triggers on the requester's box.
  delete metadata.taskMode;
  delete metadata.taskCreatedBy;
  delete metadata.taskTitle;
  delete metadata.taskTarget;
  const taskId =
    typeof metadata.taskId === "string" ? metadata.taskId : undefined;
  if (taskId && isUuid(taskId)) {
    const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
    if (task) {
      metadata.taskMode = task.mode;
      metadata.taskCreatedBy = task.created_by;
      metadata.taskTitle = task.title;
      // Null target (an unaddressed task) stamps nothing — the desktop's
      // predicate then can't match and falls through to the trigger rules.
      if (task.target_user_id) metadata.taskTarget = task.target_user_id;
    }
  }

  // `system` is server-reserved and rejected by the route schema, so a posted
  // message always ties to the acting user (agent posts included — the agent
  // acts on behalf of the token's owner).
  const authorKind =
    input.authorKind ?? (ctx.source === "agent" ? "agent" : "user");

  let row;
  try {
    row = await repo.insertMessage({
      channel_id: channel.id,
      workspace_id: ctx.workspaceId,
      author_user_id: ctx.userId,
      author_kind: authorKind,
      kind: input.kind ?? "message",
      body: input.body,
      metadata,
      client_msg_id: input.clientMsgId ?? null,
    });
  } catch (err) {
    // Lost an idempotency race — converge on the stored winner.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientMsgId) {
      const raced = await repo.findMessageByClientId(channel.id, input.clientMsgId);
      if (raced) return hydrateOne(raced);
    }
    throw err;
  }

  // Surface the channel as active (list sorts by updated_at).
  await repo.touchChannel(ctx.workspaceId, channel.id);
  return hydrateOne(row);
}

async function hydrateOne(
  row: Awaited<ReturnType<typeof repo.insertMessage>>
): Promise<ChannelMessage> {
  if (!row.author_user_id) return mapMessageRow(row, undefined);
  const profiles = await profilesById([row.author_user_id]);
  return mapMessageRow(row, profiles.get(row.author_user_id));
}

// ─── Membership ─────────────────────────────────────────────────────

/**
 * Add a workspace member to the channel. The inviter must be a channel
 * member; the invitee must be an active workspace member (in-workspace
 * invites only, v1 — no token / email invites). One relaxation: any
 * workspace member may self-join a PUBLIC channel (it's already readable
 * to them), so a public channel is actually joinable.
 */
export async function addMember(
  ctx: ChannelContext,
  ref: string,
  userId: string
): Promise<ChannelMember> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  // A DM is a fixed 1:1 pair — never admit a third member (this is also the
  // path the MCP `invite` op takes, so the guard covers agent invites too).
  if (channel.is_direct) {
    throw new DirectChannelImmutableError("membership");
  }
  const selfJoinPublic =
    channel.visibility === "public" && userId === ctx.userId;
  if (!membership && !selfJoinPublic) {
    throw new ChannelForbiddenError("add members to this channel");
  }
  if (!(await repo.isActiveWorkspaceMember(ctx.workspaceId, userId))) {
    throw new ChannelInviteeNotMemberError(userId);
  }
  if (await repo.findMembership(channel.id, userId)) {
    throw new ChannelMemberExistsError();
  }

  let row;
  try {
    row = await repo.insertMember({
      channel_id: channel.id,
      user_id: userId,
      workspace_id: ctx.workspaceId,
      role: "member",
      added_by: ctx.userId,
    });
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChannelMemberExistsError();
    }
    throw err;
  }

  const profiles = await profilesById([userId]);
  // `viewerUserId` is the caller, not the added member: inviting someone must
  // not echo back THEIR notify scope / tool profile (the mapper scrubs them
  // for anyone but the viewer, exactly as the roster read does).
  return mapMemberRow(row, profiles.get(userId), { viewerUserId: ctx.userId });
}

/**
 * Remove a member: a member can leave (self), and an owner / workspace
 * admin can remove anyone. Removing the caller's own row is always allowed —
 * except the LAST owner can neither leave nor be removed (that would orphan
 * the channel with no one able to manage it); transfer ownership first.
 */
export async function removeMember(
  ctx: ChannelContext,
  ref: string,
  targetUserId: string
): Promise<void> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  const isSelf = targetUserId === ctx.userId;
  if (!isSelf && !canManageChannel(ctx, membership)) {
    throw new ChannelForbiddenError("remove this member");
  }

  const target = await repo.findMembership(channel.id, targetUserId);
  if (!target) return; // already not a member — idempotent no-op
  if (target.role === "owner" && (await repo.countOwners(channel.id)) <= 1) {
    throw new ChannelLastOwnerError();
  }

  await repo.deleteMember(channel.id, targetUserId);
}

/**
 * Update the CALLER's own per-channel preferences (notification scope and /
 * or responding-agent tool profile). Any channel member may set their own
 * (they are personal preferences, not management actions); a non-member is
 * refused. Always targets the caller's row. Returns the updated membership
 * DTO.
 */
export async function updateMyMemberSettings(
  ctx: ChannelContext,
  ref: string,
  patch: { notifyScope?: NotifyScope; agentToolProfile?: AgentToolProfile }
): Promise<ChannelMember> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("update settings for this channel");
  }
  const dbPatch: { notify_scope?: string; agent_tool_profile?: string } = {};
  if (patch.notifyScope !== undefined) dbPatch.notify_scope = patch.notifyScope;
  if (patch.agentToolProfile !== undefined) {
    dbPatch.agent_tool_profile = patch.agentToolProfile;
  }
  const row = await repo.updateMemberPrefs(channel.id, ctx.userId, dbPatch);
  const profiles = await profilesById([ctx.userId]);
  return mapMemberRow(row, profiles.get(ctx.userId), { viewerUserId: ctx.userId });
}

// ─── Tasks (v15) ────────────────────────────────────────────────────

/**
 * Create a first-class task in a channel. The caller must be a channel member
 * and `toUserId` (the responder the task is addressed to) must be an active
 * member of THAT channel. The requester's initial request (`body`) is posted
 * as the task's first message, tagged `metadata.taskId` so it groups into the
 * task card and the server stamps the reserved task keys onto it.
 */
export async function createTask(
  ctx: ChannelContext,
  ref: string,
  rawInput: TaskCreateInput
): Promise<ChannelTask> {
  const input = stripNulDeep(rawInput);
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("create a task in this channel");
  }
  if (!(await repo.findMembership(channel.id, input.toUserId))) {
    throw new ChannelAddresseeNotMemberError(input.toUserId);
  }

  const task = await repoTasks.insertTask({
    channel_id: channel.id,
    workspace_id: ctx.workspaceId,
    title: input.title,
    mode: input.mode ?? "interactive",
    created_by: ctx.userId,
    target_user_id: input.toUserId,
  });

  await postMessage(ctx, channel.id, {
    body: input.body,
    kind: "message",
    toUserId: input.toUserId,
    summary: input.title,
    metadata: { taskId: task.id },
  });

  return mapTaskRow(task);
}

/**
 * Close a task with an outcome. Permitted for the task's creator OR its target
 * (`created_by` / `target_user_id`). Posts a lifecycle marker so the other
 * member's thread updates live: completed -> `task_finished` (calm "done");
 * failed -> `task_failed` (a close with outcome=failed IS a genuine failure).
 */
export async function closeTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string,
  outcome: TaskOutcome
): Promise<ChannelTask> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  if (!membership) {
    throw new ChannelForbiddenError("close a task in this channel");
  }
  const task = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  if (task.created_by !== ctx.userId && task.target_user_id !== ctx.userId) {
    throw new TaskForbiddenError("close this task");
  }

  const updated = await repoTasks.updateTask(task.id, {
    status: "closed",
    outcome,
    closed_at: new Date().toISOString(),
  });

  await postMessage(ctx, channel.id, {
    body: outcome === "completed" ? "Task completed" : "Task failed",
    kind: outcome === "completed" ? "task_finished" : "task_failed",
    summary: task.title,
    metadata: { taskId: task.id },
  });

  return mapTaskRow(updated);
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
  mode: TaskMode
): Promise<ChannelTask> {
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
