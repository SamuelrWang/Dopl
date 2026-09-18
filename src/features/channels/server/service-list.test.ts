/**
 * 🔒 **THE ONE CHANNEL-LIST PROJECTION** (Samuel's ruling R-26 (b), 2026-09-17).
 *
 * What is pinned here is the thing the ruling bought: **the two scopes differ in
 * their FENCE and in nothing else.** Every case below either asserts a field of the
 * shared row, or asserts that the two arms reach the SAME hydration.
 *
 * ⚠ These cases arrived from `home/server/service-reads.test.ts` (peers, `linkOut`,
 * the mention badge) and from `service-reads.test.ts` (the direct peer). They are
 * here rather than there because they are properties of ONE projection now —
 * keeping a copy on the /home side is the second suite over one behaviour that the
 * second projection itself was.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-collab");
vi.mock("./repository-list-extras");
vi.mock("./repository-mentions");
vi.mock("@/features/workspaces/server/repository");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as collab from "./repository-collab";
import * as extras from "./repository-list-extras";
import { listMentionStamps } from "./repository-mentions";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import { listAccountChannels, listChannels } from "./service-list";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow } from "./dto";
import type { ChannelLinkRow } from "@/shared/links/dto";

const WS = "ws-1";
const WS2 = "ws-2";
const USER = "user-1";
const OTHER = "user-2";
const THIRD = "user-3";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};

function channelRow(patch: Partial<ChannelRow> = {}): ChannelRow {
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
    ...patch,
  };
}

function memberRow(patch: Partial<ChannelMemberRow> = {}): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: USER,
    workspace_id: WS,
    role: "owner",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
    ...patch,
  };
}

function containerRow(patch: Record<string, unknown> = {}) {
  return {
    id: WS,
    slug: "ada-grace",
    public_id: "abc123def456",
    kind: "link",
    ...patch,
  } as Awaited<ReturnType<typeof extras.listContainers>> extends Map<
    string,
    infer T
  >
    ? T
    : never;
}

function linkRow(patch: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    creator_user_id: USER,
    workspace_id: WS,
    token: "tok_abc",
    label: null,
    expires_at: null,
    max_uses: 1,
    use_count: 0,
    revoked_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    granted_role: "guest",
    ...patch,
  } as ChannelLinkRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.listMyMemberships).mockResolvedValue([memberRow()]);
  vi.mocked(repo.listChannels).mockResolvedValue([channelRow()]);
  vi.mocked(repo.memberCounts).mockResolvedValue(new Map([["chan-1", 1]]));
  vi.mocked(repoMessages.lastMessages).mockResolvedValue(new Map());
  vi.mocked(collab.channelMemberUserIds).mockResolvedValue(new Map());
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map());
  vi.mocked(collab.presenceForWorkspaces).mockResolvedValue(new Map());
  vi.mocked(extras.listContainers).mockResolvedValue(
    new Map([[WS, containerRow()]])
  );
  vi.mocked(extras.listMyContainerRoles).mockResolvedValue(new Map());
  vi.mocked(extras.listChannelPeerIds).mockResolvedValue(new Map());
  vi.mocked(extras.listLinksByWorkspaces).mockResolvedValue(new Map());
  vi.mocked(extras.listAccountChannelRows).mockResolvedValue({
    rows: [channelRow()],
    truncated: false,
  });
  vi.mocked(extras.listMyMembershipsByChannel).mockResolvedValue(
    new Map([["chan-1", memberRow()]])
  );
  vi.mocked(listMentionStamps).mockResolvedValue([]);
  vi.mocked(listProfileSummaries).mockResolvedValue(new Map());
});

describe("the container address on every row (R-32)", () => {
  it("carries the id, the kind and the `{slug}-{publicId}` segment", async () => {
    const [row] = await listChannels(ctx);
    expect(row.container).toEqual({
      id: WS,
      kind: "link",
      segment: "ada-grace-abc123def456",
    });
  });

  it("reads an ABSENT kind as `standard` — §4A's default outlives the column", async () => {
    vi.mocked(extras.listContainers).mockResolvedValue(
      new Map([[WS, containerRow({ kind: null })]])
    );
    const [row] = await listChannels(ctx);
    expect(row.container.kind).toBe("standard");
  });

  it("still RENDERS a row whose container did not come back", async () => {
    // ⚠ Dropping it would hide a channel because a join was torn. The address
    // degrades to the id with no segment, which every caller can still act on.
    vi.mocked(extras.listContainers).mockResolvedValue(new Map());
    const [row] = await listChannels(ctx);
    expect(row.container).toEqual({ id: WS, kind: "standard", segment: "" });
  });
});

describe("the caller's CONTAINER role (F-343)", () => {
  it("is the membership row's, not the channel role", async () => {
    vi.mocked(extras.listMyContainerRoles).mockResolvedValue(
      new Map([[WS, "member"]])
    );
    const [row] = await listChannels(ctx);
    expect(row.myWorkspaceRole).toBe("member");
    // ⚠ TWO LADDERS, TWO NAMES — `role` is the CHANNEL role and has no `guest`.
    expect(row.role).toBe("owner");
  });

  it("is NULL when the membership row did not come back — a torn read, not a state", async () => {
    const [row] = await listChannels(ctx);
    expect(row.myWorkspaceRole).toBeNull();
  });

  it("asks for the CALLER's own rows, once for the whole page", async () => {
    await listChannels(ctx);
    expect(extras.listMyContainerRoles).toHaveBeenCalledTimes(1);
    expect(extras.listMyContainerRoles).toHaveBeenCalledWith([WS], USER);
  });
});

describe("peers — the roster sample", () => {
  it("hydrates every id the repository returned, in its order", async () => {
    vi.mocked(extras.listChannelPeerIds).mockResolvedValue(
      new Map([["chan-1", [OTHER, THIRD]]])
    );
    vi.mocked(listProfileSummaries).mockResolvedValue(
      new Map([
        [OTHER, { email: "o@x.dev", displayName: "Otto", avatarUrl: null }],
        [THIRD, { email: "t@x.dev", displayName: "Tia", avatarUrl: null }],
      ])
    );
    const [row] = await listChannels(ctx);
    expect(row.peers.map((p) => p.userId)).toEqual([OTHER, THIRD]);
    expect(row.peers.map((p) => p.displayName)).toEqual(["Otto", "Tia"]);
  });

  it("KEEPS a member whose profile row is missing rather than dropping them", async () => {
    // A face the operator cannot name is still a person in the room; dropping
    // them would silently shrink the roster the row claims to show.
    vi.mocked(extras.listChannelPeerIds).mockResolvedValue(
      new Map([["chan-1", [OTHER]]])
    );
    const [row] = await listChannels(ctx);
    expect(row.peers).toEqual([
      { userId: OTHER, displayName: null, email: null, avatarUrl: null },
    ]);
  });

  it("asks for each profile ONCE however many channels share a member", async () => {
    vi.mocked(repo.listChannels).mockResolvedValue([
      channelRow(),
      channelRow({ id: "chan-2" }),
    ]);
    vi.mocked(extras.listChannelPeerIds).mockResolvedValue(
      new Map([
        ["chan-1", [OTHER]],
        ["chan-2", [OTHER]],
      ])
    );
    await listChannels(ctx);
    expect(listProfileSummaries).toHaveBeenCalledTimes(1);
    expect(listProfileSummaries).toHaveBeenCalledWith([OTHER]);
  });

  it("is EMPTY for a channel the caller is alone in — finished, not broken", async () => {
    const [row] = await listChannels(ctx);
    expect(row.peers).toEqual([]);
  });
});

describe("the direct peer", () => {
  it("resolves the other member for a direct channel; null for a normal one", async () => {
    const directKey = [USER, OTHER].sort().join(":");
    vi.mocked(repo.listChannels).mockResolvedValue([
      channelRow(),
      channelRow({ id: "dm-1", is_direct: true, direct_key: directKey }),
    ]);
    vi.mocked(collab.channelMemberUserIds).mockResolvedValue(
      new Map([
        ["chan-1", [USER]],
        ["dm-1", [USER, OTHER]],
      ])
    );
    vi.mocked(extras.listChannelPeerIds).mockResolvedValue(
      new Map([["dm-1", [OTHER]]])
    );
    vi.mocked(listProfileSummaries).mockResolvedValue(
      new Map([
        [
          OTHER,
          { email: "o@x.com", displayName: "Otto", avatarUrl: "http://x/o.png" },
        ],
      ])
    );

    const rows = await listChannels(ctx);
    expect(rows.find((c) => c.id === "chan-1")?.directPeer).toBeNull();
    expect(rows.find((c) => c.id === "dm-1")?.directPeer).toMatchObject({
      userId: OTHER,
      displayName: "Otto",
      avatarUrl: "http://x/o.png",
    });
    // ⚠ ONE PROFILE READ for the page — the roster sample and the direct peer
    // share it, so faces cost no second query.
    expect(listProfileSummaries).toHaveBeenCalledTimes(1);
  });
});

describe("the `@ N` mention count (R-28)", () => {
  it("counts only stamps NEWER than the caller's own watermark", async () => {
    vi.mocked(extras.listMyMembershipsByChannel).mockResolvedValue(
      new Map([["chan-1", memberRow({ last_read_at: "2026-09-13T12:00:00Z" })]])
    );
    vi.mocked(repo.listMyMemberships).mockResolvedValue([
      memberRow({ last_read_at: "2026-09-13T12:00:00Z" }),
    ]);
    vi.mocked(listMentionStamps).mockResolvedValue([
      { channelId: "chan-1", createdAt: "2026-09-13T13:00:00Z" },
      { channelId: "chan-1", createdAt: "2026-09-13T11:00:00Z" },
    ]);
    const [row] = await listChannels(ctx);
    expect(row.mentionCount).toBe(1);
  });

  it("is 0 for a NON-MEMBER, and scans no ids for them", async () => {
    // There is no watermark to advance, so a badge there could never clear.
    vi.mocked(repo.listMyMemberships).mockResolvedValue([]);
    vi.mocked(listMentionStamps).mockResolvedValue([
      { channelId: "chan-1", createdAt: "2026-09-13T13:00:00Z" },
    ]);
    const [row] = await listChannels(ctx);
    expect(row.mentionCount).toBe(0);
    expect(vi.mocked(listMentionStamps).mock.calls[0][0]).toEqual([]);
  });

  it("floors the scan at the OLDEST watermark on the page, never the newest", async () => {
    // ⚠ A MAXIMUM here would filter an earlier-read channel's unread mentions out
    // in SQL, where no tally could recover them.
    vi.mocked(repo.listChannels).mockResolvedValue([
      channelRow(),
      channelRow({ id: "chan-2" }),
    ]);
    vi.mocked(repo.listMyMemberships).mockResolvedValue([
      memberRow({ last_read_at: "2026-09-13T12:00:00Z" }),
      memberRow({ channel_id: "chan-2", last_read_at: "2026-09-01T00:00:00Z" }),
    ]);
    await listChannels(ctx);
    expect(vi.mocked(listMentionStamps).mock.calls[0][2]).toBe(
      "2026-09-01T00:00:00Z"
    );
  });

  it("falls back to the CHANNEL's birth for a never-read channel", async () => {
    // No message can predate its channel, so this is "everything" expressed as an
    // instant — which is what lets the scan stay floored at all.
    await listChannels(ctx);
    expect(vi.mocked(listMentionStamps).mock.calls[0][2]).toBe(
      "2026-07-20T00:00:00Z"
    );
  });
});

describe("linkOut — the open bound invitation", () => {
  it("rides its own channel, with the claim URL rather than the raw token", async () => {
    vi.mocked(extras.listLinksByWorkspaces).mockResolvedValue(
      new Map([[WS, linkRow()]])
    );
    const [row] = await listChannels(ctx);
    expect(row.linkOut).toMatchObject({ id: "link-1", grantedRole: "guest" });
    expect(row.linkOut?.url).toContain("/link/tok_abc");
    expect(JSON.stringify(row.linkOut)).not.toContain('"token"');
  });

  it("shows NO chip for a link the claim gate would 410", async () => {
    // ⚠ Judged by the gate's OWN predicate — a chip saying "invite out" over a
    // dead link is the disagreement `isClaimable` exists to prevent.
    vi.mocked(extras.listLinksByWorkspaces).mockResolvedValue(
      new Map([[WS, linkRow({ use_count: 1 })]])
    );
    const [row] = await listChannels(ctx);
    expect(row.linkOut).toBeNull();
  });
});

describe("scope=account — the same projection behind the USER fence", () => {
  it("hydrates the identical row shape the container scope answers", async () => {
    vi.mocked(extras.listMyContainerRoles).mockResolvedValue(
      new Map([[WS, "owner"]])
    );
    const { channels } = await listAccountChannels(USER, null);
    const [mine] = await listChannels(ctx);
    expect(Object.keys(channels[0]).sort()).toEqual(Object.keys(mine).sort());
    expect(channels[0].container).toEqual(mine.container);
  });

  it("REPORTS its clip, where the deleted /home read carried three silent ceilings", async () => {
    vi.mocked(extras.listAccountChannelRows).mockResolvedValue({
      rows: [channelRow()],
      truncated: true,
    });
    expect((await listAccountChannels(USER, null)).truncated).toBe(true);
  });

  it("applies the credential's container LOCK at the PROOF (B1 / R3)", async () => {
    await listAccountChannels(USER, WS2);
    expect(extras.listAccountChannelRows).toHaveBeenCalledWith(
      USER,
      WS2,
      expect.any(Number)
    );
  });

  it("asks presence ONCE for every container, never per container", async () => {
    vi.mocked(extras.listAccountChannelRows).mockResolvedValue({
      rows: [channelRow(), channelRow({ id: "chan-2", workspace_id: WS2 })],
      truncated: false,
    });
    await listAccountChannels(USER, null);
    expect(collab.presenceForWorkspaces).toHaveBeenCalledTimes(1);
    expect(collab.presenceForWorkspaces).toHaveBeenCalledWith([WS, WS2]);
    expect(collab.presenceForWorkspace).not.toHaveBeenCalled();
  });

  it("does NOT filter by container kind — a host narrows on the row", async () => {
    // ⚠ Filtering here would rebuild `/api/home/channels` inside the one route.
    // The kind is on the row so a host can ask POSITIVELY (master §4.2 G3).
    vi.mocked(extras.listAccountChannelRows).mockResolvedValue({
      rows: [channelRow(), channelRow({ id: "chan-2", workspace_id: WS2 })],
      truncated: false,
    });
    vi.mocked(extras.listContainers).mockResolvedValue(
      new Map([
        [WS, containerRow()],
        [WS2, containerRow({ id: WS2, kind: "standard", slug: "acme" })],
      ])
    );
    const { channels } = await listAccountChannels(USER, null);
    expect(channels.map((c) => c.container.kind)).toEqual(["link", "standard"]);
  });

  it("short-circuits on an empty membership set", async () => {
    vi.mocked(extras.listAccountChannelRows).mockResolvedValue({
      rows: [],
      truncated: false,
    });
    const { channels } = await listAccountChannels(USER, null);
    expect(channels).toEqual([]);
    expect(extras.listMyMembershipsByChannel).not.toHaveBeenCalled();
  });
});
