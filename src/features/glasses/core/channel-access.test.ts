import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest } from "./testing/fake-postgrest";

const USER = "11111111-1111-4111-8111-111111111111";
const LIVE = "22222222-2222-4222-8222-222222222222";
const ARCHIVED = "33333333-3333-4333-8333-333333333333";
const DELETED = "44444444-4444-4444-8444-444444444444";
const NOT_MEMBER = "55555555-5555-4555-8555-555555555555";

let db = fakePostgrest({});
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => db }));

const postMessage = vi.fn();
const listChannelSessionStates = vi.fn();
vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (a: unknown) => a,
  postMessage: (...a: unknown[]) => postMessage(...a),
}));
vi.mock("@/features/channels/server/service-shared", () => ({
  agentNamesFor: async () => new Map([["abcdefgh", "Orchestrator"]]),
}));
vi.mock("@/features/channels/server/repository-sessions", () => ({
  listChannelSessionStates: (...a: unknown[]) => listChannelSessionStates(...a),
}));
const listAccountChannelRows = vi.fn();
const lastMessages = vi.fn();
vi.mock("@/features/channels/server/repository-account", () => ({ ACCOUNT_CHANNEL_LIMIT: 500 }));
vi.mock("@/features/channels/server/repository-list-extras", () => ({
  listAccountChannelRows: (...a: unknown[]) => listAccountChannelRows(...a),
}));
vi.mock("@/features/channels/server/repository-messages", () => ({
  lastMessages: (...a: unknown[]) => lastMessages(...a),
}));
vi.mock("@/features/workspaces/server/service", () => ({
  resolveActiveWorkspace: async () => ({ workspace: { id: "ws-1", kind: "link" }, membership: { role: "owner" } }),
}));

const { channelLinker } = await import("./devices/channel-link");
const { glassesChannelGateway } = await import("./voice/channel-gateway");
const { linkOf } = await import("./devices/service");

beforeEach(() => {
  const channel = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: `room-${id.slice(0, 2)}`,
    workspace_id: "ws-1",
    archived_at: null,
    deleted_at: null,
    ...extra,
  });
  db = fakePostgrest({
    channels: [channel(LIVE), channel(ARCHIVED, { archived_at: "t" }), channel(DELETED, { deleted_at: "t" }), channel(NOT_MEMBER)],
    channel_members: [LIVE, ARCHIVED, DELETED].map((c) => ({ channel_id: c, user_id: USER })),
    channel_messages: [
      { id: "m1", seq: 10, channel_id: LIVE, author_kind: "user", kind: "message", body: "hi", workspace_id: "ws-1", client_msg_id: null, metadata: null },
      { id: "m2", seq: 11, channel_id: LIVE, author_kind: "agent", kind: "task_progress", body: "went idle", workspace_id: "ws-1", client_msg_id: null, metadata: null },
      { id: "m3", seq: 12, channel_id: LIVE, author_kind: "agent", kind: "message", body: "pong", workspace_id: "ws-1", client_msg_id: null, metadata: { session_id: `${LIVE}::abcdefgh` } },
    ],
  });
  postMessage.mockReset();
  listChannelSessionStates.mockReset();
  listAccountChannelRows.mockReset();
  lastMessages.mockReset();
});

describe("channel-link: what a device may link, see and keep", () => {
  it("links only live channels the user is a member of", async () => {
    expect(await linkOf(channelLinker, USER, LIVE)).toEqual({ channelId: LIVE, containerId: "ws-1", name: "room-22" });
    for (const id of [ARCHIVED, DELETED, NOT_MEMBER, "nope"]) expect(await linkOf(channelLinker, USER, id)).toBeNull();
  });

  it("never reveals names of channels the user cannot link", async () => {
    const links = await channelLinker.linkable(USER, [LIVE, ARCHIVED, DELETED, NOT_MEMBER]);
    expect([...links.keys()]).toEqual([LIVE]);
    expect(await linkOf(channelLinker, USER, LIVE)).not.toBeNull();
    expect(await linkOf(channelLinker, USER, NOT_MEMBER)).toBeNull();
  });
});

describe("channel-link: most recent channel (voice fallback)", () => {
  const OTHER = "66666666-6666-4666-8666-666666666666";
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    workspace_id: "ws-1",
    archived_at: null,
    deleted_at: null,
    is_direct: false,
    created_at: "2026-09-01T00:00:00Z",
    ...extra,
  });

  it("picks the most recently active live, non-direct channel, re-confirmed as linkable", async () => {
    const DM = "77777777-7777-4777-8777-777777777777";
    listAccountChannelRows.mockResolvedValue({
      rows: [row(LIVE), row(ARCHIVED, { archived_at: "t" }), row(DM, { is_direct: true }), row(NOT_MEMBER)],
      truncated: false,
    });
    // NOT_MEMBER ranks first but fails the membership re-check; the DM is never considered.
    lastMessages.mockResolvedValue(
      new Map([
        [NOT_MEMBER, "2026-09-28T10:00:00Z"],
        [DM, "2026-09-28T11:00:00Z"],
        [LIVE, "2026-09-27T10:00:00Z"],
      ]),
    );
    expect(await channelLinker.mostRecent(USER)).toEqual({ channelId: LIVE, containerId: "ws-1", name: "room-22" });
    expect(lastMessages.mock.calls[0][0]).not.toContain(DM);
  });

  it("answers null when the user has no usable channel", async () => {
    listAccountChannelRows.mockResolvedValue({ rows: [row(OTHER, { archived_at: "t" })], truncated: false });
    expect(await channelLinker.mostRecent(USER)).toBeNull();
    expect(lastMessages).not.toHaveBeenCalled();
  });
});

describe("voice channel gateway", () => {
  it("reads only agent-authored messages past the cursor, named by display name", async () => {
    expect(await glassesChannelGateway.agentMessagesAfter(LIVE, 10, 5)).toEqual([
      { id: "m3", seq: 12, body: "pong", agentName: "Orchestrator", agentId: "abcdefgh" },
    ]);
    expect(await glassesChannelGateway.headSeq(LIVE)).toBe(12);
  });

  it("reads several channels past their own cursors in one query", async () => {
    const from = vi.spyOn(db, "from");
    const out = await glassesChannelGateway.agentMessagesAfterMany(new Map([[LIVE, 12], [ARCHIVED, 0]]), 5);
    expect(out.size).toBe(0);
    const again = await glassesChannelGateway.agentMessagesAfterMany(new Map([[LIVE, 11], [ARCHIVED, 0]]), 5);
    expect([...again.keys()]).toEqual([LIVE]);
    expect(again.get(LIVE)?.map((r) => r.id)).toEqual(["m3"]);
    expect(from.mock.calls.filter(([t]) => t === "channel_messages")).toHaveLength(2);
  });

  const link = { channelId: LIVE, containerId: "ws-1", name: "room-22" };

  it("posts as the operator and @-addresses the one live agent", async () => {
    listChannelSessionStates.mockResolvedValue([{ name: "abcdefgh", display_name: "Orchestrator" }]);
    postMessage.mockResolvedValue({ id: "p1", seq: 13, recipientAgentIds: ["abcdefgh"] });
    const posted = await glassesChannelGateway.postAsOperator(link, USER, "status?", "abcdefgh");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, workspaceId: "ws-1" }),
      LIVE,
      expect.objectContaining({ body: "status?", to: "@agent-abcdefgh" }),
    );
    expect(posted).toMatchObject({ id: "p1", seq: 13, liveAgents: 1, addressedTo: "agent-abcdefgh", addressedName: "Orchestrator", channelName: "room-22" });
  });

  it("posts a channel target unaddressed, and refuses an agent target that is not running", async () => {
    listChannelSessionStates.mockResolvedValue([{ name: "abcdefgh", display_name: null }]);
    postMessage.mockResolvedValue({ id: "p2", seq: 14, recipientAgentIds: [] });
    const posted = await glassesChannelGateway.postAsOperator(link, USER, "hi", null);
    expect(postMessage.mock.calls[0][2]).not.toHaveProperty("to");
    expect(posted).toMatchObject({ id: "p2", addressedTo: null, channelName: "room-22" });
    await expect(glassesChannelGateway.postAsOperator(link, USER, "hi", "zzzzzzzz")).rejects.toThrow("not running");
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
});
