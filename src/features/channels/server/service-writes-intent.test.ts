/**
 * CHAT vs. REQUEST — driven through `postMessage`, because the whole point is
 * what the SERVER does to a post the caller did not address.
 *
 * The operator's report was that a message they meant as talk was poking the
 * peer's agent. It was: v2.6 auto-addresses every DM post to the peer, which is
 * what makes an agent REPLY deliverable and what made two humans unable to say
 * "sounds good" without raising a consent prompt on each other's machines.
 *
 * What this file pins:
 *  - **The default is byte-for-byte the old behaviour.** No `intent` on the
 *    input ⇒ the DM auto-address still fires and no `intent` key is stored. This
 *    is the regression risk of the whole change and is asserted on the WHOLE
 *    metadata object, not on one key.
 *  - **`chat` reaches nobody's agent.** The peer is not resolved AT ALL, so
 *    there is nothing for any later fold to fall back to: no `to_user_id`, and
 *    no DM thread inheritance either (that path is part of the same
 *    auto-addressing machinery).
 *  - **`chat` + an address is a 400, not a silently-resolved contradiction** —
 *    and it 400s BEFORE the idempotency short-circuit, so a retry cannot be
 *    answered with a stored message instead of the error.
 *  - **`intent` is a RESERVED key.** A caller copy in `metadata` is stripped and
 *    is NOT re-added from anything but the validated top-level field — so
 *    spoofing it can neither stamp the key nor suppress the auto-address.
 *  - A chat post is otherwise an ORDINARY message: it still threads when the
 *    caller passes a thread tag it is entitled to.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-participants");
vi.mock("./repository-agents");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import * as repoParticipants from "./repository-participants";
import * as repoTasks from "./repository-tasks";
import { ChannelChatAddressedError } from "./errors";
import { postMessage } from "./service-writes";
import type { ChannelAgentRow } from "./agents-dto";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const AGENT_ID = "44444444-e29b-41d4-a716-446655440000";
const TASK_ID = "55555555-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

/** A DIRECT channel — the only shape where the auto-address fires at all. */
function dmRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "dm",
    name: "Direct message",
    topic: "",
    visibility: "private",
    is_direct: true,
    direct_key: [USER, PEER].sort().join(":"),
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: AGENT_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    owner_user_id: PEER,
    name: "quartz",
    status: "active",
    engaged_at: null,
    engaged_by: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

/** An OPEN thread between the two DM members — the inheritance candidate. */
function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
  return {
    id: TASK_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    target_user_id: PEER,
    title: "Ship the thing",
    status: "open",
    outcome: null,
    outcome_summary: null,
    closed_at: null,
    mode: "interactive",
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 41,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-31T00:00:00Z",
  };
}

function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(dmRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER || userId === PEER ? memberRow(userId) : null
  );
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER),
    memberRow(PEER),
  ]);
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
  vi.mocked(repoAgents.findAgentByName).mockResolvedValue(agentRow());
  vi.mocked(repoAgents.findAgentById).mockResolvedValue(agentRow());
  vi.mocked(repoAgents.markAgentsEngaged).mockResolvedValue(undefined);
});

describe("postMessage — the DEFAULT intent is unchanged", () => {
  /**
   * THE REGRESSION TEST. Asserted on the WHOLE metadata object: a new key
   * stamped by default would change what every existing caller writes, and a
   * per-key assertion would not notice.
   */
  it("stamps EXACTLY what it stamped before when no intent is supplied", async () => {
    await postMessage(ctx, "dm", { body: "here is the result" });

    expect(capturedMetadata()).toEqual({ to_user_id: PEER });
  });

  it("auto-addresses the DM peer, exactly as before", async () => {
    await postMessage(ctx, "dm", { body: "on it" });

    expect(capturedMetadata().to_user_id).toBe(PEER);
    expect(has(capturedMetadata(), "intent")).toBe(false);
  });

  it("still inherits the single open DM thread with no intent", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "progress" });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.taskTitle).toBe("Ship the thing");
  });

  it("an EXPLICIT request behaves identically, and says so on the wire", async () => {
    await postMessage(ctx, "dm", { body: "on it", intent: "request" });

    expect(capturedMetadata()).toEqual({
      to_user_id: PEER,
      intent: "request",
    });
  });
});

describe("postMessage — intent:chat reaches nobody's agent", () => {
  it("does NOT auto-address the DM peer", async () => {
    await postMessage(ctx, "dm", { body: "sounds good", intent: "chat" });

    const meta = capturedMetadata();
    expect(has(meta, "to_user_id")).toBe(false);
    expect(meta.intent).toBe("chat");
  });

  it("does not even LOOK UP the peer (nothing to fall back to)", async () => {
    await postMessage(ctx, "dm", { body: "sounds good", intent: "chat" });

    expect(repo.listMembers).not.toHaveBeenCalled();
  });

  it("does NOT inherit the open DM thread", async () => {
    // Inheritance is part of the auto-addressing machinery: it fires only for a
    // message addressed to the peer. A chat post is addressed to nobody, so a
    // thread tag would be manufactured out of a message that is not a turn.
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", { body: "unrelated aside", intent: "chat" });

    const meta = capturedMetadata();
    expect(has(meta, "taskId")).toBe(false);
    expect(has(meta, "taskTitle")).toBe(false);
  });

  it("is otherwise an ORDINARY message — it still posts, and still threads", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());

    const msg = await postMessage(ctx, "dm", {
      body: "one more thought",
      intent: "chat",
      metadata: { taskId: TASK_ID },
    });

    const meta = capturedMetadata();
    // A thread tag the caller PASSED is honoured (the caller is the thread's
    // creator), with the thread keys stamped from the row as always.
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.taskTitle).toBe("Ship the thing");
    expect(has(meta, "to_user_id")).toBe(false);
    expect(msg.seq).toBe(41);
    expect(repo.touchChannel).toHaveBeenCalled();
  });

  it("changes nothing in a NON-direct channel except the stamp", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      dmRow({ is_direct: false, direct_key: null })
    );

    await postMessage(ctx, "room", { body: "morning all", intent: "chat" });

    expect(capturedMetadata()).toEqual({ intent: "chat" });
  });

  it("never engages an agent (nothing was addressed)", async () => {
    await postMessage(ctx, "dm", { body: "sounds good", intent: "chat" });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
  });
});

/**
 * THE OPERATOR'S CORE FLOW, from the server's side. "@quartz @onyx work
 * together on X" is a CHAT message that has to make two agents act. It used to
 * be a 400 (`CHANNEL_CHAT_ADDRESSED` fired on any addressee at all), which is
 * why the composer could not send it and why nobody acted.
 */
describe("postMessage — chat MAY address agents, and they act", () => {
  const ONYX = "66666666-e29b-41d4-a716-446655440000";

  function twoAgents() {
    vi.mocked(repoAgents.findAgentByName).mockImplementation(
      async (_channelId, name) =>
        name.toLowerCase() === "onyx"
          ? agentRow({ id: ONYX, name: "onyx" })
          : agentRow()
    );
  }

  it("stamps the address, the compat mirror, and the OWNER BRIDGE", async () => {
    twoAgents();

    await postMessage(ctx, "dm", {
      body: "@quartz @onyx work together on X",
      intent: "chat",
      toAgents: ["quartz", "onyx"],
    });

    expect(capturedMetadata()).toEqual({
      intent: "chat",
      to_agent_ids: [AGENT_ID, ONYX],
      // The scalar installed desktops still read.
      to_agent_id: AGENT_ID,
      // The bridge: the FIRST agent's owner, because the listener triggers on
      // the addressed USER and the agent runs on that user's machine.
      to_user_id: PEER,
    });
  });

  it("ENGAGES exactly the addressed agents, on behalf of the human author", async () => {
    twoAgents();

    await postMessage(ctx, "dm", {
      body: "@quartz @onyx go",
      intent: "chat",
      toAgents: ["quartz", "onyx"],
    });

    expect(repoAgents.markAgentsEngaged).toHaveBeenCalledWith(
      [AGENT_ID, ONYX],
      USER
    );
  });

  it("does NOT additionally peer-auto-address, or inherit the DM thread", async () => {
    // The bridge is the ONLY reason `to_user_id` is set here. The peer fallback
    // is never even resolved under chat, so the open thread between the two DM
    // members is not inherited either — a tagged aside is not a turn in it.
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([taskRow()]);

    await postMessage(ctx, "dm", {
      body: "@quartz look at this",
      intent: "chat",
      toAgents: ["quartz"],
    });

    const meta = capturedMetadata();
    expect(repo.listMembers).not.toHaveBeenCalled();
    expect(has(meta, "taskId")).toBe(false);
    expect(meta.to_user_id).toBe(PEER);
  });

  it("engages nobody when the author is an AGENT (the loop brake is absolute)", async () => {
    await postMessage(ctx, "dm", {
      body: "@quartz your turn",
      intent: "chat",
      toAgents: ["quartz"],
      authorKind: "agent",
    });

    expect(repoAgents.markAgentsEngaged).not.toHaveBeenCalled();
    // Addressed all the same — the brake is on ENGAGEMENT, not on delivery.
    expect(capturedMetadata().to_agent_ids).toEqual([AGENT_ID]);
  });

  it("accepts the singular toAgent under chat too", async () => {
    await postMessage(ctx, "dm", {
      body: "@quartz go",
      intent: "chat",
      toAgent: "quartz",
    });

    expect(capturedMetadata().to_agent_ids).toEqual([AGENT_ID]);
  });
});

describe("postMessage — chat + a HUMAN addressee is still a contradiction", () => {
  it("400s on toUserId", async () => {
    await expect(
      postMessage(ctx, "dm", { body: "hi", intent: "chat", toUserId: PEER })
    ).rejects.toThrow(ChannelChatAddressedError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("400s on toUserId even beside a legitimate agent address", async () => {
    // Requesting a PERSON's agent is what request mode is for; mentioning an
    // agent does not buy the right to also start a teammate's machine.
    await expect(
      postMessage(ctx, "dm", {
        body: "@quartz hi",
        intent: "chat",
        toUserId: PEER,
        toAgents: ["quartz"],
      })
    ).rejects.toThrow(ChannelChatAddressedError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("accepts an EMPTY toAgents beside chat (it addresses nobody)", async () => {
    await postMessage(ctx, "dm", {
      body: "hi",
      intent: "chat",
      toAgents: [],
    });

    expect(capturedMetadata()).toEqual({ intent: "chat" });
  });

  /**
   * The guard sits beside the addressee-membership check, i.e. BEFORE the
   * idempotency short-circuit, for the same reason that one does: a
   * contradictory request must fail on the retry too, not be answered with the
   * stored message of a request that never carried the contradiction.
   */
  it("400s even when the clientMsgId already has a stored message", async () => {
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      insertedRow({
        channel_id: "chan-1",
        workspace_id: WS,
        author_user_id: USER,
        author_kind: "user",
        kind: "message",
        body: "hi",
        metadata: {},
        client_msg_id: "k1",
      })
    );

    await expect(
      postMessage(ctx, "dm", {
        body: "hi",
        intent: "chat",
        toUserId: PEER,
        clientMsgId: "k1",
      })
    ).rejects.toThrow(ChannelChatAddressedError);
  });
});

describe("postMessage — intent is a RESERVED metadata key", () => {
  it("SECURITY: strips a caller copy when no top-level intent is given", async () => {
    await postMessage(ctx, "dm", {
      body: "hi",
      metadata: { intent: "chat", keep: 1 },
    });

    const meta = capturedMetadata();
    // Stripped — and NOT re-added, because nothing validated said "chat".
    expect(has(meta, "intent")).toBe(false);
    expect(meta.keep).toBe(1);
  });

  /**
   * The strip has to be load-bearing, not cosmetic: if the fold read
   * `metadata.intent` the caller could suppress the auto-address (or, worse,
   * dress a request up as chat on the receiver's screen) without ever passing
   * the validated field.
   */
  it("SECURITY: a spoofed copy does not suppress the DM auto-address", async () => {
    await postMessage(ctx, "dm", {
      body: "hi",
      metadata: { intent: "chat" },
    });

    expect(capturedMetadata().to_user_id).toBe(PEER);
  });

  it("SECURITY: a spoofed copy never survives beside the validated field", async () => {
    await postMessage(ctx, "dm", {
      body: "hi",
      intent: "chat",
      metadata: { intent: "request" },
    });

    expect(capturedMetadata().intent).toBe("chat");
  });
});
