/**
 * `dopl_channel(op="direct_agent")` / `op="read_directions"` — THE PRIVATE DIRECT LANE.
 *
 * ⚠ **THE HEADLINE ASSERTION IS AN ABSENCE.** There is no argument on this surface that names
 * an operator, and there never may be: the server stamps the authenticated caller, and that
 * absence IS the authorization story. A peer cannot be directed and cannot direct you.
 *
 * The other properties that fail quietly:
 *  - **A TIMEOUT IS NOT A REFUSAL**, and the result must forbid re-issuing in the strongest
 *    terms available — a second direction says the same thing to a LIVE agent twice, and it
 *    answers twice with no way to tell the two apart.
 *  - **`null` REPLY MEANS NOT REPORTED**, never "the agent said nothing". Those are different
 *    facts and an orchestrator that reads one as the other concludes its agent is broken.
 *  - **THE FIVE REFUSAL WORDS EACH END IN A NEXT ACTION**, because a reason with no next action
 *    gets an agent to retry the same call.
 *  - **`agent_id` ACCEPTS THE HANDLE `read_sessions` PRINTS.** That op renders `@agent-<id>`, so
 *    that is what a model copies; refusing it would be a 400 for doing what the neighbouring op
 *    taught.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";

const CHANNEL = {
  id: "ch-1",
  workspaceId: "ws-1",
  slug: "with-dana",
  name: "With Dana",
  topic: "",
  visibility: "private" as const,
  createdBy: "u1",
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const DIRECTION = {
  id: "d-1",
  operatorUserId: "u1",
  channelId: "ch-1",
  threadId: null,
  agentId: "k3wpf7c5",
  body: "check the deploy",
  status: "pending" as const,
  refusalReason: null,
  reply: null,
  claimedAt: null,
  decidedAt: null,
  expiresAt: "2026-01-01T00:10:00Z",
  createdAt: "2026-01-01T00:00:00Z",
};

const directionStub = (over: Record<string, unknown> = {}) =>
  stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    getChannel: vi.fn(async () => CHANNEL),
    createAgentDirection: vi.fn(async () => ({ offline: false, direction: DIRECTION })),
    getAgentDirection: vi.fn(async () => DIRECTION),
    listAgentDirections: vi.fn(async () => []),
    ...over,
  });

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

const ASK = {
  op: "direct_agent",
  channel: "with-dana",
  agent_id: "k3wpf7c5",
  body: "check the deploy and report back",
  wait_ms: 0,
};

describe("🔒 the lane reaches the caller's OWN operator and nobody else", () => {
  it("publishes NO argument that names an OPERATOR, on either op", () => {
    // ⚠ THE WHOLE AUTHORIZATION STORY, asserted rather than described. A param an MCP client
    // can see is a param a model will try.
    // ⚠ `member` IS DELIBERATELY NOT IN THIS LIST and is a pre-existing param of `invite` /
    // `open` — it names somebody to ADD TO A CHANNEL, which is a different question from whose
    // MACHINE runs an agent. Asserting its absence would pin an unrelated op's surface.
    for (const key of ["operator", "operatorUserId", "operator_id", "user", "user_id"]) {
      expect(CHANNEL_INPUT_SHAPE, key).not.toHaveProperty(key);
    }
  });

  it("routes NO member-shaped argument into a direction, even when one is passed", async () => {
    // ⚠ THE SHARPER HALF: `member` exists on the shape for other ops, so the question is not
    // whether it is declarable but whether this op can be made to READ it.
    const create = vi.fn(async () => ({ offline: false, direction: DIRECTION }));
    await run(directionStub({ createAgentDirection: create }), {
      ...ASK,
      member: "someone-else@example.com",
      to: "someone-else@example.com",
    });
    const sent = JSON.stringify(create.mock.calls[0][0]);
    expect(sent).not.toContain("someone-else");
  });

  it("sends no operator field to the server either", async () => {
    const create = vi.fn(async () => ({ offline: false, direction: DIRECTION }));
    await run(directionStub({ createAgentDirection: create }), ASK);
    expect(Object.keys(create.mock.calls[0][0]).sort()).toEqual(
      ["agentId", "body", "channel", "threadId"].sort(),
    );
  });
});

describe("the agent id it accepts", () => {
  it("takes the `@agent-<id>` handle `read_sessions` prints, and the bare id", async () => {
    for (const form of ["k3wpf7c5", "agent-k3wpf7c5", "@agent-k3wpf7c5", "@k3wpf7c5"]) {
      const create = vi.fn(async () => ({ offline: false, direction: DIRECTION }));
      await run(directionStub({ createAgentDirection: create }), { ...ASK, agent_id: form });
      expect(create.mock.calls[0][0].agentId, form).toBe("k3wpf7c5");
    }
  });

  it("is `agent_id` and NOT `agent` — the banned named-agent param", () => {
    // ⚠ `channel-addressing-rule.test.ts` bans a param literally named `agent`: it was the
    // retired named-agent ADDRESSING surface. This one names an INSTANCE ID on the caller's own
    // machine and addresses nobody in the channel, which is the distinction that guard keeps.
    expect(CHANNEL_INPUT_SHAPE).toHaveProperty("agent_id");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("agent");
  });
});

describe("the terminal shapes", () => {
  it("OFFLINE files nothing, and says the check is a hint rather than a verdict", async () => {
    const text = await run(
      directionStub({ createAgentDirection: vi.fn(async () => ({ offline: true, direction: null })) }),
      ASK,
    );
    expect(text).toContain("No direction was filed");
    expect(text).toContain("HINT, NOT A VERDICT");
  });

  it("DELIVERED renders the reply and bounds what it is", async () => {
    const text = await run(
      directionStub({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: { ...DIRECTION, status: "delivered", reply: "the deploy is green" },
        })),
      }),
      ASK,
    );
    expect(text).toContain("the deploy is green");
    expect(text).toContain("FINAL TEXT OF ONE TURN");
    expect(text).toContain("read_sessions");
  });

  it("DELIVERED with no reply says NOT REPORTED, never 'it said nothing'", async () => {
    const text = await run(
      directionStub({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: { ...DIRECTION, status: "delivered", reply: null },
        })),
      }),
      ASK,
    );
    expect(text).toContain("NO ANSWER TEXT");
    expect(text).toContain("not the same as the agent saying nothing");
  });

  it("REFUSED renders the word's own sentence, and says a refusal is normal", async () => {
    const text = await run(
      directionStub({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: { ...DIRECTION, status: "refused", refusalReason: "no-session" },
        })),
      }),
      ASK,
    );
    expect(text).toContain("NO SUCH AGENT RUNNING");
    expect(text).toContain("normal answer");
  });

  it("PENDING forbids re-issuing in the strongest terms, and names where to look", async () => {
    // ⚠ Worse here than on the launch lane: a second direction says the same thing to a LIVE
    // agent twice, and it answers twice.
    const text = await run(directionStub(), ASK);
    expect(text).toContain("DO NOT ISSUE THIS CALL AGAIN");
    expect(text).toContain("answer twice");
    expect(text).toContain('op="read_directions"');
  });
});

describe("every refusal word has a sentence that ends in a next action", () => {
  it.each([
    ["no-session", "read_sessions"],
    ["auth-hold", "Tell your operator"],
    ["busy", "a minute or two"],
    ["blocked", "update"],
    ["no-bridge", "ASK THEM"],
  ])("%s", async (reason, remedy) => {
    const text = await run(
      directionStub({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: { ...DIRECTION, status: "refused", refusalReason: reason },
        })),
      }),
      ASK,
    );
    expect(text).toContain(remedy);
  });

  it("the CONSENT refusal never reads as a fault or suggests a workaround", async () => {
    const text = await run(
      directionStub({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: { ...DIRECTION, status: "refused", refusalReason: "no-bridge" },
        })),
      }),
      ASK,
    );
    expect(text).toContain("deliberate setting, not a failure");
    expect(text).toContain("do not look for another route");
  });
});

describe("op=read_directions", () => {
  it("says the listing is own-scoped and that it could not be otherwise", async () => {
    const text = await run(directionStub(), { op: "read_directions" });
    expect(text).toContain("YOUR OWN SIDE ONLY");
    expect(text).toContain("no way to ask about one");
  });

  it("renders the answer, and what an unanswered row means", async () => {
    const text = await run(
      directionStub({
        listAgentDirections: vi.fn(async () => [
          { ...DIRECTION, status: "delivered", reply: "all green" },
          { ...DIRECTION, id: "d-2", status: "pending" },
        ]),
      }),
      { op: "read_directions" },
    );
    expect(text).toContain("all green");
    expect(text).toContain("has not been answered YET");
    expect(text).toContain("Do not re-send");
  });

  it("narrows by agent, accepting the printed handle", async () => {
    const list = vi.fn(async () => []);
    await run(directionStub({ listAgentDirections: list }), {
      op: "read_directions",
      agent_id: "@agent-k3wpf7c5",
    });
    expect(list.mock.calls[0][0]).toEqual({ channel: undefined, agent: "k3wpf7c5" });
  });
});
