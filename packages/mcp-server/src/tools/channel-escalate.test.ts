/**
 * `dopl_channel(op="escalate")` — structured escalation cards, and the four
 * rules that make one worth having.
 *
 * ⚠ THE HEADLINE ASSERTION IS THAT THE BODY CARRIES EVERYTHING. The card is
 * `kind='message'` plus reserved `metadata.escalation`, and four live surfaces
 * know nothing about that key — `op="read"`, a plain browser, the pop-out thread
 * window, and every desktop older than the card. If the body were a stub, an
 * escalation would render on all four as an EMPTY ROW, which is the one failure
 * a question nobody can see cannot survive.
 *
 * ⚠ THE OTHER THREE ARE REFUSALS THAT SAY WHICH WAY TO MOVE. The zod schema
 * already refuses <2 and >6 options; what these cases pin is that the SENTENCE
 * distinguishes them, because the two have opposite remedies (one option means
 * DO IT, seven means COLLAPSE THEM) and an opaque -32602 gets an agent to pad
 * the list.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";

import { registerChannelTool } from "./channel";
import { callTool, stub } from "./narration-fixtures";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import {
  ESCALATION_BODY_PARITY_CASES,
  escalationBody,
} from "./channel-escalate-render";

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

const POSTED = {
  id: "m-1",
  seq: 42,
  channelId: "ch-1",
  authorUserId: "u1",
  authorKind: "agent" as const,
  kind: "message" as const,
  body: "",
  metadata: {} as Record<string, unknown>,
  clientMsgId: null,
  createdAt: "2026-01-01T00:00:00Z",
};

const channelStub = (over: Record<string, unknown> = {}) =>
  stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    getChannel: vi.fn(async () => CHANNEL),
    postChannelMessage: vi.fn(async () => POSTED),
    ...over,
  });

const run = (client: DoplClient, args: Record<string, unknown>) =>
  callTool(registerChannelTool, client, "dopl_channel", args);

const OPTIONS = [
  { label: "Ship now", consequence: "Live in ten minutes." },
  { label: "Wait for review", consequence: "Blocked until tomorrow." },
];

const ASK = {
  op: "escalate",
  channel: "with-dana",
  issue: "Ship the migration now or wait?",
  context: "It is additive and reversible.",
  options: OPTIONS,
  recommendation: { index: 0, why: "Reversible, nothing depends on it." },
};

describe("the card DEGRADES — the body carries the whole question", () => {
  it("puts issue, context, every option, every consequence and the recommendation in the body", async () => {
    const post = vi.fn(async () => POSTED);
    await run(channelStub({ postChannelMessage: post }), ASK);
    const body = post.mock.calls[0][1].body as string;
    expect(body).toContain("Ship the migration now or wait?");
    expect(body).toContain("It is additive and reversible.");
    expect(body).toContain("Ship now");
    expect(body).toContain("Live in ten minutes.");
    expect(body).toContain("Wait for review");
    expect(body).toContain("Blocked until tomorrow.");
    expect(body).toContain("Reversible, nothing depends on it.");
  });

  it("sends the payload as the VALIDATED FIELD, never as caller metadata", async () => {
    // ⚠ `metadata.escalation` is stripped from caller input unconditionally
    // server-side. A version of this op that smuggled the payload through
    // `metadata` would post a card that renders as plain prose and nothing else
    // — and would report success doing it.
    const post = vi.fn(async () => POSTED);
    await run(channelStub({ postChannelMessage: post }), ASK);
    const input = post.mock.calls[0][1] as Record<string, unknown>;
    expect(input.escalation).toEqual({
      issue: ASK.issue,
      context: ASK.context,
      options: OPTIONS,
      recommendation: ASK.recommendation,
    });
    expect(input.metadata).toBeUndefined();
  });

  it("leaves `kind` at the default, because any other kind can never notify", async () => {
    // `dopl-desktop-app/main/targeting.js › classify` returns `ignore` for every
    // `kind !== 'message'`, so a card on a `task_*` kind renders in the
    // transcript and pings nobody — half the feature, silently gone.
    const post = vi.fn(async () => POSTED);
    await run(channelStub({ postChannelMessage: post }), ASK);
    expect(post.mock.calls[0][1].kind).toBeUndefined();
  });

  it("ADDRESSES NOBODY — an escalation asks a person, and `to` starts their agent", async () => {
    const post = vi.fn(async () => POSTED);
    await run(channelStub({ postChannelMessage: post }), {
      ...ASK,
      // Even if a caller supplies one, the routing seam does not forward it.
      to: "dana@example.com",
    });
    expect(post.mock.calls[0][1].toUserId).toBeUndefined();
  });
});

describe("the option bounds refuse in the direction that says what to do", () => {
  it("ONE option is refused, and the remedy is to act rather than to pad", async () => {
    const post = vi.fn(async () => POSTED);
    const text = await run(channelStub({ postChannelMessage: post }), {
      ...ASK,
      options: [OPTIONS[0]],
    });
    expect(post).not.toHaveBeenCalled();
    expect(text).toContain("Nothing was posted");
    expect(text).toContain("one option is not a question");
    expect(text).toContain('op="milestone"');
  });

  it("SEVEN options are refused, and the remedy is to collapse rather than to act", async () => {
    const post = vi.fn(async () => POSTED);
    const seven = Array.from({ length: 7 }, (_, i) => ({
      label: `Option ${i}`,
      consequence: `Consequence ${i}`,
    }));
    const text = await run(channelStub({ postChannelMessage: post }), {
      ...ASK,
      options: seven,
      recommendation: { index: 0, why: "First." },
    });
    expect(post).not.toHaveBeenCalled();
    expect(text).toContain("Nothing was posted");
    expect(text).toContain("Collapse the near-duplicates");
  });

  it("an out-of-range recommendation is REFUSED, never dropped", async () => {
    // ⚠ Dropping it posts a card that recommends nothing over an agent that
    // believes it recommended something — the narrate-success-over-invisible-
    // failure shape this whole surface refuses.
    const post = vi.fn(async () => POSTED);
    const text = await run(channelStub({ postChannelMessage: post }), {
      ...ASK,
      recommendation: { index: 5, why: "Out of range." },
    });
    expect(post).not.toHaveBeenCalled();
    expect(text).toContain("outside your own `options` list");
    expect(text).toContain("0-based");
  });
});

/**
 * ⚠ THE THREE APPENDED PARAGRAPHS ARE GONE (T10, 2026-09-02) — what a card is,
 * where the answer arrives, and that the first answer wins. `opEscalate` no
 * longer wraps `opPost`'s result; it rides the shared fact line with its own
 * verb and two extra fields.
 *
 * ⚠ AND THIS IS A HALF-GUARD, DELIBERATELY, BECAUSE THE OTHER HALF IS MISSING.
 * The rule for every "moved, not deleted" case in this tier is: assert the
 * paragraph is out of the RESULT **and** the sentence is still in
 * `channel-doctrine.ts`. `channel-ops-escalate.ts`'s own comment says all three
 * moved there — measured 2026-09-02, the doctrine contains no escalation section
 * at all (no "escalat", no "first one wins", no "card ... buttons"). So the
 * terseness half is pinned below and the doctrine half is REPORTED rather than
 * softened into something weaker that would pass. Add the section and this block
 * gets its second assertion.
 */
describe("the result reports the card it filed, not what a card is", () => {
  it("opens on its OWN verb and counts the options it validated", async () => {
    // ⚠ `milestone` and `escalate` both delegate to `opPost` rather than growing
    // a second delivery path, so a result that opened `posted` for all three
    // would report the wrong ACT — the one kind of wrong nothing downstream can
    // detect. The two extra fields are things only THIS call knows: how many
    // options were filed, and whether a recommendation went with them.
    const text = await run(channelStub(), ASK);
    expect(text.startsWith("escalated ")).toBe(true);
    expect(text).toContain("options=2");
    expect(text).toContain("recommended=0");
  });

  it("⚠ REPORTS THE TAG, which is what decides whether the card is SEEN", async () => {
    // ⚠ A CARD NOBODY IS TAGGED IN IS A CARD NOBODY SEES — the @-tag is what puts
    // it in a person's inbox, and an exact-match resolver posts a mistyped tag
    // successfully and reaches nobody. `tags=0/1` says so in four characters and
    // is the field on this result that matters most.
    const text = await run(channelStub(), {
      ...ASK,
      context: "@samue the rollback window closes at 02:00.",
    });
    expect(text).toContain("tags=0/1");
  });

  it("does not re-teach where the answer arrives, or that the first one wins", async () => {
    // ⚠ TERSENESS GUARD. Both claims are true of EVERY escalation — standing
    // doctrine, not a report on this one — so neither may grow back onto a result
    // an orchestrator reads in a loop. Without this the prose returns one honest
    // sentence at a time.
    const text = await run(channelStub(), ASK);
    expect(text.split("\n")).toHaveLength(1);
    expect(text).not.toContain("NOT PRIVATELY");
    expect(text).not.toContain("ONE ANSWER, FIRST ONE WINS");
    expect(text).not.toContain("ESCALATION CARD");
    // ⚠ What the result DOES hand back is the cursor to watch on, which is the
    // operative half of "where the answer arrives" and costs eight characters.
    // Without it an agent taught by `launch_agent`'s bullet polls a surface that
    // has nothing to give it, forever.
    expect(text).toContain("await=since:42");
  });
});

describe("the published schema and the handler agree about the bounds", () => {
  it("declares 2-6 options", () => {
    // ⚠ PIN THE VALUE ON BOTH SIDES OF A JOIN WITH NO SHARED MODULE
    // (INVARIANTS §14). The handler restates the numbers to build its
    // sentences; a schema that drifted would refuse before the sentence ran and
    // the agent would get the -32602 these cases exist to prevent.
    const options = CHANNEL_INPUT_SHAPE.options;
    const parsedTwo = options.safeParse(OPTIONS);
    expect(parsedTwo.success).toBe(true);
    expect(options.safeParse([OPTIONS[0]]).success).toBe(false);
    expect(
      options.safeParse(
        Array.from({ length: 7 }, () => OPTIONS[0]),
      ).success,
    ).toBe(false);
  });
});

describe("the body render is a HAND COPY and the table is shared", () => {
  it("renders every parity case deterministically", () => {
    // The app tree's twin (`src/features/channels/escalation-body-parity.test.ts`)
    // drives `src/features/channels/escalation.ts › escalationBody` over this
    // same exported table and asserts the identical strings. Either tree
    // changing the render alone fails a suite.
    for (const c of ESCALATION_BODY_PARITY_CASES) {
      const body = escalationBody(c);
      expect(body).toContain(c.issue);
      for (const option of c.options) {
        expect(body).toContain(option.label);
        expect(body).toContain(option.consequence);
      }
      if (c.context) expect(body).toContain(c.context);
      if (c.recommendation) expect(body).toContain(c.recommendation.why);
    }
  });

  it("covers the optional arms, which is where two hand copies drift", () => {
    expect(ESCALATION_BODY_PARITY_CASES.some((c) => !c.context)).toBe(true);
    expect(
      ESCALATION_BODY_PARITY_CASES.some((c) => c.recommendation == null),
    ).toBe(true);
    expect(
      ESCALATION_BODY_PARITY_CASES.some((c) => c.recommendation != null),
    ).toBe(true);
  });
});
