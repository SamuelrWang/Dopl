/**
 * LEAVING A CHANNEL ENDS WHAT YOU STARTED — `removeMember` and the agent
 * engagement it has to clean up on the way out.
 *
 * S3, the hole this pins closed. `channel_agents` has no FK to
 * `channel_members`, so engagement OUTLIVES membership: Sam tags `@quartz` in a
 * private channel and then leaves, and quartz stays engaged for the rest of the
 * TTL — acting on the UNTAGGED messages of everyone still in the room, on
 * standing orders from someone who is no longer there. Nobody could undo it
 * either: `disengageAgent` starts at `loadVisibleChannel`, and a private channel
 * reads as NOT-FOUND to a non-member, so the one person the permission was
 * granted to was locked out of using it. The removal is the last moment at
 * which anyone still holds both facts, so it is where the sweep belongs.
 *
 * The sweep is FAIL-SOFT: the membership row is already gone by the time it
 * runs, so throwing would report a failed removal that actually happened, and
 * the caller's retry would return early on the missing target and never reach
 * the sweep again.
 *
 * The rest of the membership lane's rules (the DM's immutable roster, the last
 * owner, self-join) are pinned in `service-direct.test.ts` and
 * `service-writes.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-agents");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import { ChannelForbiddenError, ChannelLastOwnerError } from "./errors";
import { removeMember } from "./service-writes-members";
import type { ChannelMemberRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";

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
    slug: "room",
    name: "Room",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
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
    joined_at: "2026-07-31T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER ? memberRow(USER, "owner") : memberRow(userId)
  );
  vi.mocked(repo.countOwners).mockResolvedValue(2);
  vi.mocked(repo.deleteMember).mockResolvedValue(undefined);
  vi.mocked(repoAgents.clearEngagementByEngager).mockResolvedValue(undefined);
});

describe("removeMember — a departing engager's engagement is cleared", () => {
  it("clears engagement for the REMOVED member, in THAT channel", async () => {
    await removeMember(ctx, "room", PEER);

    expect(repoAgents.clearEngagementByEngager).toHaveBeenCalledWith(
      "chan-1",
      PEER
    );
  });

  it("clears it when a member LEAVES on their own", async () => {
    // The commonest shape of the bug: Sam tags @quartz, then leaves, and
    // cannot reach `disengageAgent` afterwards on a private channel.
    await removeMember(ctx, "room", USER);

    expect(repoAgents.clearEngagementByEngager).toHaveBeenCalledWith(
      "chan-1",
      USER
    );
  });

  it("clears AFTER the membership row is gone, never before", async () => {
    const order: string[] = [];
    vi.mocked(repo.deleteMember).mockImplementation(async () => {
      order.push("delete");
    });
    vi.mocked(repoAgents.clearEngagementByEngager).mockImplementation(
      async () => {
        order.push("clear");
      }
    );

    await removeMember(ctx, "room", PEER);

    // A clear that ran first and then hit a failed delete would have
    // disengaged an agent for a member who is still in the room.
    expect(order).toEqual(["delete", "clear"]);
  });

  it("FAIL-SOFT: a cleanup failure does not fail the removal", async () => {
    vi.mocked(repoAgents.clearEngagementByEngager).mockRejectedValue(
      new Error("pg down")
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(removeMember(ctx, "room", PEER)).resolves.toBeUndefined();

    // The member IS removed by then — that write has committed — so reporting a
    // failure would describe a removal that happened, and the retry would
    // return early on the missing target and never sweep at all.
    expect(repo.deleteMember).toHaveBeenCalledWith("chan-1", PEER);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("does not sweep when there was no membership to remove", async () => {
    // Idempotent no-op path: nobody left, so nothing to clean up.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      userId === USER ? memberRow(USER, "owner") : null
    );

    await removeMember(ctx, "room", PEER);

    expect(repo.deleteMember).not.toHaveBeenCalled();
    expect(repoAgents.clearEngagementByEngager).not.toHaveBeenCalled();
  });

  it("does not sweep when the removal is REFUSED (last owner)", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));
    vi.mocked(repo.countOwners).mockResolvedValue(1);

    await expect(removeMember(ctx, "room", USER)).rejects.toThrow(
      ChannelLastOwnerError
    );
    expect(repoAgents.clearEngagementByEngager).not.toHaveBeenCalled();
  });

  it("does not sweep when the caller is not allowed to remove", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      memberRow(userId)
    );

    await expect(removeMember(ctx, "room", PEER)).rejects.toThrow(
      ChannelForbiddenError
    );
    expect(repoAgents.clearEngagementByEngager).not.toHaveBeenCalled();
  });
});
