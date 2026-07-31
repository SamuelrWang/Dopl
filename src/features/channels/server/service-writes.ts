import "server-only";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Channel, ChannelMember, ChannelMessage } from "../types";
import type {
  ChannelCreateInput,
  ChannelMessageCreateInput,
  ChannelUpdateInput,
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
} from "./errors";
import type { AgentToolProfile, NotifyScope } from "../types";
import { mapMemberRow, mapMessageRow } from "./dto";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import { getChannel } from "./service-reads";
import { resolvePostMetadata } from "./service-writes-metadata";
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
 * workspace floor. The task lifecycle lives in `service-tasks.ts`; the
 * metadata folds a post goes through live in `service-writes-metadata.ts`.
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
  if (existing) return reopenDirectChannel(ctx, existing, memberUserId);

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
    // A 23505 here is either the direct_key index (a concurrent open of the
    // SAME pair) or the workspace slug index (a concurrent create that took
    // the slug this call had already picked). Look the pair up INCLUDING
    // soft-deleted rows — the same reason the pre-insert lookup does — and
    // converge on it; a slug race resolves to nothing and surfaces as a clean
    // 409 instead of the raw 23505 becoming a generic 500 on "open direct
    // message".
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      const raced = await repo.findDirectChannelAnyStatus(
        ctx.workspaceId,
        directKey
      );
      if (raced) return reopenDirectChannel(ctx, raced, memberUserId);
      throw new ChannelSlugConflictError(slug);
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
 * Return an existing direct channel, reviving it first when it was
 * soft-deleted (un-hidden) so the same conversation — and its history —
 * reopens. A live row is returned as-is.
 *
 * The two member rows are re-asserted on EVERY open, not only on the revive
 * branch (Q2). A live DM with a torn roster is otherwise a dead end: the
 * missing side reads the channel as not-found (`getChannel` →
 * `loadVisibleChannel`), and the partial unique index on `direct_key` keeps
 * the live row reserving the pair, so a fresh DM can't be created either.
 * `removeMember` now refuses to tear a DM at all, but pairs damaged before
 * that guard existed are unreachable by any other repair path — re-asserting
 * here makes them self-heal on the next open, from EITHER side. Two membership
 * reads on a dedup path (not a hot one) is the whole cost.
 */
async function reopenDirectChannel(
  ctx: ChannelContext,
  existing: { id: string; deleted_at: string | null },
  memberUserId: string
): Promise<Channel> {
  if (existing.deleted_at) {
    await repo.reviveChannel(ctx.workspaceId, existing.id);
  }
  await ensureDirectMember(ctx, existing.id, ctx.userId, "owner");
  await ensureDirectMember(ctx, existing.id, memberUserId, "member");
  return getChannel(ctx, existing.id);
}

/**
 * Restore one member of a reopened direct channel. A soft-delete leaves the
 * `channel_members` rows in place, so this is normally a no-op: re-insert only
 * the row that went missing. The caller takes `owner` and the peer `member`,
 * so a pair healed from the evicted side still has someone who can manage it.
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

/**
 * Soft-delete: hide from active reads, keep the row (`deleted_at`).
 *
 * A DM is the one case where BOTH members may do this. It has no real manage
 * hierarchy — one side holds the `owner` row only because they happened to
 * open the conversation — and on a DM the delete is the reversible op: either
 * side's next open revives the same row WITH its history
 * (`reopenDirectChannel`). Since a DM's membership is immutable (leaving is
 * refused, see `removeMember`), this is also the only exit the non-creator
 * has. Every other channel still requires owner / workspace-admin.
 */
export async function deleteChannel(
  ctx: ChannelContext,
  ref: string
): Promise<void> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  const allowed = channel.is_direct
    ? membership !== null
    : canManageChannel(ctx, membership);
  if (!allowed) {
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
    const existing = await repoMessages.findMessageByClientId(channel.id, input.clientMsgId);
    if (existing) return hydrateOne(existing);
  }

  // Addressing (incl. the DM auto-address), the reserved-key anti-spoof fold
  // and the task-key stamping all live in `service-writes-metadata.ts` — one
  // place decides what a caller may put in `metadata` and what the server
  // stamps itself (jsonb, no schema change).
  const metadata = await resolvePostMetadata(ctx, channel, input);

  // `system` is server-reserved and rejected by the route schema, so a posted
  // message always ties to the acting user (agent posts included — the agent
  // acts on behalf of the token's owner).
  const authorKind =
    input.authorKind ?? (ctx.source === "agent" ? "agent" : "user");

  let row;
  try {
    row = await repoMessages.insertMessage({
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
      const raced = await repoMessages.findMessageByClientId(channel.id, input.clientMsgId);
      if (raced) return hydrateOne(raced);
    }
    throw err;
  }

  // Surface the channel as active (list sorts by updated_at).
  await repo.touchChannel(ctx.workspaceId, channel.id);
  return hydrateOne(row);
}

async function hydrateOne(
  row: Awaited<ReturnType<typeof repoMessages.insertMessage>>
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
 *
 * A DM is exempt entirely: its 1:1 membership is immutable in BOTH directions
 * (`addMember` already refused to add a third).
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
  return mapMemberRow(row, profiles.get(ctx.userId), { viewerUserId: ctx.userId });
}
