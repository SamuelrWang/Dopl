/**
 * `metadata.via` through `postMessage` (`server/message-via.ts`, `lib/message-via.ts`): stamped on
 * an OUTSIDE SESSION's post only, off the credential's row plus the self-declared clientInfo; never
 * on a desktop-run session, a container-locked credential, or a person; never caller-settable.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository");
vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("@/features/devices/server/agent-apps-repository", () => ({ readGrantOrigin: vi.fn() }));

import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoMessages from "./repository-messages";
import { readGrantOrigin } from "@/features/devices/server/agent-apps-repository";
import { postMessage } from "./service-writes";
import { ChannelMessageCreateSchema } from "../schema";
import type { ChannelMessageRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const member: ChannelContext = { workspaceId: WS, userId: USER, credentialSubjectUserId: USER, source: "user", role: "member" };
const outside: ChannelContext = {
  ...member,
  source: "agent",
  agentTokenId: "tok-1",
  clientInfo: { name: "claude-code", version: "2.1.0" },
};

const channel = { id: "chan-1", workspace_id: WS, slug: "room", is_direct: false, direct_key: null, deleted_at: null, archived_at: null } as unknown as ChannelRow;
const stored = () => vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata as Record<string, unknown>;
const post = (ctx: ChannelContext, raw: unknown) => postMessage(ctx, "room", ChannelMessageCreateSchema.parse(raw));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([]);
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channel);
  vi.mocked(repo.findMembership).mockResolvedValue({ user_id: USER } as never);
  vi.mocked(repo.listMembers).mockResolvedValue([]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => ({ ...row, id: "m1", seq: 1, created_at: "2026-10-02T00:00:00Z" }) as ChannelMessageRow);
  vi.mocked(readGrantOrigin).mockResolvedValue({
    client_id: "dcr-1",
    client_name: "Claude",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  });
});

describe("metadata.via", () => {
  it("stamps an outside session's post: verified vendor, app, host, and the client info", async () => {
    await post(outside, { body: "hi" });
    expect(readGrantOrigin).toHaveBeenCalledWith("tok-1");
    expect(stored().via).toEqual({
      vendor: "Claude",
      app: "Claude",
      host: "claude.ai",
      client: { name: "claude-code", version: "2.1.0" },
    });
  });

  it("a device token never shows its machine label as an app — only the client info speaks", async () => {
    vi.mocked(readGrantOrigin).mockResolvedValue({ client_id: "dopl_client_device_cli", client_name: "Dopl Desktop CLI (mbp)", redirect_uris: null });
    await post(outside, { body: "hi" });
    expect(stored().via).toEqual({ client: { name: "claude-code", version: "2.1.0" } });
  });

  it("a pasted device token with no client info stamps nothing (the plain chip renders)", async () => {
    vi.mocked(readGrantOrigin).mockResolvedValue({ client_id: "dopl_client_device_cli", client_name: "Dopl Desktop CLI (mbp)", redirect_uris: null });
    await post({ ...outside, clientInfo: undefined }, { body: "hi" });
    expect(stored()).not.toHaveProperty("via");
    expect(stored().external_session).toBe(true);
  });

  it("never on a desktop-run session — runtime stamp OR container lock", async () => {
    await post({ ...outside, runtime: "desktop-session" }, { body: "hi" });
    expect(stored()).not.toHaveProperty("via");
    vi.mocked(repoMessages.insertMessage).mockClear();
    await post({ ...outside, apiKeyWorkspaceId: "container-1" }, { body: "hi" });
    expect(stored()).not.toHaveProperty("via");
    expect(readGrantOrigin).not.toHaveBeenCalled();
  });

  it("never on a person, even one claiming an agent author", async () => {
    await post(member, { body: "hi", authorKind: "agent" });
    expect(stored()).not.toHaveProperty("via");
    expect(readGrantOrigin).not.toHaveBeenCalled();
  });

  it("strips a caller-supplied via (no forged 'verified')", async () => {
    await post({ ...member }, { body: "hi", metadata: { via: { vendor: "Claude" } } });
    expect(stored()).not.toHaveProperty("via");
  });

  it("a failed lookup is a post without the app half, never a refused post", async () => {
    vi.mocked(readGrantOrigin).mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await post(outside, { body: "hi" });
    expect(stored().via).toEqual({ client: { name: "claude-code", version: "2.1.0" } });
    spy.mockRestore();
  });
});
