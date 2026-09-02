/**
 * CHAT vs REQUEST, driven through `postMessage` — the point is what the SERVER
 * does to a post the caller did not address. Pinned:
 *  - ⚠ Default is byte-for-byte the old behaviour: no `intent` ⇒ DM
 *    auto-address still fires and NO `intent` key is stored. Asserted on the
 *    WHOLE metadata object, since a per-key assertion would miss a new key.
 *  - `chat` reaches nobody: the peer is not resolved AT ALL, so no later fold
 *    can fall back to it — no `to_user_id`, no DM thread inheritance.
 *  - `chat` + an address is a 400, BEFORE the idempotency short-circuit, so a
 *    retry cannot be answered with a stored message instead of the error.
 *  - ⚠ `intent` is RESERVED: a caller copy in `metadata` is stripped and never
 *    re-added except from the validated top-level field, so spoofing can
 *    neither stamp the key nor suppress the auto-address.
 *  - A chat post otherwise threads normally when entitled to the tag.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
// ⚠ **THE VERDICT RESOLVER READS `channel_sessions` (A9)** and this suite is
// about the METADATA fold, not about who a post wakes. Mocked to the empty
// projection so the agent half of `service-wake-verdict.ts` resolves nothing:
// unmocked it reaches `supabaseAdmin()` and every case with an `@` in its body
// hangs on a real client. `service-wake-verdict.test.ts` is where that
// resolution is driven.
vi.mock("./repository-sessions");


import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import * as repoSessions from "./repository-sessions";
import { ChannelChatAddressedError } from "./errors";
import { postMessage } from "./service-writes";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskActivityRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
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
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-07-31T00:00:00Z",
  };
}

/** An OPEN thread between the two DM members — the inheritance candidate. */
function taskRow(overrides: Partial<ChannelTaskActivityRow> = {}): ChannelTaskActivityRow {
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
    // Derived by the activity view, never stored on the row — the DM
    // inheritance match is all-or-nothing on the pair, not on order.
    last_activity_at: "2026-07-31T00:00:00Z",
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
  // ⚠ Addressing an explicit `to` also asserts ACTIVE workspace membership —
  // the check every post in this file now goes through, since the DM
  // auto-address that used to supply the addressee is gone.
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER),
    memberRow(PEER),
  ]);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repoSessions.listSessionStates).mockResolvedValue([]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [],
      truncated: false,
    });
});

describe("postMessage — the DEFAULT intent is unchanged", () => {
  /** ⚠ Whole-object assertion: a new default-stamped key changes what every
   *  existing caller writes, and a per-key assertion would not notice. */
  it("stamps EXACTLY what an addressed post stamped before", async () => {
    await postMessage(ctx, "dm", {
      body: "here is the result",
      toUserId: PEER,
    });

    expect(capturedMetadata()).toEqual({ to_user_id: PEER });
  });

  it("stamps NOTHING for an unaddressed DM post (auto-address RETIRED)", async () => {
    await postMessage(ctx, "dm", { body: "on it" });

    // ⚠ Until 2026-08-18 this stamped the peer. `intent` was the ONE way to opt
    // out of that; now there is nothing to opt out of, and `chat` survives for
    // what it always also said — this post is not work for anybody's agent.
    expect(capturedMetadata()).toEqual({});
    expect(has(capturedMetadata(), "intent")).toBe(false);
  });

  it("still inherits the single open DM thread with no intent", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });

    await postMessage(ctx, "dm", { body: "progress", toUserId: PEER });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.taskTitle).toBe("Ship the thing");
  });

  it("an EXPLICIT request behaves identically, and says so on the wire", async () => {
    await postMessage(ctx, "dm", {
      body: "on it",
      toUserId: PEER,
      intent: "request",
    });

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
    // Inheritance is part of the auto-addressing machinery and fires only for a
    // message addressed to the peer — a chat post is addressed to nobody.
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });

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
    // A tag the caller PASSED is honoured (caller is the thread's creator).
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

});

describe("postMessage — chat + a HUMAN addressee is still a contradiction", () => {
  it("400s on toUserId", async () => {
    await expect(
      postMessage(ctx, "dm", { body: "hi", intent: "chat", toUserId: PEER })
    ).rejects.toThrow(ChannelChatAddressedError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("treats an @handle in the BODY as prose, not as an address", async () => {
    // Nothing resolves an `@` — the body is text and the post addresses nobody.
    await postMessage(ctx, "dm", {
      body: "@quartz work on X",
      intent: "chat",
    });

    expect(capturedMetadata()).toEqual({ intent: "chat" });
  });

  /** ⚠ Guard sits BEFORE the idempotency short-circuit: a contradictory request
   *  must fail on the retry too, not be answered with a stored message. */
  it("400s even when the clientMsgId already has a stored message", async () => {
    vi.mocked(repoMessages.findOwnMessageByClientId).mockResolvedValue(
      insertedRow({
        channel_id: "chan-1",
        workspace_id: WS,
        author_user_id: USER,
        author_kind: "user",
        kind: "message",
        body: "hi",
        metadata: {},
        client_msg_id: "k1",
        // ⚠ The stored row's own verdict (A9). Not this case's subject — it is
        // here because the insert states a verdict on every path, and a fixture
        // that could omit it would let a real omission compile.
        wake_verdict: "none",
        recipient_user_ids: [],
        recipient_agent_ids: null,
        delivery: "none",
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
    // Stripped and NOT re-added — nothing validated said "chat".
    expect(has(meta, "intent")).toBe(false);
    expect(meta.keep).toBe(1);
  });

  /** ⚠ The strip is load-bearing, not cosmetic: a fold reading `metadata.intent`
   *  lets a caller dress a request up as chat on the receiver's screen — or
   *  suppress THREAD INHERITANCE — without passing the validated field. */
  it("SECURITY: a spoofed copy does not suppress thread inheritance", async () => {
    vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [taskRow()],
      truncated: false,
    });

    await postMessage(ctx, "dm", {
      body: "hi",
      toUserId: PEER,
      metadata: { intent: "chat" },
    });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(has(meta, "intent")).toBe(false);
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

/**
 * What the refusal tells the caller to do instead. ⚠ The message must not
 * recommend a param that is a `z.never()` in `schema.ts#removedParam` — a caller
 * following it gets a SECOND 400 from a different layer. The route returns this
 * verbatim in the envelope, so it is pinned like any shipped string. MCP twin:
 * `channel-post-notes.ts#CHAT_ADDRESSED_REFUSAL`.
 */
describe("the chat+addressed refusal names a route that still EXISTS", () => {
  const message = () => new ChannelChatAddressedError("toUserId").message;

  it("names the field that caused it", () => {
    expect(message()).toContain("toUserId");
    expect(new ChannelChatAddressedError("to").message).toContain("(to)");
  });

  it("offers the two things a caller can actually do", () => {
    // Both halves — the refusal exists so the CALLER picks, not the server.
    expect(message()).toContain("Drop the address to send it as chat");
    expect(message()).toContain('intent "request"');
  });

  it("names NO removed param — following it must not produce a second 400", () => {
    for (const gone of ["toAgent", "toAgents", "as_agent", "participants"]) {
      expect(message(), `the refusal still recommends ${gone}`).not.toContain(gone);
    }
    expect(message()).not.toMatch(/\bMention an agent\b/);
  });

  it("says the same thing the MCP twin says, so the two lanes cannot drift again", () => {
    // ⚠ Not a string comparison — the two surfaces phrase it for different
    // callers. What must match is the DECISION offered.
    const mcp =
      'A message with `intent`="chat" cannot be addressed — nothing was sent. "chat" means the people in the room and reaches nobody\'s machine; `to` means the opposite, and the server refuses the pair rather than guessing which half you meant. Send it as CHAT by dropping `to`, or as a REQUEST by dropping `intent` (a request is the default).';
    for (const text of [message(), mcp]) {
      expect(text).toMatch(/drop(ping)? the address|dropping `to`/i);
      expect(text).toMatch(/request/i);
      expect(text).not.toMatch(/toAgents?\b/);
    }
  });
});
