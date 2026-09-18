/**
 * **A SEND ADDRESSES SOMEBODY OR IT IS A RECORD** — the structural half of
 * Samuel's 2026-09-18 ruling, driven through the real registrar.
 *
 * ⚠ **WHY IT IS A SUITE OF ITS OWN AND NOT A BLOCK IN
 * `channel-send-delivery.test.ts`.** That file is about what `to` CARRIES and
 * what `delivery=` REPORTS — both questions about a send that happened. This one
 * is about the sends that do NOT happen, which is a different claim and the one
 * a future trim is most likely to soften: every case here asserts that the
 * transport was never called, because a refusal that still posts is worse than
 * no refusal at all.
 *
 * ⚠ **THE RULING, IN HIS WORDS:** *"agents posting in a channel should always be
 * adding to or addressing another agent, or addressing someone … I don't think
 * there should ever be messages that have no @ unless it really is purely just
 * posting … we should bake this into the structure"*, and *"there are cases where
 * maybe the agent just wants like needs to post something to channel to have a
 * record of it, but it's like really not meant for agents and it might not be
 * meant for like users."*
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan
 * (`channel-law.test.ts`).
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { registerChannelTool } from "./channel.js";
import { callTool, stub, EMPTY_DIRECTORY as DIRECTORY } from "./narration-fixtures.js";
import { SEND_MAX_RECIPIENTS } from "./channel-ops-write.js";

const CHANNEL = { id: "c1", name: "Engineering", slug: "eng" };

function message(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    seq: 42,
    kind: "message",
    authorUserId: "u-me",
    metadata: {},
    recipientUserIds: [],
    recipientAgentIds: [],
    delivery: null,
    deliveryAt: null,
    ...over,
  };
}

function sendStub(post: unknown): DoplClient {
  return stub({
    listChannels: vi.fn(async () => [CHANNEL]),
    getChannel: vi.fn(async () => CHANNEL),
    postChannelMessage: post,
  });
}

async function send(client: DoplClient, args: Record<string, unknown>): Promise<string> {
  return callTool(
    (r, c) => registerChannelTool(r, c, undefined, false, DIRECTORY),
    client,
    "dopl_channel",
    { op: "send", channel: "eng", body: "the audit is done", ...args },
  );
}

describe("a bare send is REFUSED, and the refusal names the two choices", () => {
  it("names BOTH lanes, so the caller's next call is one edit away", async () => {
    const post = vi.fn(async () => message());
    const out = await send(sendStub(post), {});
    // ⚠ NOTHING WAS WRITTEN. The first assertion is the one that matters: a
    // refusal that still posts would leave a row nobody can retract.
    expect(post).not.toHaveBeenCalled();
    expect(out).toContain("Nothing was posted");
    // ⚠ BOTH CHOICES, BY NAME. A refusal that says only "address it" sends an
    // agent with a progress note looking for somebody to aim it at.
    expect(out).toContain("`to`");
    expect(out).toContain('kind="record"');
    // ⚠ AND THE LIST, because an agent that has three people to tell must not
    // learn about the second one on its second refusal.
    expect(out).toContain("one name or several");
  });

  it("a THREAD send needs neither — the thread's two parties ARE the address", async () => {
    // 🔒 **THE CARVE THAT KEEPS TWO AGENTS WORKING A THREAD UNCHANGED.** A thread
    // has exactly two parties, so a reply with no `to` is addressed to the other
    // one by the thread's own structure and the server resolves it (RR1,
    // INVARIANTS §5). Refusing here would break every in-thread exchange.
    const post = vi.fn(async () => message({ metadata: { taskId: "t1" } }));
    await send(sendStub(post), { thread: "t1" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].to).toBeUndefined();
  });

  it("kind=\"milestone\" and kind=\"decision\" are not caught by it", async () => {
    // ⚠ Both are routed BEFORE the check and both are structurally for nobody or
    // for a person reading a card, so a refusal on either would be this rule
    // reaching past its own subject.
    const milestone = vi.fn(async () => message({ kind: "task_progress" }));
    await send(sendStub(milestone), { kind: "milestone", thread: "t1", body: "schema applied" });
    expect(milestone).toHaveBeenCalledTimes(1);

    const decision = vi.fn(async () => message());
    await send(sendStub(decision), {
      kind: "decision",
      summary: "ship or hold?",
      options: [
        { label: "Ship", consequence: "it goes out tonight" },
        { label: "Hold", consequence: "it waits for review" },
      ],
    });
    expect(decision).toHaveBeenCalledTimes(1);
  });
});

describe('kind="record" — the post for nobody', () => {
  it("sends `intent:\"chat\"` on an ordinary message row, and opens `recorded`", async () => {
    // ⚠ **AN EXISTING CONCEPT GIVEN A NAME, NOT A NEW STORED SHAPE.**
    // `intent:"chat"` is the route's own *"this post is not work for anybody"*,
    // so the row is a plain `message` — same seq, same realtime, same transcript,
    // no migration. What the marker BUYS is the refusal above: with a second
    // state available, a send that names nobody can be refused instead of guessed.
    const post = vi.fn(async () => message());
    const out = await send(sendStub(post), { kind: "record" });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1].intent).toBe("chat");
    expect(post.mock.calls[0][1].kind).toBeUndefined();
    // ⚠ ITS OWN VERB, on `milestone`'s precedent: `posted` would report a
    // delivery on the one lane whose contract is that there was none.
    expect(out.startsWith("recorded ")).toBe(true);
    expect(out).toContain("addressed=no");
  });

  it("REFUSES a record that carries `to` — the two say opposite things", async () => {
    const post = vi.fn(async () => message());
    const out = await send(sendStub(post), { kind: "record", to: "ada@example.com" });
    expect(post).not.toHaveBeenCalled();
    expect(out).toContain("cannot carry `to`");
  });
});

describe("`to` takes several recipients, and the result says so", () => {
  it("rides ONE field as given, and the server splits it", async () => {
    // ⚠ THE WIRE SHAPE IS THE EXISTING STRING (2026-09-18). A `string | string[]`
    // union publishes as `anyOf` on a schema every client introspects, and a
    // single-string `to` had to keep working byte-for-byte; one separator that
    // no address in either namespace can contain costs nothing on either side.
    const post = vi.fn(async () =>
      message({ recipientAgentIds: ["k3wpf7c5", "m8q1zzzz"], recipientUserIds: ["u-ada"] }),
    );
    const out = await send(sendStub(post), {
      to: "@builder, @agent-m8q1zzzz, ada@example.com",
    });
    expect(post.mock.calls[0][1].to).toBe("@builder, @agent-m8q1zzzz, ada@example.com");
    expect(out).toContain("addressed=yes");
    // ⚠ `wake=` NAMES THE AGENTS THE SERVER PUT IN FRONT OF A TURN, read off the
    // stored row — the same column the read's `→` arrow renders, so the two
    // cannot disagree about a send that reached three parties.
    expect(out).toContain("wake=@agent-k3wpf7c5,@agent-m8q1zzzz");
  });

  it("REFUSES a list past the cap, in its own words rather than the server's", async () => {
    // ⚠ The server refuses over-cap too, on `CHANNEL_RECIPIENT_UNRESOLVED`, whose
    // narration is about a NAME that matched nobody — right for a typo and wrong
    // for a list that is simply too long.
    const post = vi.fn(async () => message());
    const many = Array.from({ length: SEND_MAX_RECIPIENTS + 1 }, (_, i) => `u-${i}`).join(",");
    const out = await send(sendStub(post), { to: many });
    expect(post).not.toHaveBeenCalled();
    expect(out).toContain(`at most ${SEND_MAX_RECIPIENTS}`);
  });
});
