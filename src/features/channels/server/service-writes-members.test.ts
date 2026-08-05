/**
 * `removeMember` — WHO MAY REMOVE WHOM, and when the delete does not happen.
 *
 * This file used to be about a SWEEP. `channel_agents` had no FK to
 * `channel_members`, so agent engagement outlived membership, and a departure
 * had to clear every engagement the leaver had created on the way out. Named
 * agents and engagement are gone (rollback §1), the sweep with them, and the
 * cases below are what is left standing on its own: a departure is a membership
 * write, and the three states in which it must NOT write are still states.
 *
 * The rest of the membership lane's rules (the DM's immutable roster, self-join)
 * are pinned in `service-direct.test.ts` and `service-writes.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");

import * as repo from "./repository";
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
});

describe("removeMember — the delete, and the three states that stop it", () => {
  it("removes the target member from THIS channel", async () => {
    await removeMember(ctx, "room", PEER);

    expect(repo.deleteMember).toHaveBeenCalledWith("chan-1", PEER);
  });

  it("lets a member LEAVE on their own", async () => {
    await removeMember(ctx, "room", USER);

    expect(repo.deleteMember).toHaveBeenCalledWith("chan-1", USER);
  });

  it("is an idempotent no-op when there was no membership to remove", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      userId === USER ? memberRow(USER, "owner") : null
    );

    await removeMember(ctx, "room", PEER);

    expect(repo.deleteMember).not.toHaveBeenCalled();
  });

  it("REFUSES to remove the last owner", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "owner"));
    vi.mocked(repo.countOwners).mockResolvedValue(1);

    await expect(removeMember(ctx, "room", USER)).rejects.toThrow(
      ChannelLastOwnerError
    );
    expect(repo.deleteMember).not.toHaveBeenCalled();
  });

  it("REFUSES a caller who may not remove somebody else", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      memberRow(userId)
    );

    await expect(removeMember(ctx, "room", PEER)).rejects.toThrow(
      ChannelForbiddenError
    );
    expect(repo.deleteMember).not.toHaveBeenCalled();
  });
});
