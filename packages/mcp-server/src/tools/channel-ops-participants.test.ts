/**
 * THE PARTICIPANT SET, MUTATED — `dopl_channel` join_thread / leave_thread.
 *
 * What these pin:
 *
 *  1. THE WIRE. A member goes out as `{kind:"user", id}` and an agent as
 *     `{kind:"agent", id}`, with the handle resolved to a row of THIS channel;
 *     naming BOTH is refused rather than silently preferring one, and naming
 *     NEITHER says which param to pass.
 *  2. WHAT ADMISSION DOES NOT DO. `joinThreadParticipant` inserts ONE row: it
 *     posts no message, and `channel_task_participants` is deliberately NOT in
 *     the realtime publication, so admitting a person reaches them on no
 *     surface at all. This line used to promise the opposite (B3). An admitted
 *     AGENT is likewise only half-admitted until a post CLAIMS it with
 *     `as_agent`, which `mayWriteThread` checks (S1).
 *  3. WHICH RULE A 403 MEANS. Thread curation, channel membership and ejection
 *     are three different refusals; mapping them all to "you are not a member
 *     of that channel" turned an ordinary refusal into an alarming false claim
 *     about the caller's own membership, and must never send the caller off to
 *     manufacture a duplicate room.
 *
 * THE OTHER HALF: the ops that write the AGENT ROW itself (agents /
 * summon_agent / rename_agent / set_agent_status / disengage_agent) stay in
 * `channel-ops-agents.test.ts`, which this was split out of at the §2 500-line
 * cap — see that file's header for why the seam runs between the two tables.
 * SEEDING a set at open time, rather than mutating one that exists, is a third
 * suite: `channel-thread-participants.test.ts`. The harness this shares with
 * the agent-row half is `agent-ops-fixtures.ts`.
 *
 * The @dopl/client is hand-stubbed; nothing transports.
 */

import { describe, it, expect, vi } from "vitest";
import { opJoinThread, opLeaveThread } from "./channel-ops-agents";
import { apiError, stubClient, textOf } from "./agent-ops-fixtures";

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
