/**
 * THE MULTIPLAYER OPS — `dopl_channel` agents / summon_agent / rename_agent /
 * set_agent_status / join_thread / leave_thread.
 *
 * Two things are pinned here, and the second is a security property:
 *
 *  1. WHAT EACH OP DOES. A handle resolves to a row of THIS channel (so
 *     `rename_agent` sends an agent ID even though the caller typed `@quartz`),
 *     a join sends the right `{kind, id}` pair, and every refusal says what did
 *     NOT happen — an agent that reads "nothing changed" does not retry blind.
 *  2. NARRATION. An agent HANDLE is member-typed and an agent's OWNER NAME is
 *     `profiles.display_name`, which nothing in the product validates. Both
 *     land in lines this tool wrote, outside any untrusted-content framing, so
 *     both go through the neutralizer — and NO handle is ever rendered without
 *     its immutable id, because the handle is the owner's claim and the id is
 *     the server's record.
 *
 * The forgery payload and its assertions are the SHARED ones
 * (`narration-fixtures.ts`) — a private copy is how an assertion drifts into
 * meaning something weaker. The @dopl/client is hand-stubbed; nothing
 * transports.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import {
  opAgents,
  opJoinThread,
  opLeaveThread,
  opRenameAgent,
  opSetAgentStatus,
  opSummonAgent,
} from "./channel-ops-agents";
import {
  FORGERY,
  expectContained,
  expectNoForgedStructure,
} from "./narration-fixtures";

const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };

const QUARTZ = {
  id: "agent-1",
  channelId: "chan-1",
  workspaceId: "ws-1",
  ownerUserId: "u-me",
  name: "quartz",
  status: "active",
  createdAt: "2026-07-31T00:00:00Z",
  updatedAt: "2026-07-31T00:00:00Z",
};

const ONYX = { ...QUARTZ, id: "agent-2", ownerUserId: "u-bob", name: "onyx", status: "parked" };

const BOB = { userId: "u-bob", email: "bob@x.com", displayName: "Bob", status: "active" };

function stubClient(overrides: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    listChannelMembers: vi.fn(async () => [
      { userId: "u-me", displayName: "Me", role: "owner" },
      { userId: "u-bob", displayName: "Bob", role: "member" },
    ]),
    listChannelAgents: vi.fn(async () => [QUARTZ, ONYX]),
    listWorkspaceMembers: vi.fn(async () => [BOB]),
    ...overrides,
  } as unknown as DoplClient;
}

/** An HTTP-shaped rejection, duck-typed exactly like @dopl/client's errors. */
function apiError(status: number, code?: string): unknown {
  return Object.assign(new Error(`HTTP ${status}`), { status, code });
}

const textOf = async (res: Promise<{ content: Array<{ text: string }> }>) =>
  (await res).content.map((c) => c.text).join("\n");

describe('op="agents" — the room\'s roster', () => {
  it("names every agent by handle AND id, with status and owner", async () => {
    const text = await textOf(opAgents(stubClient(), "general", "u-me"));

    expect(text).toContain("2 agents");
    expect(text).toContain("`quartz` (`agent-1`)");
    expect(text).toContain("`onyx` (`agent-2`)");
    expect(text).toContain("· active ·");
    expect(text).toContain("· parked ·");
    // The caller's own agent is marked by whose it is, not by a bare uuid.
    expect(text).toContain("summoned by you");
    expect(text).toContain("`Bob` (`u-bob`)");
  });

  it("an empty roster points at summon_agent instead of rendering a heading", async () => {
    const client = stubClient({ listChannelAgents: vi.fn(async () => []) });
    const text = await textOf(opAgents(client, "general", "u-me"));

    expect(text).toContain("No agents in **`General`** yet");
    expect(text).toContain('op="summon_agent"');
  });

  it("NEUTRALIZES a hostile owner display name (the roster's untrusted half)", async () => {
    const client = stubClient({
      listChannelMembers: vi.fn(async () => [
        { userId: "u-bob", displayName: FORGERY, role: "member" },
      ]),
    });
    const text = await textOf(opAgents(client, "general", "u-me"));

    expectContained(text);
    expectNoForgedStructure(text);
  });

  it("NEUTRALIZES a hostile handle — the column CHECK is not the render's excuse", async () => {
    // A handle cannot hold this today (`^[a-z][a-z0-9-]{1,30}$`). The renderer
    // is still what guarantees it: a charset rule is an INPUT fence on one
    // table, and deciding per site whether a value is "really" reachable is the
    // reasoning that left close_thread rendering a raw peer title.
    const client = stubClient({
      listChannelAgents: vi.fn(async () => [{ ...QUARTZ, name: FORGERY }]),
    });
    const text = await textOf(opAgents(client, "general", "u-me"));

    expectContained(text);
    expectNoForgedStructure(text);
    // The id is still there — a claim the reader can check.
    expect(text).toContain("`agent-1`");
  });

  it("frames the roster as DATA before rendering any of it", async () => {
    const text = await textOf(opAgents(stubClient(), "general", "u-me"));
    const header = text.indexOf("SECURITY:");
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(text.indexOf("`quartz`"));
  });
});

describe('op="summon_agent"', () => {
  it("summons with no name (the pool path) and teaches addressing", async () => {
    const createChannelAgent = vi.fn(async () => QUARTZ);
    const client = stubClient({ createChannelAgent });

    const text = await textOf(opSummonAgent(client, "general"));

    expect(createChannelAgent.mock.calls[0]).toEqual(["chan-1", {}]);
    expect(text).toContain("Summoned agent `quartz` (`agent-1`)");
    // The call example takes the server-issued ID, not the member-typed handle
    // (both work on `to_agent`). The handle is stated once, through
    // `agentLabel`, which is the only place it may be rendered at all.
    expect(text).toContain('to_agent="agent-1"');
    expect(text).toContain("as_agent");
    expect(text).toContain("REQUIRED for anything it writes to be attributed");
  });

  it("NEUTRALIZES the handle in the teaching line — no raw splice into a call example", async () => {
    // The old line built `to_agent="${agent.name}"` / `as_agent="${agent.name}"`
    // by interpolation, which is the one narration hole this file's own header
    // forbids: a handle is member-typed, and a charset CHECK on one column is
    // not the renderer's excuse (see channel-agent-refs.ts).
    const client = stubClient({
      createChannelAgent: vi.fn(async () => ({ ...QUARTZ, name: FORGERY })),
    });

    const text = await textOf(opSummonAgent(client, "general"));

    expectContained(text);
    expectNoForgedStructure(text);
    expect(text).toContain("`agent-1`");
  });

  it("forwards an explicit name", async () => {
    const createChannelAgent = vi.fn(async () => QUARTZ);
    const client = stubClient({ createChannelAgent });

    await opSummonAgent(client, "general", "quartz");

    expect(createChannelAgent.mock.calls[0]).toEqual(["chan-1", { name: "quartz" }]);
  });

  it("a taken handle says nothing was summoned and how to proceed", async () => {
    const client = stubClient({
      createChannelAgent: vi.fn(async () => {
        throw apiError(409);
      }),
    });

    const res = await opSummonAgent(client, "general", "quartz");

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Nothing was summoned");
    expect(res.content[0].text).toContain("`quartz`");
  });
});

describe('op="rename_agent" / op="set_agent_status" — owner-only writes', () => {
  it("resolves a HANDLE (even @-prefixed) and sends the agent ID", async () => {
    const updateChannelAgent = vi.fn(async () => ({ ...QUARTZ, name: "beryl" }));
    const client = stubClient({ updateChannelAgent });

    const text = await textOf(opRenameAgent(client, "general", "@Quartz", "beryl"));

    expect(updateChannelAgent.mock.calls[0]).toEqual([
      "chan-1",
      "agent-1",
      { op: "rename", name: "beryl" },
    ]);
    expect(text).toContain("Renamed `quartz` (`agent-1`) to `beryl` (`agent-1`)");
    expect(text).toContain("the id is unchanged");
  });

  it("a 403 says the owner rule and that nothing changed", async () => {
    const client = stubClient({
      updateChannelAgent: vi.fn(async () => {
        throw apiError(403);
      }),
    });

    const res = await opRenameAgent(client, "general", "onyx", "beryl");

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("belongs to the member who summoned it");
    expect(res.content[0].text).toContain("Nothing changed");
  });

  it("an unknown handle lists the agents the room DOES have", async () => {
    const res = await opSetAgentStatus(stubClient(), "general", "topaz", "parked");

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No agent `topaz` in this channel");
    expect(res.content[0].text).toContain("`quartz` (`agent-1`)");
  });

  it("dismissal says the row and attribution survive (it is not a delete)", async () => {
    const client = stubClient({
      updateChannelAgent: vi.fn(async () => ({ ...QUARTZ, status: "dismissed" })),
    });

    const text = await textOf(
      opSetAgentStatus(client, "general", "quartz", "dismissed"),
    );

    expect(text).toContain("to dismissed");
    expect(text).toContain("stays attributed to it");
  });
});

describe('op="join_thread" / op="leave_thread" — breakout-room membership', () => {
  it("an AGENT participant is sent as {kind:'agent', id}", async () => {
    const addThreadParticipant = vi.fn(async () => ({
      id: "p-1",
      threadId: "thread-1",
      kind: "agent",
      userId: null,
      agentId: "agent-1",
    }));
    const client = stubClient({ addThreadParticipant });

    const text = await textOf(
      opJoinThread(client, "general", "thread-1", { agent: "quartz" }),
    );

    expect(addThreadParticipant.mock.calls[0]).toEqual([
      "chan-1",
      "thread-1",
      { kind: "agent", id: "agent-1" },
    ]);
    expect(text).toContain("Added `quartz` (`agent-1`) to thread `thread-1`");
    expect(text).toContain("BREAKOUT ROOM");
    // The law holds inside a breakout room too.
    expect(text).toContain("acts only when ADDRESSED");
  });

  it("a MEMBER participant is sent as {kind:'user', id} and is told NOBODY was notified", async () => {
    // B3. `joinThreadParticipant` (src/features/channels/server/
    // service-participants.ts) inserts ONE row: it posts no message, and
    // `channel_task_participants` is deliberately NOT in the realtime
    // publication, so nothing reaches the person on any surface. This line used
    // to say "Admitting a PERSON notifies them", under a test named "notifies,
    // never spawns" — a promise nothing in the product keeps.
    const addThreadParticipant = vi.fn(async () => ({
      id: "p-2",
      threadId: "thread-1",
      kind: "user",
      userId: "u-bob",
      agentId: null,
    }));
    const client = stubClient({ addThreadParticipant });

    const text = await textOf(
      opJoinThread(client, "general", "thread-1", { member: "bob@x.com" }),
    );

    expect(addThreadParticipant.mock.calls[0]).toEqual([
      "chan-1",
      "thread-1",
      { kind: "user", id: "u-bob" },
    ]);
    expect(text).toContain("notifies NOBODY");
    expect(text).not.toContain("notifies them");
    // The true half survives, and the remedy is the one thing that DOES reach
    // a person: an addressed post in the thread.
    expect(text).toContain("never spawns their agent");
    expect(text).toContain('thread="thread-1"');
    expect(text).toContain('to="<them>"');
  });

  it("an AGENT participant is told it must claim itself with as_agent to post", async () => {
    // S1. `mayWriteThread` lets an agent participant write only when the call
    // supplied `authorAgentId`, i.e. `as_agent`. Admitting the agent is half
    // the job; the other half is a param nothing used to mention.
    const client = stubClient({
      addThreadParticipant: vi.fn(async () => ({
        id: "p-1",
        threadId: "thread-1",
        kind: "agent",
        userId: null,
        agentId: "agent-1",
      })),
    });

    const text = await textOf(
      opJoinThread(client, "general", "thread-1", { agent: "quartz" }),
    );

    expect(text).toContain("as_agent");
    expect(text).toContain("the server checks the set against the agent a post CLAIMS");
  });

  it("a CURATION 403 does not tell the caller they left the channel", async () => {
    // The curation rule (service-participants.ts) refuses anyone who is not the
    // thread's creator, its target, or an existing user participant —
    // TaskForbiddenError → 403 TASK_FORBIDDEN. Mapping every 403 to "you are
    // not a member of that channel" turned an ordinary refusal into an alarming
    // false claim about the caller's own membership.
    const client = stubClient({
      addThreadParticipant: vi.fn(async () => {
        throw apiError(403, "TASK_FORBIDDEN");
      }),
    });

    const res = await opJoinThread(client, "general", "thread-1", { agent: "quartz" });

    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).not.toContain("you are not a member");
    expect(text).toContain("curated by the member who OPENED that thread");
    expect(text).toContain("have NOT been removed");
    // And it must not send the caller off to manufacture a duplicate room.
    expect(text).not.toContain('op="create_thread"');
  });

  it("a CHANNEL 403 still says the caller is not a member", async () => {
    const client = stubClient({
      addThreadParticipant: vi.fn(async () => {
        throw apiError(403, "CHANNEL_FORBIDDEN");
      }),
    });

    const res = await opJoinThread(client, "general", "thread-1", { agent: "quartz" });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("you are not a member of that channel");
  });

  it("an EJECT 403 on leave states the narrower rule, not a membership claim", async () => {
    const client = stubClient({
      removeThreadParticipant: vi.fn(async () => {
        throw apiError(403, "TASK_FORBIDDEN");
      }),
    });

    const res = await opLeaveThread(client, "general", "thread-1", { agent: "onyx" });

    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).not.toContain("you are not a member");
    expect(text).toContain("ejecting anyone else is the call of the member who opened");
  });

  it("naming BOTH a member and an agent is refused, not silently preferred", async () => {
    const addThreadParticipant = vi.fn();
    const client = stubClient({ addThreadParticipant });

    const res = await opJoinThread(client, "general", "thread-1", {
      member: "bob@x.com",
      agent: "quartz",
    });

    expect(res.isError).toBe(true);
    expect(addThreadParticipant).not.toHaveBeenCalled();
  });

  it("naming NEITHER says which param to pass", async () => {
    const res = await opJoinThread(stubClient(), "general", "thread-1", {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("`member`");
    expect(res.content[0].text).toContain("`agent`");
  });

  it("leave removes the identity and says the removal is idempotent", async () => {
    const removeThreadParticipant = vi.fn(async () => undefined);
    const client = stubClient({ removeThreadParticipant });

    const text = await textOf(
      opLeaveThread(client, "general", "thread-1", { agent: "onyx" }),
    );

    expect(removeThreadParticipant.mock.calls[0]).toEqual([
      "chan-1",
      "thread-1",
      { kind: "agent", id: "agent-2" },
    ]);
    expect(text).toContain("idempotent");
  });

  it("a thread of another channel is a not-found, not a raw throw", async () => {
    const client = stubClient({
      addThreadParticipant: vi.fn(async () => {
        throw apiError(404);
      }),
    });

    const res = await opJoinThread(client, "general", "thread-9", { agent: "quartz" });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("No thread `thread-9`");
  });
});
