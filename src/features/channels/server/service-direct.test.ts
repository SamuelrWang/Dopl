/**
 * Unit tests for channel + direct-channel CREATION — slug allocation, the DM
 * dedup/revive path, and the DM's fixed two-member shape. Split out of
 * `service-tasks.test.ts` (§2 cap): channel creation is its own lane.
 *
 * Focus (the load-bearing rules):
 *   - slug allocation must agree with `channels_workspace_slug_key`, which is
 *     NOT partial: a soft-deleted channel still owns its slug, so recreating a
 *     deleted name must pick the next free one instead of 409-ing (and, on the
 *     DM path, 500-ing) against a channel the user can no longer see;
 *   - direct channels: self-DM rejected, dedup returns the existing channel, a
 *     soft-deleted DM is revived, a new DM inserts exactly two members with a
 *     sorted direct_key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./service-reads");

import * as repo from "./repository";
import * as reads from "./service-reads";
import { addMember, createChannel } from "./service-writes";
import {
  ChannelInviteeNotMemberError,
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

  it("dedups: returns the existing (live) DM without inserting or reviving", async () => {
    vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({ id: "dm-existing", is_direct: true })
    );

    await createChannel(ctx, { direct: true, memberUserId: PEER });

    expect(repo.insertChannel).not.toHaveBeenCalled();
    // A live row (deleted_at null) is never revived and never re-adds members.
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