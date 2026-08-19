/**
 * Channel + direct-channel CREATION and the DM's fixed 1:1 shape. Load-bearing
 * rules:
 *   - ⚠ slug allocation must agree with `channels_workspace_slug_key`, which is
 *     NOT partial: a soft-deleted channel still owns its slug, so recreating a
 *     deleted name must take the next free one, not 409 (or 500 on the DM path)
 *     against a channel the user can no longer see;
 *   - direct: self-DM rejected, dedup returns the existing channel, soft-deleted
 *     DM revived, new DM inserts exactly two members with a sorted direct_key;
 *   - ⚠ a DM's roster is IMMUTABLE both ways. `addMember` refuses a third;
 *     `removeMember` refuses to drop either row — a torn LIVE pair is
 *     unrecoverable, since nothing revives a row that was never soft-deleted and
 *     the partial unique index on `direct_key` keeps the live row reserving the
 *     pair. Both sides exit by DELETING (reversible); a torn pair self-heals on
 *     the next open.
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
    favorited_at: null,
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
  vi.mocked(reads.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof reads.getChannel>>
  );
});

describe("createChannel — slug allocation vs. soft-deleted channels", () => {
  it("SECURITY/UX (B4): a soft-deleted channel's slug is still taken, so the recreate gets the next one", async () => {
    // ⚠ `channels_workspace_slug_key` is NOT partial — the hidden row still owns
    // `design`. Filtering `existingSlugs` on `deleted_at is null` re-allocates
    // it and 23505s into a 409 naming a channel the user cannot see.
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
    // Both rows present — the re-assert on every open is a pure no-op.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      memberRow(uid, uid === USER ? "owner" : "member")
    );

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.insertChannel).not.toHaveBeenCalled();
    // Live row (deleted_at null) never revived; intact roster never touched.
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
    // Both rows torn down — findMembership misses both, each re-inserted.
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
    // direct_key = the two ids sorted, joined ':'.
    expect(insertArg.direct_key).toBe([USER, PEER].sort().join(":"));
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
    // Pre-insert lookup missed (concurrent delete/open), insert hit the
    // direct_key index. ⚠ Looking the pair up live-rows-only returns null and
    // rethrows the raw 23505 as a generic 500.
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
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ id: "dm-1", is_direct: true, direct_key: `${USER}:${PEER}` })
    );

    await expect(addMember(ctx, "dm-1", TARGET)).rejects.toBeInstanceOf(
      DirectChannelImmutableError
    );
    // Fails fast on the shape guard — never reaches member/insert paths.
    expect(repo.isActiveWorkspaceMember).not.toHaveBeenCalled();
    expect(repo.insertMember).not.toHaveBeenCalled();
  });
});

/**
 * ⚠ Dropping one of a DM's two rows is PERMANENT: the live row keeps the pair's
 * `direct_key` reserved (partial unique index) so a fresh DM can never be
 * opened, and the evicted side reads the existing one as not-found. Both
 * directions refused — the roster is immutable.
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
    // Fails fast on the shape guard — row never looked up, never deleted.
    expect(repo.countOwners).not.toHaveBeenCalled();
    expect(repo.deleteMember).not.toHaveBeenCalled();
  });

  it("rejects the peer LEAVING a DM (the one-click destroy path)", async () => {
    // Bob is the non-creator, so `canManage` is false.
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
    // Control: the guard is scoped to DMs.
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow({ id: "c-1" }));
    vi.mocked(repo.findMembership).mockImplementation(async (_c, uid) =>
      uid === USER ? memberRow(USER, "owner") : memberRow(uid, "member")
    );

    await removeMember(ctx, "c-1", TARGET);

    expect(repo.deleteMember).toHaveBeenCalledWith("c-1", TARGET);
  });
});

/**
 * The self-heal — the only repair path for pairs torn before the guard existed.
 * ⚠ A torn pair's row is LIVE (`deleted_at` null), so restoring member rows only
 * on `reopenDirectChannel`'s revive branch leaves the missing side falling
 * through to `getChannel` → `ChannelNotFoundError` forever.
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
    // Stand-in for the real visibility gate: a private channel with no
    // membership row for the caller reads as not-found.
    vi.mocked(reads.getChannel).mockImplementation(async (c, ref) => {
      if (!(await repo.findMembership(ref, c.userId))) {
        throw new ChannelNotFoundError(ref);
      }
      return {} as Awaited<ReturnType<typeof reads.getChannel>>;
    });

    await expect(
      createChannel(ctx, { direct: true, memberUserId: PEER })
    ).resolves.toBeDefined();

    // Repaired in place: pair keeps its id and history, no second channel.
    expect(repo.insertChannel).not.toHaveBeenCalled();
    expect(repo.reviveChannel).not.toHaveBeenCalled();
    expect(repo.insertMember).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repo.insertMember).mock.calls[0][0].user_id).toBe(USER);
  });
});

/**
 * ⚠ ONE VERB, TWO DELETES, branching on `is_direct`:
 *  - DM stays SOFT — `deleted_at` is the close half of close/reopen; either
 *    side's next open revives the same row WITH its history, and since the
 *    roster is immutable it is the non-creator's only exit. Both participants
 *    may do it (a DM's `owner` row only records who opened the conversation).
 *  - NON-DM is a real, cascading, PERMANENT delete.
 *
 * Both directions asserted on every case: backwards, the branch destroys a
 * shared transcript on one click, or strands a channel forever. "The other one
 * did not run" is the half that catches a refactor collapsing the branch.
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
    // ⚠ Load-bearing negative: a hard delete here lets one member destroy a
    // shared transcript unilaterally and takes the other side's only exit.
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
    // Authorization unchanged — only the write at the end. Nothing became more
    // permissive alongside becoming permanent.
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow({ id: "c-1" }));
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "member"));

    await expect(deleteChannel(ctx, "c-1")).rejects.toBeInstanceOf(
      ChannelForbiddenError
    );
    expect(repo.softDeleteChannel).not.toHaveBeenCalled();
    expect(repo.hardDeleteChannel).not.toHaveBeenCalled();
  });

  it("a workspace admin can hard-delete a channel they do not belong to", async () => {
    // `canManageChannel`'s other arm — the one caller reaching the destructive
    // path with NO membership row. ⚠ Public, because `loadVisibleChannel` hides
    // a private channel from a non-member regardless of workspace role: the
    // visibility fence runs first and an admin's reach does not widen it.
    const adminCtx: ChannelContext = { ...ctx, role: "admin" };
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ id: "c-2", visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await deleteChannel(adminCtx, "c-2");

    expect(repo.hardDeleteChannel).toHaveBeenCalledWith(WS, "c-2");
  });
});