/**
 * Unit tests for the channels read service — the `listChannelMembers`
 * notify-scope privacy rule. Repository mocked; service-shared runs for real.
 *
 * Invariant: `notify_scope` is a private per-member preference. The roster
 * exposes it ONLY on the caller's OWN row; every other member's `notifyScope`
 * is nulled so no one can see who muted the channel.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-collab");

import * as repo from "./repository";
import * as collab from "./repository-collab";
import { listChannelMembers, listChannels } from "./service-reads";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const OTHER = "user-2";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

function channelRow(): ChannelRow {
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
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
  };
}

function memberRow(userId: string, notifyScope: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: userId === USER ? "owner" : "member",
    last_read_at: null,
    notify_scope: notifyScope,
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  // loadVisibleChannel gate: caller is a member of the private channel.
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "none"));
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  // Presence hydration: no one online by default.
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map());
});

describe("listChannelMembers — notify_scope privacy", () => {
  it("exposes the caller's own notifyScope, nulls every other member's", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "none"), // caller — muted; must stay visible to self
      memberRow(OTHER, "all"), // teammate — scope must be hidden
    ]);

    const members = await listChannelMembers(ctx, "general");

    const mine = members.find((m) => m.userId === USER);
    const theirs = members.find((m) => m.userId === OTHER);
    expect(mine?.notifyScope).toBe("none");
    expect(theirs?.notifyScope).toBeNull();
    // agent_tool_profile is private the same way: self only.
    expect(mine?.agentToolProfile).toBe("full");
    expect(theirs?.agentToolProfile).toBeNull();
    // Other roster fields for the teammate are still present.
    expect(theirs?.role).toBe("member");
  });

  it("exposes presence (agentOnline / lastSeenAt) for every member", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "all"),
      memberRow(OTHER, "all"),
    ]);
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
      new Map([[OTHER, { online: true, lastSeenAt: "2026-07-26T00:00:00Z" }]])
    );

    const members = await listChannelMembers(ctx, "general");
    const mine = members.find((m) => m.userId === USER);
    const theirs = members.find((m) => m.userId === OTHER);
    // Presence is NOT private — a teammate's online agent must be visible.
    expect(theirs?.agentOnline).toBe(true);
    expect(theirs?.lastSeenAt).toBe("2026-07-26T00:00:00Z");
    expect(mine?.agentOnline).toBe(false);
  });
});

describe("listChannels — direct peer resolution", () => {
  it("resolves the peer (other member) for a direct channel; null for a normal one", async () => {
    const directKey = [USER, OTHER].sort().join(":");
    vi.mocked(repo.listMyMemberships).mockResolvedValue([
      memberRow(USER, "all"),
      { ...memberRow(USER, "all"), channel_id: "dm-1" },
    ]);
    vi.mocked(repo.listChannels).mockResolvedValue([
      channelRow(),
      { ...channelRow(), id: "dm-1", is_direct: true, direct_key: directKey },
    ]);
    vi.mocked(repo.memberCounts).mockResolvedValue(new Map());
    vi.mocked(repo.lastMessages).mockResolvedValue(new Map());
    vi.mocked(collab.channelMemberUserIds).mockResolvedValue(
      new Map([
        ["chan-1", [USER]],
        ["dm-1", [USER, OTHER]],
      ])
    );
    vi.mocked(repo.fetchProfiles).mockResolvedValue([
      { id: OTHER, email: "o@x.com", display_name: "Otto", avatar_url: "http://x/o.png" },
    ]);

    const channels = await listChannels(ctx, false);
    const normal = channels.find((c) => c.id === "chan-1");
    const dm = channels.find((c) => c.id === "dm-1");
    expect(normal?.isDirect).toBe(false);
    expect(normal?.directPeer).toBeNull();
    expect(dm?.isDirect).toBe(true);
    expect(dm?.directPeer).toMatchObject({
      userId: OTHER,
      displayName: "Otto",
      avatarUrl: "http://x/o.png",
    });
  });
});
