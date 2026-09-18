/**
 * 🔒 **THE FENCE OF THE ONE CHANNEL-LIST PROJECTION** (R-26 (b), 2026-09-17).
 *
 * `service-list.test.ts` pins the shared ROW; this file pins who is NOT in it. The
 * route half — which wrapper each arm carries, and that a bad `scope` reaches
 * neither — is `src/app/api/channels/route-scope-fence.test.ts`.
 *
 * ⚠ **ITS OWN FILE BECAUSE `service-list.test.ts` IS AT §1's 500-LINE CAP**, along
 * the seam that was already there: the row, and the fence around it.
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

const WS = "ws-1";
const USER = "user-1";

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

/**
 * ⚠ **THE TEST IS THAT THE CHANNEL IS NEVER NAMED, NOT THAT IT IS FILTERED OUT
 * AFTERWARDS.** Every read below takes an id array a fence produced; a case that
 * only checked the returned rows would pass against a projection that had already
 * asked the database about somebody else's room.
 */
describe("the fence — who is NOT in the answer", () => {
  it("names NOTHING for a non-member of the container (scope=container)", async () => {
    vi.mocked(repo.listMyMemberships).mockResolvedValue([]);
    vi.mocked(repo.listChannels).mockResolvedValue([]);
    const channels = await listChannels({ ...ctx, role: "guest" });
    expect(channels).toEqual([]);
    expect(repo.listChannels).toHaveBeenCalledWith(WS, {
      memberChannelIds: [],
      includePublic: false,
    });
    // ⚠ No id set ⇒ no second tier. A hydration keyed on an empty array is
    // harmless; one keyed on ids nobody proved is the leak.
    expect(listMentionStamps).toHaveBeenCalledWith([], USER, null, 500);
  });

  it("gives a GUEST no public arm, and a viewer+ one (2026-08-26)", async () => {
    await listChannels({ ...ctx, role: "guest" });
    expect(repo.listChannels).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ includePublic: false })
    );
    vi.mocked(repo.listChannels).mockClear();
    await listChannels({ ...ctx, role: "viewer" });
    expect(repo.listChannels).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ includePublic: true })
    );
  });

  it("gives a DEPARTED member no watermark, so no badge and no scanned id", async () => {
    // ⚠ DEPARTURE IS A DELETED ROW, not a status flip
    // (`20260810140000_channel_members_departed_backfill.sql`), so the membership
    // map is where a departure shows up. A row admitted by the PUBLIC arm reaches
    // the projection with no membership: display-only, and no mark it could clear.
    vi.mocked(repo.listMyMemberships).mockResolvedValue([]);
    vi.mocked(repo.listChannels).mockResolvedValue([
      channelRow({ visibility: "public" }),
    ]);
    const [row] = await listChannels({ ...ctx, role: "member" });
    expect(row.role).toBeNull();
    expect(row.isMember).toBe(false);
    expect(row.unread).toBe(false);
    expect(row.mentionCount).toBe(0);
    expect(listMentionStamps).toHaveBeenCalledWith([], USER, null, 500);
  });

  it("never NAMES a container the caller cannot see (scope=account)", async () => {
    // The proof is the only source of ids, so a foreign room cannot appear in any
    // `.in()` below it — including the one the badge would scan.
    vi.mocked(extras.listAccountChannelRows).mockResolvedValue({
      rows: [channelRow()],
      truncated: false,
    });
    await listAccountChannels(USER, null);
    for (const call of [
      vi.mocked(repo.memberCounts).mock.calls[0][0],
      vi.mocked(repoMessages.lastMessages).mock.calls[0][0],
      vi.mocked(collab.channelMemberUserIds).mock.calls[0][0],
    ]) {
      expect(call).toEqual(["chan-1"]);
    }
    expect(vi.mocked(extras.listContainers).mock.calls[0][0]).toEqual([WS]);
    expect(vi.mocked(collab.presenceForWorkspaces).mock.calls[0][0]).toEqual([WS]);
    expect(vi.mocked(listMentionStamps).mock.calls[0][0]).toEqual(["chan-1"]);
  });

  it("🔒 derives `myWorkspaceRole` from the MEMBERSHIP ROW ALONE (F-343)", async () => {
    // /home hardcoded `"owner"` on the grounds that a home container is the
    // caller's own — true of one they CREATED, false of every one they JOINED.
    vi.mocked(extras.listMyContainerRoles).mockResolvedValue(
      new Map([[WS, "guest"]])
    );
    const [row] = await listChannels(ctx);
    // ⚠ NOT `role`, which is the CHANNEL role off the same page's membership row.
    expect(row.myWorkspaceRole).toBe("guest");
    expect(row.role).toBe("owner");
    expect(extras.listMyContainerRoles).toHaveBeenCalledWith([WS], USER);
  });
});
