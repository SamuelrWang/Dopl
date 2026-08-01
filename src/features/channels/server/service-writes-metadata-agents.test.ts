/**
 * AGENT ADDRESSING on a post — driven through `postMessage` so the wiring into
 * the metadata fold is covered too.
 *
 * What this pins:
 *  - `toAgent` resolves by ID or by HANDLE (case-folded), and only within THIS
 *    channel — an agent of another room is a 400 about the address, not a
 *    silent stamp that would look delivered and route nowhere.
 *  - **The owner bridge (v1).** Addressing an agent also stamps its OWNER as
 *    `to_user_id`, because that is still the only key the delivery path reads:
 *    the listener triggers on the addressed user, and the agent runs on that
 *    user's machine. Without it `@quartz` would wake nobody. That owner must
 *    STILL be a member — the bridge overrides the caller's validated
 *    `toUserId`, so it is the one place a non-member could reach the addressee
 *    slot (S2).
 *  - **`authorAgentId` is not assumable.** It is honoured only for the agent's
 *    own owner; anyone else gets a 403, never a silent strip — a caller trying
 *    to speak under an identity that is not theirs must be told, not humoured.
 *  - Both keys are RESERVED: a caller copy in `metadata` is stripped on every
 *    path, with or without the validated field beside it.
 *  - The message's `author_user_id` never moves. An agent id SUPPLEMENTS an
 *    author; it never replaces one.
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
import {
  ChannelAddresseeNotMemberError,
  ChannelAgentForbiddenError,
  ChannelAgentNotInChannelError,
} from "./errors";
import { postMessage } from "./service-writes";
import type { ChannelAgentRow } from "./agents-dto";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const THIRD = "33333333-e29b-41d4-a716-446655440000";
const AGENT_ID = "44444444-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "room",
    name: "Room",
    topic: "",
    visibility: "private",
    // A GROUP channel: no DM auto-address in the way, so every `to_user_id`
    // below is the agent bridge and nothing else.
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

/** An agent of THIS channel, owned by the PEER unless overridden. */
function agentRow(overrides: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: AGENT_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    owner_user_id: PEER,
    name: "quartz",
    status: "active",
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
    seq: 98,
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
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER || userId === PEER ? memberRow(userId) : null
  );
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
  vi.mocked(repoAgents.findAgentById).mockResolvedValue(agentRow());
  vi.mocked(repoAgents.findAgentByName).mockResolvedValue(agentRow());
});

describe("postMessage — toAgent resolution", () => {
  it("resolves a HANDLE and stamps to_agent_id", async () => {
    const msg = await postMessage(ctx, "room", {
      body: "@quartz take this",
      toAgent: "quartz",
    });

    expect(repoAgents.findAgentByName).toHaveBeenCalledWith("chan-1", "quartz");
    expect(capturedMetadata().to_agent_id).toBe(AGENT_ID);
    expect(msg.metadata.to_agent_id).toBe(AGENT_ID);
  });

  it("resolves an agent ID without a handle lookup", async () => {
    await postMessage(ctx, "room", { body: "take this", toAgent: AGENT_ID });

    expect(repoAgents.findAgentById).toHaveBeenCalledWith(AGENT_ID);
    expect(repoAgents.findAgentByName).not.toHaveBeenCalled();
    expect(capturedMetadata().to_agent_id).toBe(AGENT_ID);
  });

  it("400s an agent of ANOTHER channel, resolved by handle", async () => {
    vi.mocked(repoAgents.findAgentByName).mockResolvedValue(
      agentRow({ channel_id: "chan-other" })
    );

    await expect(
      postMessage(ctx, "room", { body: "hi", toAgent: "quartz" })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("400s an agent id from another channel (an id is not a passport)", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ channel_id: "chan-other" })
    );

    await expect(
      postMessage(ctx, "room", { body: "hi", toAgent: AGENT_ID })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
  });

  it("400s a handle nobody in the room holds", async () => {
    vi.mocked(repoAgents.findAgentByName).mockResolvedValue(null);

    await expect(
      postMessage(ctx, "room", { body: "hi", toAgent: "nobody" })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
  });

  it("still resolves a PARKED agent (a handle must not stop working mid-session)", async () => {
    vi.mocked(repoAgents.findAgentByName).mockResolvedValue(
      agentRow({ status: "parked" })
    );

    await postMessage(ctx, "room", { body: "ping", toAgent: "quartz" });

    expect(capturedMetadata().to_agent_id).toBe(AGENT_ID);
  });
});

describe("postMessage — the owner bridge (v1)", () => {
  it("stamps the addressed agent's OWNER as to_user_id", async () => {
    await postMessage(ctx, "room", { body: "take this", toAgent: "quartz" });

    const meta = capturedMetadata();
    expect(meta.to_agent_id).toBe(AGENT_ID);
    // The listener triggers on the addressed USER; the agent runs on that
    // user's machine. Without this the post would wake nobody.
    expect(meta.to_user_id).toBe(PEER);
  });

  it("supersedes a disagreeing explicit toUserId (a handle names ONE machine)", async () => {
    // THIRD is a perfectly valid addressee; it simply is not the machine the
    // named agent runs on, and two addressees name none.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      userId === THIRD ? memberRow(THIRD) : memberRow(userId)
    );

    await postMessage(ctx, "room", {
      body: "take this",
      toAgent: "quartz",
      toUserId: THIRD,
    });

    expect(capturedMetadata().to_user_id).toBe(PEER);
  });

  it("leaves to_user_id alone when no agent is addressed", async () => {
    await postMessage(ctx, "room", { body: "hi", toUserId: PEER });

    const meta = capturedMetadata();
    expect(meta.to_user_id).toBe(PEER);
    expect(has(meta, "to_agent_id")).toBe(false);
  });

  /**
   * S2. `channel_agents` has no FK to `channel_members`, so an agent OUTLIVES
   * its owner's membership. The bridge stamps that owner as `to_user_id` and
   * OVERRIDES the caller's validated `toUserId`, so without a check of its own
   * it was the one way to put a non-member in the addressee slot that
   * `postMessage` 400s on everywhere else (the v1.1 invariant).
   */
  it("400s when the addressed agent's OWNER has left the channel", async () => {
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      userId === PEER ? null : memberRow(userId)
    );

    await expect(
      postMessage(ctx, "room", { body: "take this", toAgent: "quartz" })
    ).rejects.toThrow(ChannelAddresseeNotMemberError);
    // Nothing stamped, nothing written — the refusal precedes the insert.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("400s the same post even with a VALID explicit toUserId beside it", async () => {
    // The bridge OVERRIDES `toUserId`, so a valid one beside a departed owner
    // must not rescue the post — it would silently address someone the caller
    // did not name.
    vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
      userId === PEER ? null : memberRow(userId)
    );

    await expect(
      postMessage(ctx, "room", {
        body: "take this",
        toAgent: "quartz",
        toUserId: THIRD,
      })
    ).rejects.toThrow(ChannelAddresseeNotMemberError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("does NOT gate authorAgentId on the same read (the author is the caller)", async () => {
    // `author_agent_id` names the CALLER's own agent, and the caller's
    // membership is already established by `postMessage`. Only the ADDRESSEE
    // half of the bridge needs the check.
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER })
    );

    await postMessage(ctx, "room", { body: "on it", authorAgentId: AGENT_ID });

    expect(capturedMetadata().author_agent_id).toBe(AGENT_ID);
  });
});

describe("postMessage — authorAgentId", () => {
  it("stamps author_agent_id for the agent's OWN owner", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER })
    );

    const msg = await postMessage(ctx, "room", {
      body: "on it",
      authorAgentId: AGENT_ID,
    });

    expect(capturedMetadata().author_agent_id).toBe(AGENT_ID);
    // THE IDENTITY LAW: the agent id supplements the author, never replaces it.
    expect(
      vi.mocked(repoMessages.insertMessage).mock.calls[0][0].author_user_id
    ).toBe(USER);
    expect(msg.authorUserId).toBe(USER);
  });

  it("SECURITY: 403s a member claiming ANOTHER member's agent", async () => {
    // The agent is real and in this channel — it is simply not the caller's.
    await expect(
      postMessage(ctx, "room", { body: "on it", authorAgentId: AGENT_ID })
    ).rejects.toThrow(ChannelAgentForbiddenError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("400s an agent id from another channel", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(
      agentRow({ owner_user_id: USER, channel_id: "chan-other" })
    );

    await expect(
      postMessage(ctx, "room", { body: "on it", authorAgentId: AGENT_ID })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
  });

  it("400s an agent id that names no row", async () => {
    vi.mocked(repoAgents.findAgentById).mockResolvedValue(null);

    await expect(
      postMessage(ctx, "room", { body: "on it", authorAgentId: AGENT_ID })
    ).rejects.toThrow(ChannelAgentNotInChannelError);
  });
});

describe("postMessage — the two keys are RESERVED", () => {
  it("SECURITY: strips caller copies when no agent fields are supplied", async () => {
    await postMessage(ctx, "room", {
      body: "hi",
      metadata: { to_agent_id: AGENT_ID, author_agent_id: AGENT_ID, keep: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "to_agent_id")).toBe(false);
    expect(has(meta, "author_agent_id")).toBe(false);
    // Only the reserved keys are taken — unrelated caller metadata survives.
    expect(meta.keep).toBe(1);
    // No claim, no lookup.
    expect(repoAgents.findAgentById).not.toHaveBeenCalled();
  });

  it("SECURITY: a spoofed copy never survives beside a validated field", async () => {
    const otherAgent = "66666666-e29b-41d4-a716-446655440000";
    vi.mocked(repoAgents.findAgentByName).mockResolvedValue(agentRow());

    await postMessage(ctx, "room", {
      body: "hi",
      toAgent: "quartz",
      metadata: { to_agent_id: otherAgent },
    });

    expect(capturedMetadata().to_agent_id).toBe(AGENT_ID);
  });
});
