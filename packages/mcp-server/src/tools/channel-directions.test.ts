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
import type { DirectionRefusalReason, DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
// ⚠ WHERE THE FIVE SENTENCES WENT (T10, 2026-09-02). A `direct_agent` result is
// ONE line of `key=value` facts now; the paragraph per refusal word, the
// privacy framing and the "final text of one turn" bound are standing doctrine
// and are re-pinned on CHANNEL_DOCTRINE below — moved, never dropped.
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { WRITE_RESULT_MAX_CHARS } from "./channel-facts";

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
    // ⚠ `clientMsgId` JOINED THE BODY ON 2026-09-02 (A10/G10) AND NAMES NO
    // OPERATOR. It says which GESTURE this row is; the operator is still stamped
    // server-side from the credential and is still absent from every payload.
    expect(Object.keys(create.mock.calls[0][0]).sort()).toEqual(
      ["agentId", "body", "channel", "clientMsgId", "threadId"].sort(),
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

/** A stub whose direction comes back REFUSED with one word. */
const refusedWith = (refusalReason: DirectionRefusalReason) =>
  directionStub({
    createAgentDirection: vi.fn(async () => ({
      offline: false,
      direction: { ...DIRECTION, status: "refused", refusalReason },
    })),
  });

describe("the terminal shapes", () => {
  it("OFFLINE files nothing, and `filed=no` is how it says so", async () => {
    const text = await run(
      directionStub({ createAgentDirection: vi.fn(async () => ({ offline: true, direction: null })) }),
      ASK,
    );
    // ⚠ `filed=no` IS THE LOAD-BEARING HALF, and it is the EXACT OPPOSITE of the
    // PENDING shape below: nothing was written, so there is nothing pending and
    // nothing to cancel. A caller that reads the two alike either chases a row
    // that does not exist or leaves a live one alone.
    expect(text).toContain("not delivered");
    expect(text).toContain("reason=offline");
    expect(text).toContain("filed=no");
    // ⚠ AND IT NAMES A REASON, NOT A VERDICT ABOUT A MACHINE. `agent_presence`
    // is a per-(user, workspace) heartbeat: it cannot say WHICH machine is up,
    // or whether directing is enabled there, so nothing here may assert one is
    // down. ⚠ The paragraph that used to spell that out has NO home in
    // `channel-doctrine.ts` — a REPORTED production gap, not an omission here.
    expect(text).not.toMatch(/your (machine|desktop) is/i);
    expect(text.split("\n")).toHaveLength(1);
  });

  it("DELIVERED is a fact line plus the reply as PAYLOAD under it", async () => {
    const text = await run(
      directionStub({
        createAgentDirection: vi.fn(async () => ({
          offline: false,
          direction: { ...DIRECTION, status: "delivered", reply: "the deploy is green" },
        })),
      }),
      ASK,
    );
    const [head] = text.split("\n");
    // ⚠ THE 300-CHAR BUDGET IS OVER THE FACT LINE, NOT THE WHOLE RESULT, and
    // that is not a loophole: a direction's REPLY exists on NO other surface
    // (`read`/`await` never show one), so clipping it deletes the call's value.
    expect(head).toContain("reply=below");
    expect(head.length, head).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
    expect(text).toContain("Its answer:");
    expect(text).toContain("the deploy is green");
    // ⚠ THE NARRATION AROUND IT LEFT AND MAY NOT GROW BACK — and must still be
    // in the product, or an orchestrator reads a turn's final text as the
    // agent's running commentary.
    expect(text).not.toContain("FINAL TEXT OF ONE TURN");
    expect(CHANNEL_DOCTRINE).toContain("FINAL TEXT OF ONE TURN");
    expect(CHANNEL_DOCTRINE).toContain('op="read_sessions"');
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
    // ⚠ THE WORD `reported` IS THE WHOLE DISTINCTION AND MAY NEVER BE TRADED
    // AWAY. Either the turn's final text was empty, or that desktop predates the
    // answer-reporting build — this cannot tell which, and an orchestrator that
    // reads `none-reported` as "the agent said nothing" concludes it is broken.
    // A bare `reply=none` or `reply=-` would be exactly that misreading.
    expect(text).toContain("reply=none-reported");
    expect(text).not.toMatch(/reply=(none|-)(?![-\w])/);
    // ⚠ No body at all — `reply=below` is the ONLY shape that carries one.
    expect(text.split("\n")).toHaveLength(1);
    expect(text).not.toContain("Its answer:");
  });

  it("REFUSED renders the word and the retry verdict, and files the row", async () => {
    const text = await run(refusedWith("no-session"), ASK);
    expect(text).toContain("reason=no-session");
    expect(text).toContain("retry=no");
    // ⚠ `filed=yes`: the row exists and was ANSWERED — nothing is pending and
    // there is nothing to cancel, which is what "a refusal is normal" means in
    // one token.
    expect(text).toContain("filed=yes");
    expect(text).not.toContain("NO SUCH AGENT RUNNING");
    // ⚠ MOVED, NOT DELETED: the word's own sentence, and that a refusal is a
    // normal answer rather than an error.
    expect(CHANNEL_DOCTRINE).toContain(
      "no LIVE session of your operator's carries that agent id",
    );
    expect(CHANNEL_DOCTRINE).toContain("normal answer from a machine its owner controls");
  });

  it("PENDING forbids re-issuing, and names the one place the answer lands", async () => {
    const text = await run(directionStub(), ASK);
    // ⚠ Worse here than on the launch lane: a second direction says the same
    // thing to a LIVE agent twice, and it answers twice with no way for either
    // side to tell which answer belonged to which. `retry=no` is that
    // instruction, and it may never be softened or dropped for brevity.
    expect(text).toContain("pending");
    expect(text).toContain("retry=no");
    expect(text).toContain("direction=d-1");
    // ⚠ `read_directions` is the ONLY surface a timed-out direction's answer can
    // be picked up from — `read`/`await` never show one — so the token naming it
    // is load-bearing and must be on the line.
    expect(text).toContain("poll=");
    // ⚠ THE OP NAME MUST RENDER WHOLE, AND THIS ONCE DID NOT. `renderValue` put
    // every string through `neutralizeInline`, which blanks `_` as markdown
    // emphasis, so this server's OWN constant reached the line as
    // `poll="read directions"` — an op no schema accepts, on the one surface a
    // timed-out direction's answer can be reached from. Fixed 2026-09-02 by
    // passing an already-inert token through unchanged; asserted here as the
    // exact string a caller copies, so the mangling cannot come back.
    expect(text).toContain("poll=read_directions");
    expect(text).not.toContain("read directions");
    expect(text).not.toContain("DO NOT ISSUE THIS CALL AGAIN");
    expect(CHANNEL_DOCTRINE).toContain(
      "a second direction says the same thing to a live agent twice",
    );
  });
});

/**
 * ⚠ A `Record<DirectionRefusalReason, …>` FOR THE SAME REASON PRODUCTION'S
 * `RETRY_ADVICE` IS ONE: the five words are the wire contract, and a sixth
 * cannot enter the enum without this table being made to account for it. What
 * survives in a result is the WORD plus the one decision every sentence was
 * leading to; the sentences themselves are in `channel-doctrine.ts`.
 */
const RETRY_BY_REASON: Record<DirectionRefusalReason, "once" | "no"> = {
  "no-session": "no",
  "auth-hold": "no",
  busy: "once",
  blocked: "no",
  "no-bridge": "no",
};

describe("every refusal word renders its verdict, and the doctrine explains it", () => {
  it.each(Object.entries(RETRY_BY_REASON))(
    "%s → retry=%s",
    async (reason, retry) => {
      const text = await run(refusedWith(reason as DirectionRefusalReason), ASK);
      expect(text, reason).toContain(`reason=${reason}`);
      expect(text, reason).toContain(`retry=${retry}`);
      expect(text, reason).toContain("filed=yes");
    },
  );

  it("`busy` is the ONLY one that invites a retry", () => {
    // ⚠ Collapsing these to a boolean would either invite a retry loop against a
    // setting nobody is going to flip, or forbid the one retry that works.
    expect(
      Object.entries(RETRY_BY_REASON).filter(([, v]) => v === "once"),
    ).toEqual([["busy", "once"]]);
  });

  it("REPORTED GAP: the doctrine expands four of the five words, not `blocked`", () => {
    // ⚠ EVERY WORD THIS LANE CAN RENDER MUST HAVE A PARAGRAPH BEHIND IT. The
    // result names the word and points at the doctrine, so a word with no entry
    // sends a caller somewhere that has nothing for it. `blocked` — the one
    // DIRECTION word the launch enum does not share — was exactly that gap until
    // 2026-09-02; the list is all five now and a new word must arrive with its
    // paragraph rather than after it.
    const expanded = (Object.keys(RETRY_BY_REASON) as DirectionRefusalReason[]).filter(
      (word) => CHANNEL_DOCTRINE.includes(`\`${word}\``),
    );
    expect(
      expanded.sort(),
      "a refusal word this lane can render has no paragraph in the doctrine",
    ).toEqual(
      (Object.keys(RETRY_BY_REASON) as DirectionRefusalReason[]).sort(),
    );
  });

  it("...and each expanded word still ends in a next action", () => {
    expect(CHANNEL_DOCTRINE).toContain("no LIVE session of your operator's carries"); // no-session
    expect(CHANNEL_DOCTRINE).toContain("Tell your operator"); // auth-hold
    expect(CHANNEL_DOCTRINE).toContain("a minute or two"); // busy
    expect(CHANNEL_DOCTRINE).toContain("ASK THEM"); // no-bridge
  });

  it("the CONSENT refusal never reads as a fault or suggests a workaround", async () => {
    const text = await run(refusedWith("no-bridge"), ASK);
    // ⚠ `no-bridge` IS THE OPERATOR SAYING NO — their own consent setting. The
    // fact line must not editorialize it into a failure, and `retry=no` must not
    // read as "try harder": there is no other route to look for.
    expect(text).toContain("reason=no-bridge");
    expect(text).toContain("retry=no");
    expect(text).not.toMatch(/error|failure|failed|broken/i);
    expect(CHANNEL_DOCTRINE).toContain("deliberate setting, not a failure");
    expect(CHANNEL_DOCTRINE).toContain("do not look for another route");
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
