import "server-only";
import * as repo from "./repository";

/**
 * WHAT LEAVING THE WORKSPACE COSTS INSIDE CHANNELS — the sweep half of C-20
 * (Samuel, 2026-08-10: "if someone leaves a workspace, it shouldn't just be a
 * filter but they need to definitely be removed. Fully and cleanly removed").
 *
 * The ADDRESSING half is already closed: `postMessage` / `createTask` assert
 * `isActiveWorkspaceMember` on the addressee and fail closed. That stopped the
 * silent forever-wait; it did NOT remove the departed member. Their
 * `channel_members` rows outlived the departure, so every roster kept rendering
 * them and every count kept counting them — including the one count that is a
 * BEHAVIOUR: `classify`'s implicit trigger fires only on a known-exact
 * `memberCount === 2` (ENGINEERING §8 N-PARTY SEMANTICS). One ghost row turns a
 * live 1:1 room into a "3-party" room and silently disables the trigger for the
 * two people still in it. That is the bug this module deletes.
 *
 * THIS IS A SERVER-TO-SERVER CALL AND IT TAKES NO `ChannelContext` ON PURPOSE.
 * It is not a member action and carries no authorization of its own — the
 * authority is the workspace removal that already happened upstream
 * (`workspaces/server/membership-admin.removeMember`, admin+ with last-owner
 * protection). It must never be wired to a route, an MCP op, or anything a
 * caller can reach directly: it would be an unauthenticated "evict this user
 * from every room" primitive.
 *
 * ─── THE DM DECISION (Q: what happens to a 1:1 whose peer left?) ───
 *
 * `removeMember` refuses to tear a DM pair because the roster is immutable BY
 * MEMBERS. A workspace departure is not a member action, so that refusal does
 * not bind here — but the reason behind it still does: a DM with ONE member is
 * a broken object in this codebase, not a smaller one.
 *
 *   - `buildDirectPeers` (`service-reads.ts`) resolves the peer as
 *     `ids.find(id => id !== selfId) ?? ids[0]`. Delete the leaver's row and
 *     that fallback returns the SURVIVOR — the DM renders in their sidebar
 *     under their own name and avatar, a conversation with themselves.
 *   - `resolveDirectPeer` (`service-writes-metadata.ts`) requires exactly two
 *     members and otherwise resolves to nothing, so the survivor's next post
 *     into that DM is auto-addressed to NOBODY. With `memberCount === 1` the
 *     implicit trigger cannot fire either. They type into a room that answers
 *     by construction never, with no error and no explanation.
 *
 * So option (a) "just delete the DM membership" strands the survivor, and
 * option (c) "leave DM memberships alone" is the ghost Samuel rejected.
 *
 * WE TAKE (b): STAMP `deleted_at` ON THE DM **AND** DELETE THE LEAVER'S ROW.
 * `deleted_at` on a direct channel is not a trash — it is the CLOSE half of
 * close/reopen (ENGINEERING §7), the exit either side already has unilaterally,
 * and a departure is the strongest unilateral close there is. Three properties
 * make it the only option that cannot strand or crash anyone:
 *
 *   1. The DM leaves the survivor's sidebar instead of turning into a self-DM.
 *      `listChannels` filters `deleted_at IS NULL`; nothing renders a peer that
 *      is not there, because nothing renders the channel.
 *   2. NOTHING CAN RESURRECT THE GHOST. The only writer that re-asserts a DM's
 *      two member rows is `reopenDirectChannel` → `ensureDirectMember`, reached
 *      only through `createDirectChannel`, which throws
 *      `ChannelInviteeNotMemberError` on a peer who is not an active workspace
 *      member. The survivor cannot reopen it while the leaver is gone, so the
 *      row we delete stays deleted.
 *   3. IT IS REVERSIBLE IN THE ONE CASE THAT MATTERS. If the leaver rejoins the
 *      workspace, either side's next open finds the hidden row
 *      (`findDirectChannelAnyStatus`), revives it, and re-asserts BOTH member
 *      rows — the same conversation with its full history. The transcript is
 *      never destroyed; we never hard-delete a DM (§7 forbids it, and one
 *      member's departure must not vaporize a shared transcript).
 *
 * ORDER IS CRASH-SAFETY, NOT STYLE. Per channel: close the DM FIRST, delete the
 * membership row SECOND. Interrupted after the close, the pair is hidden with
 * its roster intact — inert, and self-healing on a rejoin. Interrupted the
 * other way round, we would have left exactly the one-member DM this decision
 * exists to prevent.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT SWEEP ───
 *
 * `channel_tasks`. An open thread whose creator or target has left is left
 * alone: addressing already fails closed, the survivor keeps `closeTask`, and
 * the alternative — posting a system note into every affected thread — means
 * minting channel messages with no member author behind them. No existing
 * marker idiom covers "a participant left the workspace" (the calm flags and
 * `session_ended` markers are all session-scoped and author-attributed), and
 * inventing a message kind was explicitly out of scope. The survivor still
 * learns nothing; that half of C-20 stays open.
 */

/** What one sweep actually did — for the caller's log line and for tests. */
export interface DepartedMemberSweep {
  /** `channel_members` rows deleted (one per channel the user belonged to). */
  membershipsRemoved: number;
  /** Live 1:1s closed by stamping `channels.deleted_at`. */
  directChannelsClosed: number;
}

/**
 * Remove a departed workspace member from every channel in that workspace:
 * their `channel_members` row goes everywhere, and any live DM they were half
 * of is closed (`deleted_at`) on the way out. Idempotent — a user with no
 * memberships left is a no-op, and a DM already closed is not re-stamped.
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

  // ONE read for the shape of every room they were in. `listChannels` ORs in
  // the workspace's PUBLIC channels (rooms they may not have belonged to), so
  // intersect with the membership set before believing anything about it. It
  // also excludes soft-deleted rows, which is exactly the filter we want: a DM
  // that is already closed is absent here and therefore never re-stamped.
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
