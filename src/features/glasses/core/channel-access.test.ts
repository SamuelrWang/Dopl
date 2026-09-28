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
vi.mock("@/features/workspaces/server/service", () => ({
  resolveActiveWorkspace: async () => ({ workspace: { id: "ws-1", kind: "link" }, membership: { role: "owner" } }),
}));

const { channelLinker } = await import("./devices/channel-link");
const { glassesChannelGateway } = await import("./voice/channel-gateway");
const { linkOf, requireLink } = await import("./devices/service");

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
});

describe("channel-link: what a device may link, see and keep", () => {
  it("links only live channels the user is a member of", async () => {
    expect(await requireLink(channelLinker, USER, LIVE)).toEqual({ channelId: LIVE, containerId: "ws-1", name: "room-22" });
    for (const id of [ARCHIVED, DELETED, NOT_MEMBER, "nope"]) {
      await expect(requireLink(channelLinker, USER, id)).rejects.toMatchObject({ status: 404 });
    }
  });

  it("never reveals names of channels the user cannot link", async () => {
    const links = await channelLinker.linkable(USER, [LIVE, ARCHIVED, DELETED, NOT_MEMBER]);
    expect([...links.keys()]).toEqual([LIVE]);
    expect(await linkOf(channelLinker, USER, LIVE)).not.toBeNull();
    expect(await linkOf(channelLinker, USER, NOT_MEMBER)).toBeNull();
  });
});

describe("voice channel gateway", () => {
  it("reads only agent-authored messages past the cursor, named by display name", async () => {
    expect(await glassesChannelGateway.agentMessagesAfter(LIVE, 10, 5)).toEqual([
      { id: "m3", seq: 12, body: "pong", agentName: "Orchestrator", agentId: "abcdefgh" },
    ]);
    expect(await glassesChannelGateway.headSeq(LIVE)).toBe(12);
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
