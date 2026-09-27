import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest } from "./fake-postgrest";

const USER = "11111111-1111-4111-8111-111111111111";
const CH = "22222222-2222-4222-8222-222222222222";

let db = fakePostgrest({});
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => db }));
vi.mock("@/features/workspaces/server/service", () => ({
  resolveActiveWorkspace: async (_u: string, ws: string) => ({ workspace: { id: ws, kind: "link" }, membership: { role: "member" } }),
}));
const readTranscript = vi.fn();
const createLaunchDirective = vi.fn();
const getLaunchDirective = vi.fn();
const listAccountChannels = vi.fn();
vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (a: unknown) => a,
  readTranscript: (...a: unknown[]) => readTranscript(...a),
  awaitNewMessages: vi.fn(),
  resolveReadableChannelId: vi.fn(),
}));
vi.mock("@/features/channels/server/service-list", () => ({ listAccountChannels: (...a: unknown[]) => listAccountChannels(...a) }));
vi.mock("@/features/channels/server/service-launch", () => ({
  createLaunchDirective: (...a: unknown[]) => createLaunchDirective(...a),
  getLaunchDirective: (...a: unknown[]) => getLaunchDirective(...a),
}));

const { menuGateway } = await import("./menu-gateway");

beforeEach(() => {
  db = fakePostgrest({
    channels: [{ id: CH, workspace_id: "ws-1" }],
    workspaces: [{ id: "ws-1", name: "Acme", kind: "standard" }, { id: "home-1", name: "x", kind: "home" }],
    channel_launch_directives: [
      { operator_user_id: USER, agent_name: "New agent", applied_agent_name: "New agent", created_at: "2" },
      { operator_user_id: USER, agent_name: "Scout", applied_agent_name: null, created_at: "1" },
      { operator_user_id: "someone-else", agent_name: "New agent 1", applied_agent_name: null, created_at: "3" },
    ],
  });
  vi.clearAllMocks();
});

describe("menu gateway (Dopl services)", () => {
  it("lists member, unarchived channels with container names and DM peers", async () => {
    listAccountChannels.mockResolvedValue({
      truncated: false,
      channels: [
        { id: CH, name: "ops", workspaceId: "ws-1", isMember: true, archivedAt: null, isDirect: false, directPeer: null, lastMessageAt: "t", unread: true },
        { id: "dm", name: "dm-x", workspaceId: "home-1", isMember: true, archivedAt: null, isDirect: true, directPeer: { displayName: "Kim" }, lastMessageAt: null, unread: false },
        { id: "old", name: "old", workspaceId: "ws-1", isMember: true, archivedAt: "t", isDirect: false, directPeer: null, lastMessageAt: null, unread: false },
        { id: "pub", name: "pub", workspaceId: "ws-1", isMember: false, archivedAt: null, isDirect: false, directPeer: null, lastMessageAt: null, unread: false },
      ],
    });
    const out = await menuGateway.listChannels(USER);
    expect(out.map((c) => [c.id, c.name, c.containerName])).toEqual([
      [CH, "ops", "Acme"],
      ["dm", "Kim", "Home"],
    ]);
  });

  it("reads through readTranscript in the channel's own workspace context", async () => {
    readTranscript.mockResolvedValue({
      hasMore: false,
      entries: null,
      messages: [{ seq: 3, kind: "message", authorKind: "agent", authorUserId: USER, authorName: null, clientMsgId: "agent-abcdefgh-1", metadata: {}, authorAgentName: "Orch", body: "hi", createdAt: "t" }],
    });
    const { messages } = await menuGateway.readMessages(USER, CH, { before: 10, limit: 5 });
    expect(readTranscript).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, workspaceId: "ws-1" }), CH, { before: 10, limit: 5 });
    expect(messages[0]).toMatchObject({ seq: 3, authorAgentId: "abcdefgh", authorAgentName: "Orch" });
  });

  it("lists only the caller's own recent launch names", async () => {
    expect(await menuGateway.recentLaunchNames(USER)).toEqual(["New agent", "New agent", "Scout"]);
  });

  it("files launches through createLaunchDirective and maps directive status", async () => {
    createLaunchDirective.mockResolvedValueOnce({ offline: true, directive: null });
    expect(await menuGateway.createLaunch(USER, CH, { runtime: "claude", model: null, agentName: "Claude", clientMsgId: "c" })).toBeNull();
    createLaunchDirective.mockResolvedValueOnce({
      offline: false,
      existing: false,
      directive: { id: "d1", status: "pending", agentId: null, agentName: "Claude", appliedAgentName: null, refusalReason: null },
    });
    expect(await menuGateway.createLaunch(USER, CH, { runtime: "claude", model: "claude-opus-5", agentName: "Claude", clientMsgId: "c" })).toEqual({
      directiveId: "d1",
      status: "launching",
      agentId: null,
      agentName: "Claude",
      refusalReason: null,
    });
    expect(createLaunchDirective.mock.calls[1][1]).toEqual({ channel: CH, agentName: "Claude", runtime: "claude", model: "claude-opus-5", clientMsgId: "c" });
    getLaunchDirective.mockResolvedValue({ id: "d1", status: "launched", agentId: "abcdefgh", agentName: "Claude", appliedAgentName: "Claude-1", refusalReason: null });
    expect(await menuGateway.getLaunch(USER, CH, "d1")).toMatchObject({ status: "launched", agentId: "abcdefgh", agentName: "Claude-1" });
  });
});
