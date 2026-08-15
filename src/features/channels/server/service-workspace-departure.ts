import "server-only";
import * as repo from "./repository";

/**
 * WHAT LEAVING THE WORKSPACE COSTS INSIDE CHANNELS — the sweep half of C-20.
 * (The ADDRESSING half is `postMessage` / `createTask` asserting
 * `isActiveWorkspaceMember` and failing closed.)
 *
 * ⚠ Why the sweep exists: a departed member's `channel_members` rows outlive the
 * departure, and one ghost row turns a live 1:1 into a "3-party" room —
 * `classify`'s implicit trigger fires only on a known-exact `memberCount === 2`
 * (ENGINEERING §8), so the trigger silently dies for the two people still there.
 *
 * ⚠ SERVER-TO-SERVER ONLY, and it takes NO `ChannelContext` on purpose. It
 * carries no authorization of its own — the authority is the workspace removal
 * already performed upstream (`workspaces/server/membership-admin.removeMember`).
 * NEVER wire it to a route, an MCP op, or anything a caller can reach: that is
 * an unauthenticated "evict this user from every room" primitive.
 *
 * ⚠ THE DM RULE: stamp `deleted_at` on the DM **and** delete the leaver's row.
 * A DM with ONE member is a broken object, not a smaller one —
 * `buildDirectPeers` (`service-reads.ts`) falls back to `ids[0]` and renders the
 * survivor a conversation with themselves, while `resolveDirectPeer`
 * (`service-writes-metadata.ts`) requires exactly two members, so their next
 * post is auto-addressed to NOBODY and the implicit trigger cannot fire.
 * `deleted_at` on a direct channel is the CLOSE half of close/reopen
 * (ENGINEERING §7), and:
 *   1. the DM leaves the survivor's sidebar (`listChannels` filters
 *      `deleted_at IS NULL`) instead of becoming a self-DM;
 *   2. nothing can resurrect the ghost — the only writer that re-asserts a DM's
 *      member rows is `reopenDirectChannel` → `ensureDirectMember`, reachable
 *      only via `createDirectChannel`, which throws
 *      `ChannelInviteeNotMemberError` for a non-active peer;
 *   3. it is reversible on rejoin — either side's next open finds the hidden row
 *      (`findDirectChannelAnyStatus`), revives it, and re-asserts BOTH rows with
 *      the full history. ⚠ Never hard-delete a DM.
 *
 * ⚠ ORDER IS CRASH-SAFETY: per channel, close the DM FIRST, delete the
 * membership row SECOND. Interrupted after the close, the pair is hidden with
 * its roster intact and self-heals on rejoin; interrupted the other way, you get
 * exactly the one-member DM this exists to prevent.
 *
 * ⚠ Deliberately does NOT sweep `channel_tasks`. An open thread whose creator or
 * target left is left alone: addressing already fails closed and the survivor
 * keeps `closeTask`. Posting a system note would mean minting channel messages
 * with no member author, and no marker idiom covers "a participant left the
 * workspace". The survivor learns nothing; that half of C-20 stays open.
 */

/** What one sweep actually did — for the caller's log line and for tests. */
export interface DepartedMemberSweep {
  /** `channel_members` rows deleted (one per channel the user belonged to). */
  membershipsRemoved: number;
  /** Live 1:1s closed by stamping `channels.deleted_at`. */
  directChannelsClosed: number;
}

/**
 * Remove a departed workspace member from every channel: their
 * `channel_members` row goes everywhere, and any live DM they were half of is
 * closed (`deleted_at`) on the way out. Idempotent.
 */
export async function removeWorkspaceDepartedMember(
  workspaceId: string,
  userId: string
): Promise<DepartedMemberSweep> {
  const memberships = await repo.listMyMemberships(workspaceId, userId);
  if (memberships.length === 0) {
    return { membershipsRemoved: 0, directChannelsClosed: 0 };
  }
  const memberChannelIds = memberships.map((m) => m.channel_id);

  // ⚠ `listChannels` ORs in the workspace's PUBLIC channels (rooms they may
  // never have belonged to), so intersect with the membership set first. It also
  // excludes soft-deleted rows, which is the filter we want — an already-closed
  // DM is absent here and therefore never re-stamped.
  const mine = new Set(memberChannelIds);
  const rows = await repo.listChannels(workspaceId, {
    memberChannelIds,
    includeArchived: true,
  });
  const liveDirectIds = new Set(
    rows.filter((r) => r.is_direct && mine.has(r.id)).map((r) => r.id)
  );

  let directChannelsClosed = 0;
  for (const channelId of memberChannelIds) {
    if (liveDirectIds.has(channelId)) {
      await repo.softDeleteChannel(workspaceId, channelId);
      directChannelsClosed += 1;
    }
    await repo.deleteMember(channelId, userId);
  }

  return { membershipsRemoved: memberChannelIds.length, directChannelsClosed };
}
