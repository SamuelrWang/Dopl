/**
 * Unit tests for channel + direct-channel CREATION and the DM's fixed 1:1
 * shape — slug allocation, the dedup/revive/self-heal path, the immutable
 * roster, and who may delete. Split out of `service-tasks.test.ts` (§2 cap):
 * channel creation is its own lane.
 *
 * Focus (the load-bearing rules):
 *   - slug allocation must agree with `channels_workspace_slug_key`, which is
 *     NOT partial: a soft-deleted channel still owns its slug, so recreating a
 *     deleted name must pick the next free one instead of 409-ing (and, on the
 *     DM path, 500-ing) against a channel the user can no longer see;
 *   - direct channels: self-DM rejected, dedup returns the existing channel, a
 *     soft-deleted DM is revived, a new DM inserts exactly two members with a
 *     sorted direct_key;
 *   - a DM's roster is IMMUTABLE in both directions (Q2). `addMember` refuses a
 *     third; `removeMember` refuses to drop either row, because a torn live
 *     pair is unrecoverable — nothing revives a row that was never
 *     soft-deleted, and the partial unique index on `direct_key` keeps the live
 *     row reserving the pair. Both sides exit by DELETING the conversation
 *     (reversible), and an already-torn pair self-heals on the next open.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-agents");
vi.mock("./service-reads");

import * as repo from "./repository";
import * as reads from "./service-reads";
import { createChannel, deleteChannel } from "./service-writes";
import { addMember, removeMember } from "./service-writes-members";
import {
  ChannelForbiddenError,
  ChannelInviteeNotMemberError,
  ChannelNotFoundError,
  ChannelSlugConflictError,
  DirectChannelImmutableError,
  DirectSelfTargetError,
} from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow } from "./dto";

const WS = "ws-1";
const USER = "aaaaaaaa-e29b-41d4-a716-446655440000";
const PEER = "bbbbbbbb-e29b-41d4-a716-446655440000";
const TARGET = "dddddddd-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-27T00:00:00Z",
    updated_at: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-27T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findChannelById).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
    uid === USER ? memberRow(USER, "owner") : null
  );
  // The create paths finish with getChannel; a stub is enough for these tests.
  vi.mocked(reads.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof reads.getChannel>>
  );
});

describe("createChannel — slug allocation vs. soft-deleted channels", () => {
  it("SECURITY/UX (B4): a soft-deleted channel's slug is still taken, so the recreate gets the next one", async () => {
    // `channels_workspace_slug_key` is NOT partial — the hidden row still owns
    // `design`. When `existingSlugs` filtered `deleted_at is null`, "create
    // #Design, delete it, create #Design again" allocated `design` a second
    // time and 23505'd into a 409 naming a channel the user cannot see.
    vi.mocked(repo.existingSlugs).mockResolvedValue(["design"]);
    vi.mocked(repo.insertChannel).mockResolvedValue(
      channelRow({ id: "chan-new", slug: "design-2" })
    );
    vi.mocked(repo.insertMember).mockResolvedValue(memberRow(USER, "owner"));

    await createChannel(ctx, { name: "Design" });

    expect(vi.mocked(repo.insertChannel).mock.calls[0][0].slug).toBe("design-2");
  });

  it("a genuine slug race still surfaces as a 409, not a raw 23505", async () => {
    vi.mocked(repo.existingSlugs).mockResolvedValue([]);
    vi.mocked(repo.insertChannel).mockRejectedValue({ code: "23505" });
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");

    await expect(createChannel(ctx, { name: "Design" })).rejects.toBeInstanceOf(
      ChannelSlugConflictError
    );
  });
});

describe("createChannel — direct branch", () => {
  it("rejects a self-DM (DirectSelfTargetError)", async () => {
    await expect(
      createChannel(ctx, { direct: true, memberUserId: USER })
    ).rejects.toBeInstanceOf(DirectSelfTargetError);
    expect(repo.insertChannel).not.toHaveBeenCalled();
  });

  it("rejects a peer who is not an active workspace member", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(false);
    await expect(
      createChannel(ctx, { direct: true, memberUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelInviteeNotMemberError);
    expect(repo.insertChannel).not.toHaveBeenCalled();
  });

  it("dedups: returns an INTACT live DM without inserting or reviving", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({ id: "dm-existing", is_direct: true })
    );
    // Both rows present — the re-assert on every open (Q2) is a pure no-op.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      memberRow(uid, uid === USER ? "owner" : "member")
    );

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.insertChannel).not.toHaveBeenCalled();
    // A live row (deleted_at null) is never revived; an intact roster is never
    // touched.
    expect(repo.reviveChannel).not.toHaveBeenCalled();
    expect(repo.insertMember).not.toHaveBeenCalled();
    expect(reads.getChannel).toHaveBeenCalledWith(ctx, "dm-existing");
  });

  it("revives a soft-deleted DM (same id) and restores missing member rows", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({
        id: "dm-deleted",
        is_direct: true,
        direct_key: [USER, PEER].sort().join(":"),
        deleted_at: "2026-07-27T01:00:00Z",
      })
    );
    vi.mocked(repo.reviveChannel).mockResolvedValue(undefined);
    // Both member rows were torn down — findMembership misses for both, so each
    // is re-inserted with its original role.
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    vi.mocked(repo.insertMember).mockResolvedValue(memberRow(USER, "owner"));

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.insertChannel).not.toHaveBeenCalled();
    expect(repo.reviveChannel).toHaveBeenCalledWith(WS, "dm-deleted");
    expect(repo.insertMember).toHaveBeenCalledTimes(2);
    const roles = vi
      .mocked(repo.insertMember)
      .mock.calls.map((c) => [c[0].user_id, c[0].role]);
    expect(roles).toContainEqual([USER, "owner"]);
    expect(roles).toContainEqual([PEER, "member"]);
    expect(reads.getChannel).toHaveBeenCalledWith(ctx, "dm-deleted");
  });

  it("revive leaves existing member rows untouched (no duplicate inserts)", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({
        id: "dm-deleted",
        is_direct: true,
        deleted_at: "2026-07-27T01:00:00Z",
      })
    );
    vi.mocked(repo.reviveChannel).mockResolvedValue(undefined);
    // Both member rows survived the soft-delete — nothing to re-insert.
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.reviveChannel).toHaveBeenCalledWith(WS, "dm-deleted");
    expect(repo.insertMember).not.toHaveBeenCalled();
  });

  it("creates a new DM with a sorted direct_key + exactly two members", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(null);
    vi.mocked(repo.existingSlugs).mockResolvedValue([]);
    vi.mocked(repo.insertChannel).mockResolvedValue(
      channelRow({ id: "dm-new", is_direct: true })
    );
    vi.mocked(repo.insertMember).mockResolvedValue(memberRow(USER, "owner"));

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    const insertArg = vi.mocked(repo.insertChannel).mock.calls[0][0];
    expect(insertArg.is_direct).toBe(true);
    expect(insertArg.visibility).toBe("private");
    // direct_key is the two ids sorted, joined ':'.
    expect(insertArg.direct_key).toBe([USER, PEER].sort().join(":"));
    // Membership-of-2: creator (owner) + peer (member).
    expect(repo.insertMember).toHaveBeenCalledTimes(2);
    const roles = vi
      .mocked(repo.insertMember)
      .mock.calls.map((c) => [c[0].user_id, c[0].role]);
    expect(roles).toContainEqual([USER, "owner"]);
    expect(roles).toContainEqual([PEER, "member"]);
  });
});

describe("createDirectChannel — 23505 convergence (B4)", () => {
  beforeEach(() => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.existingSlugs).mockResolvedValue([]);
    vi.mocked(repo.insertChannel).mockRejectedValue({ code: "23505" });
    vi.mocked(repo.pgErrorCode).mockReturnValue("23505");
  });

  it("converges on a SOFT-DELETED pair (revives it) instead of throwing raw", async () => {
    // The pre-insert lookup missed (a concurrent delete/open), the insert then
    // hit the direct_key index. Looking the pair up live-rows-only returned
    // null and the raw 23505 rethrew as a generic 500 on "open direct message".
    vi.mocked(repo.findDirectChannelAnyStatus)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        channelRow({
          id: "dm-deleted",
          is_direct: true,
          direct_key: [USER, PEER].sort().join(":"),
          deleted_at: "2026-07-27T01:00:00Z",
        })
      );
    vi.mocked(repo.reviveChannel).mockResolvedValue(undefined);
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    vi.mocked(repo.insertMember).mockResolvedValue(memberRow(USER, "owner"));

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.reviveChannel).toHaveBeenCalledWith(WS, "dm-deleted");
    expect(reads.getChannel).toHaveBeenCalledWith(ctx, "dm-deleted");
  });

  it("a slug race with no matching pair surfaces as a 409, not a generic 500", async () => {
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(null);

    await expect(
      createChannel(ctx, { direct: true, memberUserId: PEER })
    ).rejects.toBeInstanceOf(ChannelSlugConflictError);
  });
});

describe("addMember — direct channel is immutable", () => {
  it("rejects adding a third member to a DM (before any membership check)", async () => {
    // A DM resolves as a private, is_direct channel the caller owns.
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ id: "dm-1", is_direct: true, direct_key: `${USER}:${PEER}` })
    );

    await expect(addMember(ctx, "dm-1", TARGET)).rejects.toBeInstanceOf(
      DirectChannelImmutableError
    );
    // Fails fast on the shape guard — never reaches the workspace-member or
    // insert path.
    expect(repo.isActiveWorkspaceMember).not.toHaveBeenCalled();
    expect(repo.insertMember).not.toHaveBeenCalled();
  });
});

/**
 * Q2. `removeMember` had NO `is_direct` guard and no test file imported it,
 * which is how it shipped. Dropping one of a DM's two rows is permanent: the
 * live row keeps the pair's `direct_key` reserved (partial unique index) so a
 * fresh DM can never be opened, and the evicted side reads the existing one as
 * not-found. Both directions are refused; the roster is immutable, period.
 */
describe("removeMember — direct channel is immutable", () => {
  const dm = () =>
    channelRow({
      id: "dm-1",
      is_direct: true,
      direct_key: [USER, PEER].sort().join(":"),
    });

  it("rejects an owner removing the peer from a DM", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(dm());

    await expect(removeMember(ctx, "dm-1", PEER)).rejects.toBeInstanceOf(
      DirectChannelImmutableError
    );
    // Fails fast on the shape guard, exactly like addMember — the row is never
    // looked up and never deleted.
    expect(repo.countOwners).not.toHaveBeenCalled();
    expect(repo.deleteMember).not.toHaveBeenCalled();
  });

  it("rejects the peer LEAVING a DM (the one-click destroy path)", async () => {
    // Bob is the non-creator, so `canManage` is false and the header menu used
    // to offer him "Leave channel" with no confirmation.
    const peerCtx: ChannelContext = { ...ctx, userId: PEER };
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(dm());
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === PEER ? memberRow(PEER, "member") : memberRow(USER, "owner")
    );

    await expect(removeMember(peerCtx, "dm-1", PEER)).rejects.toBeInstanceOf(
      DirectChannelImmutableError
    );
    expect(repo.deleteMember).not.toHaveBeenCalled();
  });

  it("still removes a member from a NON-direct channel", async () => {
    // Control: the guard is scoped to DMs and nothing else regressed.
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow({ id: "c-1" }));
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid, "member")
    );

    await removeMember(ctx, "c-1", TARGET);

    expect(repo.deleteMember).toHaveBeenCalledWith("c-1", TARGET);
  });
});

/**
 * Q2, part 3 — the self-heal. Pairs torn before the guard above existed are
 * reachable by no other repair path: `reopenDirectChannel` used to restore the
 * member rows only on the revive branch, and a torn pair's row is LIVE
 * (`deleted_at` null), so control fell through to `getChannel` →
 * `ChannelNotFoundError` for the missing side, forever.
 */
describe("reopenDirectChannel — an already-torn LIVE pair self-heals", () => {
  it("lets the evicted side re-open the DM instead of 404-ing forever", async () => {
    // Roster as the DB holds it: USER's row was deleted, PEER's survived.
    const roster = new Set<string>([PEER]);
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      roster.has(uid) ? memberRow(uid, uid === PEER ? "owner" : "member") : null
    );
    vi.mocked(repo.insertMember).mockImplementation(async (row) => {
      roster.add(row.user_id);
      return memberRow(row.user_id, row.role);
    });
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({
        id: "dm-torn",
        is_direct: true,
        direct_key: [USER, PEER].sort().join(":"),
        deleted_at: null,
      })
    );
    // Stand-in for the real read's visibility gate: a private channel with no
    // membership row for the caller reads as not-found. Without the fix the
    // repair never runs and this is what the evicted side gets.
    vi.mocked(reads.getChannel).mockImplementation(async (c, ref) => {
      if (!(await repo.findMembership(ref, c.userId))) {
        throw new ChannelNotFoundError(ref);
      }
      return {} as Awaited<ReturnType<typeof reads.getChannel>>;
    });

    await expect(
      createChannel(ctx, { direct: true, memberUserId: PEER })
    ).resolves.toBeDefined();

    // Repaired in place: the pair keeps its id (and its history), no second
    // channel is inserted, and only the missing row is re-added.
    expect(repo.insertChannel).not.toHaveBeenCalled();
    expect(repo.reviveChannel).not.toHaveBeenCalled();
    expect(repo.insertMember).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.insertMember).mock.calls[0][0].user_id).toBe(USER);
  });
});

/**
 * Q2, part 2 + C-16 / F-173 — ONE VERB, TWO DELETES, and the branch is
 * `is_direct` (Samuel's decision, 2026-08-08).
 *
 * A DM stays SOFT, and that is not a trash: `deleted_at` on a direct channel is
 * the close half of close/reopen, either side's next open revives the same row
 * WITH its history, and since the roster is immutable it is the only exit the
 * non-creator has. Both participants may do it; a DM's `owner` row only records
 * who happened to open the conversation.
 *
 * A NON-DM is now a real, cascading, permanent DELETE — which the dialog had
 * been claiming while the server hid the row forever with no revive path, no
 * restore route, no purge and its slug reserved for good.
 *
 * BOTH DIRECTIONS ARE ASSERTED ON EVERY CASE. Getting the branch backwards
 * destroys a shared transcript on one member's click in one direction, and
 * strands a channel forever in the other, so "the right function ran" is only
 * half the assertion — "the other one did not" is the half that catches a
 * future refactor collapsing the branch.
 */
describe("deleteChannel — a DM soft-closes, a channel is really deleted", () => {
  it("lets the non-owner peer delete the conversation, REVERSIBLY", async () => {
    const peerCtx: ChannelContext = { ...ctx, userId: PEER };
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ id: "dm-1", is_direct: true })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(PEER, "member"));

    await deleteChannel(peerCtx, "dm-1");

    expect(repo.softDeleteChannel).toHaveBeenCalledWith(WS, "dm-1");
    // THE LOAD-BEARING NEGATIVE. A hard delete here would let one member
    // destroy a shared transcript on a unilateral click, and take the other
    // side's only exit with it.
    expect(repo.hardDeleteChannel).not.toHaveBeenCalled();
  });

  it("hard-deletes a NON-direct channel for the owner", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow({ id: "c-1" }));
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));

    await deleteChannel(ctx, "c-1");

    expect(repo.hardDeleteChannel).toHaveBeenCalledWith(WS, "c-1");
    expect(repo.softDeleteChannel).not.toHaveBeenCalled();
  });

  it("still refuses a non-owner deleting a NON-direct channel", async () => {
    // The AUTHORIZATION is untouched by C-16 — only the write at the end
    // changed, the same shape the rest of the app took in §2b. Nothing became
    // more permissive alongside becoming permanent.
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow({ id: "c-1" }));
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "member"));

    await expect(deleteChannel(ctx, "c-1")).rejects.toBeInstanceOf(
      ChannelForbiddenError
    );
    expect(repo.softDeleteChannel).not.toHaveBeenCalled();
    expect(repo.hardDeleteChannel).not.toHaveBeenCalled();
  });

  it("a workspace admin can hard-delete a channel they do not belong to", async () => {
    // `canManageChannel`'s other arm. Worth pinning next to the branch: this is
    // the one caller who reaches the destructive path with no membership row.
    // (Public, because `loadVisibleChannel` hides a private channel from a
    // non-member regardless of workspace role — the visibility fence runs
    // first, and an admin's reach does not widen it.)
    const adminCtx: ChannelContext = { ...ctx, role: "admin" };
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ id: "c-2", visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await deleteChannel(adminCtx, "c-2");

    expect(repo.hardDeleteChannel).toHaveBeenCalledWith(WS, "c-2");
  });
});