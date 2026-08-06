import "server-only";
import type { AgentToolProfile, ChannelMember, NotifyScope } from "../types";
import {
  ChannelForbiddenError,
  ChannelInviteeNotMemberError,
  ChannelLastOwnerError,
  ChannelMemberExistsError,
  DirectChannelImmutableError,
} from "./errors";
import { mapMemberRow } from "./dto";
import * as repo from "./repository";
import {
  canManageChannel,
  loadVisibleChannel,
  profilesById,
  UNIQUE_VIOLATION,
  type ChannelContext,
} from "./service-shared";

/**
 * CHANNEL MEMBERSHIP writes: add, remove, and a member's own per-channel
 * preferences. Split out of `service-writes.ts` (§2 cap) because membership is
 * its own reason to change — that file decides what a CHANNEL and a MESSAGE
 * are, this one decides who is in the room and what leaving costs.
 *
 * A departure used to reach into a NEIGHBOURING lane on the way out, ending
 * every AGENT ENGAGEMENT the leaver had created in the room (engagement
 * outlived membership, and the leaver could no longer see the channel to undo
 * it). Engagement is gone with the named agents (rollback §1) and so is the
 * sweep: leaving is a membership write again.
 */

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
 *
 * A DM is exempt entirely: its 1:1 membership is immutable in BOTH directions
 * (`addMember` already refused to add a third).
 *
 * LEAVING IS A MEMBERSHIP WRITE AND NOTHING MORE. It used to also end every agent engagement
 * the leaver had started in the room (`clearDepartedEngagement`, fail-soft, after the delete);
 * that helper went with the named agents — see the module docblock above.
 */
export async function removeMember(
  ctx: ChannelContext,
  ref: string,
  targetUserId: string
): Promise<void> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  // Q2 — deleting one of a DM's two rows is PERMANENT: `reopenDirectChannel`
  // can revive a soft-deleted pair, but a torn LIVE pair reads as not-found to
  // the missing side, and the partial unique index on `direct_key` keeps the
  // live row reserving the pair so a fresh DM can't be opened either. The
  // supported exit is deleting the CONVERSATION (soft-delete, reversible,
  // available to both members) — never dropping a membership row.
  if (channel.is_direct) {
    throw new DirectChannelImmutableError("membership");
  }
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
  return mapMemberRow(row, profiles.get(ctx.userId), {
    viewerUserId: ctx.userId,
  });
}
