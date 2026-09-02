import "server-only";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Channel } from "../types";
import {
  ChannelInviteeNotMemberError,
  ChannelSlugConflictError,
  DirectSelfTargetError,
} from "./errors";
import * as repo from "./repository";
import { getChannel } from "./service-reads";
import { UNIQUE_VIOLATION, type ChannelContext } from "./service-shared";

/**
 * **THE DM LIFECYCLE** — open, dedup, revive, self-heal.
 *
 * ⚠ **ITS OWN FILE (§1 split, 2026-09-02) BECAUSE `service-writes.ts` REACHED THE
 * 500-LINE CAP**, and the seam is a real reason-to-change rather than arithmetic:
 * everything here moves when the two-member DM contract moves — the `direct_key`
 * dedup, the soft-delete/revive pair, the torn-roster self-heal — and
 * `service-writes.ts` when a channel WRITE does.
 *
 * ⚠ **`service-writes.ts › createChannel` IS STILL THE ONLY DOOR.** It dispatches
 * on `input.direct === true`; nothing else may call in here, or the membership
 * and slug rules stated there would have a second path around them.
 */

/**
 * Open (or dedup-return) a direct channel. `direct_key` is the two user-ids
 * sorted and joined ':'; lookup by (workspace, direct_key) makes repeat opens
 * idempotent. Peer must be an active workspace member, self-DM refused, exactly
 * two members inserted — ⚠ membership-of-2 lives here because a CHECK can't
 * count.
 */
export async function createDirectChannel(
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
  // ⚠ Look up INCLUDING soft-deleted rows — the partial unique index counts a
  // soft-deleted DM, so a fresh insert for a deleted pair 23505s. Live row
  // returned as-is; soft-deleted row REVIVED with its member rows, so the same
  // conversation and history reopen. A DM delete is "hide until reopened".
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
      // Ignored by the DM UI (it renders the peer), but NOT NULL / CHECK still
      // require a non-empty name.
      name: "Direct message",
      topic: "",
      visibility: "private",
      is_direct: true,
      direct_key: directKey,
    });
  } catch (err) {
    // 23505 = the direct_key index (concurrent open of the SAME pair) or the
    // workspace slug index (concurrent create took the slug). ⚠ Look the pair up
    // INCLUDING soft-deleted rows and converge; a slug race resolves to nothing
    // and surfaces as a clean 409 instead of a generic 500.
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
 * Return an existing direct channel, reviving it first when soft-deleted so the
 * same conversation and history reopen. A live row is returned as-is.
 *
 * ⚠ Both member rows are re-asserted on EVERY open, not only the revive branch.
 * A live DM with a torn roster is otherwise a dead end: the missing side reads
 * the channel as not-found, and the partial unique index on `direct_key` keeps
 * the live row reserving the pair, so no fresh DM can be created either. A
 * WORKSPACE departure legitimately removes the leaver's row
 * (`service-workspace-departure.ts`), so re-asserting here is the only self-heal
 * — from EITHER side, a rejoined leaver included.
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
 * Restore one member of a reopened direct channel — normally a no-op, since a
 * soft-delete leaves `channel_members` in place. Caller takes `owner`, peer
 * `member`, so a pair healed from the evicted side still has a manager.
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
