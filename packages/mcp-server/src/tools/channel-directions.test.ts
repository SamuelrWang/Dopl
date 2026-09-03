/**
 * `dopl_channel(op="manage", action="direct")` / `op="status"` — THE PRIVATE
 * DIRECT LANE.
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
 *  - **`to` ACCEPTS THE HANDLE `op="status"` PRINTS.** That op renders `@agent-<id>`, so
 *    that is what a model copies; refusing it would be a 400 for doing what the neighbouring op
 *    taught.
 */

import { describe, it, expect, vi } from "vitest";
import type { DirectionRefusalReason, DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
// ⚠ WHERE THE FIVE SENTENCES WENT (T10, 2026-09-02). A `manage action="direct"`
// result is ONE line of `key=value` facts now; the paragraph per refusal word,
// the privacy framing and the "final text of one turn" bound are standing
// doctrine and are re-pinned on CHANNEL_DOCTRINE below — moved, never dropped.
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
    // ⚠ THE SESSIONS HALF OF `op="status"`. The mailbox is APPENDED to the
    // session table, so a stub that cannot answer this one renders neither.
    listChannelSessions: vi.fn(async () => ({ sessions: [], operatorOnline: true })),
    ...over,
  });

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

const ASK = {
  op: "manage",
  action: "direct",
  channel: "with-dana",
  to: "k3wpf7c5",
  body: "check the deploy and report back",
  wait_ms: 0,
};

/** The read half, scoped to the one room these cases file directions into. */
const STATUS = { op: "status", channel: "with-dana" };

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
    // ⚠ THE SHARPER HALF: the question is not whether an operator is declarable
    // but whether this op can be made to READ a member-shaped value as one.
    // ⚠ `member` LEFT THE SHAPE IN THE FIVE-OP COLLAPSE and `to` is what replaced
    // every recipient spelling — so the member-shaped value is fed through `to`,
    // the ONE param that could carry it. It reaches the wire as `agentId` (the
    // one field this op addresses) and as NOTHING ELSE: no operator field, no
    // second copy, no member column. `member` is still passed beside it, because
    // an undeclared key must not be readable either.
    const create = vi.fn(async () => ({ offline: false, direction: DIRECTION }));
    await run(directionStub({ createAgentDirection: create }), {
      ...ASK,
      member: "someone-else@example.com",
      to: "someone-else@example.com",
    });
    const sent = create.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(
      ["agentId", "body", "channel", "clientMsgId", "threadId"].sort(),
    );
    expect(sent.agentId).toBe("someone-else@example.com");
    for (const [key, value] of Object.entries(sent)) {
      if (key === "agentId") continue;
      expect(JSON.stringify(value ?? null), key).not.toContain("someone-else");
    }
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
  it('takes the `@agent-<id>` handle op="status" prints, and the bare id', async () => {
    for (const form of ["k3wpf7c5", "agent-k3wpf7c5", "@agent-k3wpf7c5", "@k3wpf7c5"]) {
      const create = vi.fn(async () => ({ offline: false, direction: DIRECTION }));
      await run(directionStub({ createAgentDirection: create }), { ...ASK, to: form });
      expect(create.mock.calls[0][0].agentId, form).toBe("k3wpf7c5");
    }
  });

  it("is `to` and NOT `agent` — the banned named-agent param", () => {
    // ⚠ `channel-addressing-rule.test.ts` bans a param literally named `agent`: it was the
    // retired named-agent ADDRESSING surface. ⚠ `agent_id` was the spelling this case pinned
    // until the five-op collapse folded every recipient param into `to`, so the pin moved with
    // it: `to` names an INSTANCE ID on the caller's own machine here and addresses nobody in
    // the channel, which is the distinction that guard keeps.
    expect(CHANNEL_INPUT_SHAPE).toHaveProperty("to");
    expect(CHANNEL_INPUT_SHAPE).not.toHaveProperty("agent_id");
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
    // ⚠ RE-POINTED BY THE FIVE-OP COLLAPSE. The doctrine states the same bound in
    // the `manage` section's one line for this action, and the surface an
    // orchestrator goes to for what an agent is DOING is `op="status"` now.
    expect(CHANNEL_DOCTRINE).toContain(
      '"direct" sends it a private message and reads that turn\'s final text back',
    );
    expect(CHANNEL_DOCTRINE).toContain('op="status"');
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
    // ⚠ RE-POINTED: the paragraph per word became one entry per word in the
    // `manage` section's refusal table, and the "a refusal is normal" headline
    // became that table's opening sentence.
    expect(CHANNEL_DOCTRINE).toContain("`no-session` no such agent");
    expect(CHANNEL_DOCTRINE).toContain("A REFUSAL IS A NORMAL ANSWER");
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
    // ⚠ `op="status"` IS THE ONLY SURFACE a timed-out direction's answer can be
    // picked up from — `read` never shows one — so the token naming it is
    // load-bearing and must be on the line. ⚠ IT WAS `read_directions` until the
    // five-op collapse; the op it names moved, the claim did not.
    expect(text).toContain("poll=");
    // ⚠ THE OP NAME MUST RENDER WHOLE, AND THIS ONCE DID NOT. `renderValue` put
    // every string through `neutralizeInline`, which blanks `_` as markdown
    // emphasis, so this server's OWN constant reached the line as
    // `poll="read directions"` — an op no schema accepted, on the one surface a
    // timed-out direction's answer can be reached from. Fixed 2026-09-02 by
    // passing an already-inert token through unchanged; still asserted as the
    // exact string a caller copies, so the mangling cannot come back on the next
    // token that carries one.
    expect(text).toContain("poll=status");
    expect(text).not.toContain("read directions");
    expect(text).not.toContain("DO NOT ISSUE THIS CALL AGAIN");
    // ⚠ RE-POINTED, AND DELIBERATELY WIDER THAN IT WAS. The direction-specific
    // sentence became ONE timeout rule covering all five `manage` actions, which
    // is the collapse's own design — one text, five mailboxes. It still forbids
    // the bare re-issue and still names the cost.
    expect(CHANNEL_DOCTRINE).toContain(
      "A TIMEOUT IS NOT A FAILURE: the request stays PENDING",
    );
    expect(CHANNEL_DOCTRINE).toContain(
      "re-issuing without the SAME `client_msg_id` starts a SECOND agent",
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

  it("every one of the five words has an entry, `blocked` included", () => {
    // ⚠ EVERY WORD THIS LANE CAN RENDER MUST HAVE A PARAGRAPH BEHIND IT. The
    // result names the word and points at the doctrine, so a word with no entry
    // sends a caller somewhere that has nothing for it. `blocked` — the one
    // DIRECTION word the launch enum does not share — was exactly that gap until
    // 2026-09-02; the list is all five now and a new word must arrive with its
    // paragraph rather than after it.
    const expanded = (Object.keys(RETRY_BY_REASON) as DirectionRefusalReason[]).filter(
      (word) => CHANNEL_DOCTRINE.includes(`\`${word}\``),
    );
    // ⚠ **AND THE FIVE-OP COLLAPSE RE-OPENED IT FOR A DAY**, which is the second
    // time this list caught the same thing: the refusal table went to nine words
    // and `blocked` — the DIRECTION word the launch enum never had — fell out
    // with the paragraphs, while the result went on rendering `reason=blocked`
    // and pointing at a document with nothing for it. Restored 2026-09-02.
    expect(
      expanded.sort(),
      "a refusal word this lane can render has no entry in the doctrine: " +
        "add it to channel-doctrine.ts › MANAGE's refusal table",
    ).toEqual(
      (Object.keys(RETRY_BY_REASON) as DirectionRefusalReason[]).sort(),
    );
  });

  it("...and each expanded word still ends in a next action", () => {
    // ⚠ RE-POINTED WORD BY WORD onto the refusal table the paragraphs became.
    expect(CHANNEL_DOCTRINE).toContain("`no-session` no such agent");
    expect(CHANNEL_DOCTRINE).toContain("`auth-hold` the operator must sign in");
    expect(CHANNEL_DOCTRINE).toContain("`busy` mid-turn");
    expect(CHANNEL_DOCTRINE).toContain("`no-bridge` the operator's LAUNCH toggle is off");
  });

  it("the CONSENT refusal never reads as a fault or suggests a workaround", async () => {
    const text = await run(refusedWith("no-bridge"), ASK);
    // ⚠ `no-bridge` IS THE OPERATOR SAYING NO — their own consent setting. The
    // fact line must not editorialize it into a failure, and `retry=no` must not
    // read as "try harder": there is no other route to look for.
    expect(text).toContain("reason=no-bridge");
    expect(text).toContain("retry=no");
    expect(text).not.toMatch(/error|failure|failed|broken/i);
    // ⚠ RE-POINTED: the table's own entry names WHOSE setting it is, which is the
    // half that stops the word reading as a fault. ⚠ "do not look for another
    // route" was RETIRED BY RULING (contracts only, wave B spec §4) — `retry=no`
    // already says asking again changes nothing — and is pinned ABSENT once, in
    // `channel-ops-agent-doctrine.test.ts › RETIRED_BY_RULING`.
    expect(CHANNEL_DOCTRINE).toContain("`no-bridge` the operator's LAUNCH toggle is off");
  });
});

describe('op="status" — the direction mailbox half', () => {
  it("says the listing is own-scoped and that it could not be otherwise", async () => {
    // ⚠ `op="status"` RENDERS THE SESSION TABLE AND THE MAILBOX, joined by a
    // blank line, so the stub answers `listChannelSessions` too — the directions
    // half is APPENDED to that page rather than replacing it.
    const text = await run(directionStub(), STATUS);
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
      STATUS,
    );
    expect(text).toContain("all green");
    expect(text).toContain("has not been answered YET");
    expect(text).toContain("Do not re-send");
  });

  it("narrows by agent, accepting the printed handle", async () => {
    const list = vi.fn(async () => []);
    await run(directionStub({ listAgentDirections: list }), {
      ...STATUS,
      to: "@agent-k3wpf7c5",
    });
    // ⚠ `channel` IS NO LONGER `undefined` HERE, and that is the op's own doing:
    // `read_directions` took no channel, while `op="status"` filters by the one
    // it was given (omitting it WIDENS the whole page, sessions included). What
    // this case pins is unchanged — the PRINTED handle is accepted and reaches
    // the server as the bare id.
    expect(list.mock.calls[0][0]).toEqual({ channel: "ch-1", agent: "k3wpf7c5" });
  });
});
