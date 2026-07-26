import "server-only";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Channel, ChannelMember, ChannelMessage } from "../types";
import type {
  ChannelCreateInput,
  ChannelMessageCreateInput,
  ChannelUpdateInput,
} from "../schema";
import {
  ChannelForbiddenError,
  ChannelInviteeNotMemberError,
  ChannelLastOwnerError,
  ChannelMemberExistsError,
  ChannelSlugConflictError,
} from "./errors";
import { mapMemberRow, mapMessageRow } from "./dto";
import * as repo from "./repository";
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

  // Idempotency: a re-sent client_msg_id returns the stored message.
  if (input.clientMsgId) {
    const existing = await repo.findMessageByClientId(channel.id, input.clientMsgId);
    if (existing) return hydrateOne(existing);
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
      metadata: input.metadata ?? {},
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
  return mapMemberRow(row, profiles.get(userId));
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
