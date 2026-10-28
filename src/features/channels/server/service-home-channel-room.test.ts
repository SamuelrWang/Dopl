/**
 * 🔒 A HOME CHANNEL HOLDS EXACTLY ONE ROOM (INVARIANTS §4A). A `kind='link'`
 * container IS its room — the desktop sidebar keys rows by container — so a
 * second channel, named or DM, is refused in the SERVICE layer (HTTP and MCP
 * alike), with a message that names the recovery (`dopl_create_workspace`).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-threads");
vi.mock("./repository-agents");
vi.mock("./service-reads");
vi.mock("./service-list");

import * as repo from "./repository";
import * as list from "./service-list";
import { createChannel } from "./service-writes";
import { HomeChannelHasRoomError } from "./errors";
import { toChannelErrorResponse } from "./http-mapping";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow } from "./dto";

const WS = "ws-1";
const USER = "aaaaaaaa-e29b-41d4-a716-446655440000";
const PEER = "bbbbbbbb-e29b-41d4-a716-446655440000";
const OTHER = "cccccccc-e29b-41d4-a716-446655440000";

const base: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "agent",
  role: "owner",
};
const homeChannel: ChannelContext = { ...base, workspaceKind: "link" };
const workspace: ChannelContext = { ...base, workspaceKind: "standard" };

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-new",
    workspace_id: WS,
    created_by: USER,
    slug: "dopl-sdk",
    name: "Dopl (SDK)",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-10-28T00:00:00Z",
    updated_at: "2026-10-28T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.existingSlugs).mockResolvedValue([]);
  vi.mocked(repo.insertChannel).mockResolvedValue(channelRow());
  vi.mocked(repo.insertMember).mockResolvedValue({} as ChannelMemberRow);
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(list.getChannel).mockResolvedValue(
    {} as Awaited<ReturnType<typeof list.getChannel>>
  );
});

describe("createChannel — a home channel container holds exactly one room", () => {
  it("refuses a second named room in a home_channel container that already has one", async () => {
    vi.mocked(repo.listContainerChannelShapes).mockResolvedValue([
      { is_direct: false, direct_key: null },
    ]);

    await expect(
      createChannel(homeChannel, { name: "Dopl (SDK)" })
    ).rejects.toBeInstanceOf(HomeChannelHasRoomError);
    expect(repo.insertChannel).not.toHaveBeenCalled();
    expect(repo.insertMember).not.toHaveBeenCalled();
  });

  it("refuses a `to` DM in a home_channel container that already has a room", async () => {
    vi.mocked(repo.listContainerChannelShapes).mockResolvedValue([
      { is_direct: false, direct_key: null },
    ]);

    await expect(
      createChannel(homeChannel, { direct: true, memberUserId: PEER })
    ).rejects.toBeInstanceOf(HomeChannelHasRoomError);
    expect(repo.insertChannel).not.toHaveBeenCalled();
  });

  it("refuses a DM to a DIFFERENT pair in a legacy pair container (its one room is someone else's DM)", async () => {
    vi.mocked(repo.listContainerChannelShapes).mockResolvedValue([
      { is_direct: true, direct_key: [USER, OTHER].sort().join(":") },
    ]);

    await expect(
      createChannel(homeChannel, { direct: true, memberUserId: PEER })
    ).rejects.toBeInstanceOf(HomeChannelHasRoomError);
    expect(repo.insertChannel).not.toHaveBeenCalled();
  });

  it("lets the SAME pair's DM open through: that is the dedup/revive of the one room, not a second", async () => {
    const key = [USER, PEER].sort().join(":");
    vi.mocked(repo.listContainerChannelShapes).mockResolvedValue([
      { is_direct: true, direct_key: key },
    ]);
    vi.mocked(repo.findDirectChannelAnyStatus).mockResolvedValue(
      channelRow({ id: "dm-1", is_direct: true, direct_key: key })
    );
    vi.mocked(repo.findMembership).mockResolvedValue({} as ChannelMemberRow);

    await expect(
      createChannel(homeChannel, { direct: true, memberUserId: PEER })
    ).resolves.toBeDefined();
    expect(repo.insertChannel).not.toHaveBeenCalled();
  });

  it("allows the FIRST room of an empty home_channel container", async () => {
    vi.mocked(repo.listContainerChannelShapes).mockResolvedValue([]);

    await createChannel(homeChannel, { name: "Dopl" });
    expect(repo.insertChannel).toHaveBeenCalledTimes(1);
  });

  it("a normal workspace still takes any number of channels, without the room read", async () => {
    await createChannel(workspace, { name: "Dopl (SDK)" });

    expect(repo.insertChannel).toHaveBeenCalledTimes(1);
    expect(repo.listContainerChannelShapes).not.toHaveBeenCalled();
  });

  it("maps to 409 HOME_CHANNEL_HAS_ROOM and the message names the recovery", async () => {
    const res = toChannelErrorResponse(new HomeChannelHasRoomError());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("HOME_CHANNEL_HAS_ROOM");
    expect(body.error.message).toContain("exactly one room");
    expect(body.error.message).toContain("dopl_create_workspace(name=");
  });
});
