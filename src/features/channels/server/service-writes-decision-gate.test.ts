/**
 * The decision gate through `postMessage` (2026-10-08): an AGENT's plain post that asks an addressed
 * PERSON to choose between enumerated options is refused with a draft card and writes nothing.
 * People, agent posts with no person addressed, records and displays are untouched.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository");
vi.mock("./repository-sessions");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoMessages from "./repository-messages";
import { postMessage } from "./service-writes";
import { ChannelDecisionRequiredError } from "./errors";
import { toChannelErrorResponse } from "./http-mapping";
import { ChannelMessageCreateSchema } from "../schema";
import type { ChannelMessageRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const SAMUEL = "22222222-e29b-41d4-a716-446655440000";
const member: ChannelContext = { workspaceId: WS, userId: USER, credentialSubjectUserId: USER, source: "user", role: "member" };
const agent: ChannelContext = { ...member, source: "agent" };

const channel = { id: "chan-1", workspace_id: WS, slug: "room", is_direct: false, direct_key: null, deleted_at: null, archived_at: null } as unknown as ChannelRow;
const post = (ctx: ChannelContext, raw: unknown) => postMessage(ctx, "room", ChannelMessageCreateSchema.parse(raw));

const CHOICE = "Two ways to finish:\n1. Override once - I run the merge\n2. You run it - one command\nWhich do you want?";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
  vi.mocked(repoSessions.listChannelSessionStates).mockResolvedValue([]);
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channel);
  vi.mocked(repo.findMembership).mockResolvedValue({ user_id: USER } as never);
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.listMembers).mockResolvedValue([]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => ({ ...row, id: "m1", seq: 1, created_at: "2026-10-08T00:00:00Z" }) as ChannelMessageRow);
});

describe("refused", () => {
  it("an agent's choice addressed to a person: 400 with the draft, nothing written", async () => {
    const err = await post(agent, { body: CHOICE, toUserId: SAMUEL }).catch((e) => e);
    expect(err).toBeInstanceOf(ChannelDecisionRequiredError);
    expect(err.draft.summary).toBe("Which do you want?");
    expect(err.draft.options).toEqual([
      { label: "Override once", consequence: "I run the merge" },
      { label: "You run it", consequence: "one command" },
    ]);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    const res = toChannelErrorResponse(err);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "CHANNEL_DECISION_REQUIRED", details: { draft: err.draft } } });
  });

  it("a cookie post claiming agent is gated the same", async () => {
    await expect(post(member, { body: CHOICE, toUserId: SAMUEL, authorKind: "agent" })).rejects.toBeInstanceOf(ChannelDecisionRequiredError);
  });

  it("a retry with the same client_msg_id is refused too, never replayed", async () => {
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue({ id: "old" } as never);
    await expect(post(agent, { body: CHOICE, toUserId: SAMUEL, clientMsgId: "k-1" })).rejects.toBeInstanceOf(ChannelDecisionRequiredError);
  });
});

describe("untouched", () => {
  it("a person posting the same body", async () => {
    await post(member, { body: CHOICE, toUserId: SAMUEL });
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("an agent post with no person addressed (agent-to-agent asks live here)", async () => {
    await post(agent, { body: CHOICE });
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("an agent record (intent chat, the MCP kind=\"record\")", async () => {
    await post(agent, { body: CHOICE, intent: "chat" });
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("an agent's plain report to a person that is not a choice", async () => {
    await post(agent, { body: "Done:\n1. Merged\n2. Removed the worktree\n3. Tests green\nAny questions or concerns?", toUserId: SAMUEL });
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });
});
