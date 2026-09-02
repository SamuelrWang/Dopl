/**
 * THE PER-MENTION REPORT — what each `@…` in a posted body actually was
 * (2026-08-31).
 *
 * ── THE DEFECT IT CLOSES ─────────────────────────────────────────────────────
 * `tagOutcomeNote` answered ONE question — how many HUMAN handles the server
 * stamped — and then, on zero, spent a paragraph on five spelling-and-roster
 * causes. That is the right answer for a body whose tokens are all member
 * handles. It is the WRONG answer for the ordinary shape of an orchestration
 * post, which carries both kinds at once ("@samuel please look,
 * @agent-x2sz1ztt carry on"): the count is over the human half, and printed
 * alone it reads as a verdict on the whole body. On 2026-08-31 a live
 * orchestrator read exactly that and concluded its AGENT handle was misspelled.
 *
 * ⚠ THE FIX SURVIVED T10/T12 AND GOT SHARPER (2026-09-02). The per-mention
 * PROSE (`mentionBreakdownLine`) and the five-cause paragraph
 * (`tagOutcomeNote`) are both gone from the result; the standing halves are in
 * `channel-doctrine.ts` and the per-call half is two tokens,
 * `tags=<resolved>/<attempted>` and `wake=<handles>`. The SPLIT this file exists
 * for is now structural rather than editorial: `tagFact` counts MEMBER handles
 * only, so an agent handle can no longer be rendered as a failed tag at all.
 *
 * ── THE LINE THIS PACKAGE IS ALLOWED TO DRAW ─────────────────────────────────
 * Three facts fix the shape of every assertion below, and each of them is a
 * limit rather than a feature:
 *   • THE GRAMMAR IS PUBLIC, so the ID FORM is decidable HERE, exactly.
 *   • WHETHER AN AGENT HANDLE REACHED ANYTHING IS NOT DECIDABLE ANYWHERE ON THE
 *     SERVER — the resolver is a desktop, over ids minted on that desktop. So
 *     the report says what a token IS, never that it arrived.
 *   • WHICH human handle resolved is not decidable either: the server stamps
 *     READER IDS, not the tokens they came from. A partial resolve therefore
 *     reports a FRACTION and names no token — inventing a join by position or by
 *     count would name the wrong one.
 */

import { describe, expect, it, vi } from "vitest";
import type { ChannelMessage, DoplClient } from "@dopl/client";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { opPost } from "./channel-ops-write";
import {
  classifyMentions,
  postMentionFacts,
} from "./channel-post-guidance";

/** A stored message carrying the server's own stamped resolution, or none. */
const stored = (mentionedUserIds?: string[]): ChannelMessage =>
  ({
    id: "m1",
    seq: 42,
    body: "",
    kind: "message",
    metadata: mentionedUserIds ? { mentionedUserIds } : {},
  }) as unknown as ChannelMessage;

const kinds = (body: string) =>
  classifyMentions(body).map((m) => `${m.kind}:${m.token}`);

describe("classifyMentions — by SHAPE, and the shape rule is the desktop's", () => {
  it("reads both agent forms as agent handles", () => {
    // ⚠ Both, because `session-dispatch.js › mentionedAgentIds` takes both. A
    // classifier that knew only the prefixed form would report every message
    // written before the 2026-08-27 convention change as a member handle.
    expect(kinds("@agent-x2sz1ztt and @k3v7d2mq")).toEqual([
      "agent:agent-x2sz1ztt",
      "agent:k3v7d2mq",
    ]);
  });

  it("reads anything else as a member handle", () => {
    expect(kinds("@samuel @diana-w @flint")).toEqual([
      "handle:samuel",
      "handle:diana-w",
      "handle:flint",
    ]);
  });

  it("strips TRAILING punctuation and not leading — the resolver's own rule", () => {
    // `lib/mentions.ts › mentionHandleOf`. Without it a handle at the end of a
    // sentence classifies as a member handle and the report says the opposite
    // of the truth about the most common way anyone writes one.
    expect(kinds("ask @agent-x2sz1ztt.")).toEqual(["agent:agent-x2sz1ztt"]);
    expect(kinds("(@agent-x2sz1ztt)")).toEqual(["agent:agent-x2sz1ztt"]);
  });

  it("de-duplicates — the report is about ADDRESSES, not occurrences", () => {
    expect(kinds("@samuel @samuel @samuel")).toEqual(["handle:samuel"]);
  });

  it("does NOT exempt a backticked handle", () => {
    // ⚠ The server skips a handle inside a code span, and swallowing it HERE
    // would leave `tags=0/1` — the one signal that sends a reader to the
    // doctrine's FIRST cause — unwritten. This asks what the AUTHOR wrote.
    expect(kinds("write `@samuel` to tag them")).toEqual(["handle:samuel"]);
  });

  it("answers empty for a body with no tokens", () => {
    expect(classifyMentions("no handles here")).toEqual([]);
    expect(classifyMentions("")).toEqual([]);
  });
});

/**
 * ⚠ `mentionBreakdownLine` BECAME `postMentionFacts` (T12). Every case below is
 * the same claim re-pointed at the token that carries it: the prose that named a
 * limit moved to `channel-doctrine.ts` and is pinned there, and the half that was
 * a FACT about this write stayed, as `tags=` / `wake=`.
 */
describe("postMentionFacts — says what it knows and nothing past it", () => {
  const facts = (body: string, resolved?: string[]) =>
    postMentionFacts(body, stored(resolved));

  it("both fields are ABSENT when the body carried no `@`", () => {
    // ⚠ Absent, never zero: `tags=0/0` would read as a failed tag on the
    // overwhelming majority of posts, which carry no `@` at all.
    expect(facts("just a report", [])).toEqual({ tags: undefined, wake: undefined });
  });

  it("⚠ NAMES AN AGENT HANDLE AS A WAKE, WITH ITS TWO LIMITS", () => {
    // ⚠ The zero COUNT beside it was about the human roster and said nothing
    // about this token — which is exactly what the repro's caller read it as.
    // There is no count beside it any more: `tags` is absent, and the handle
    // rides `wake=`.
    expect(facts("@agent-x2sz1ztt go", [])).toEqual({
      tags: undefined,
      wake: "@agent-x2sz1ztt",
    });
    // The two limits the prose carried are standing doctrine and are pinned
    // there, because a token cannot state them and they may not simply vanish.
    // (1) OWN OPERATOR ONLY — the 2026-08-28 fence, which the carve did not move.
    expect(CHANNEL_DOCTRINE).toContain("Never another member's agent");
    expect(CHANNEL_DOCTRINE).toContain("it works only for YOUR OWN operator's agents");
    // (2) NOT OBSERVABLE — the wake is decided on a desktop no server can see.
    expect(CHANNEL_DOCTRINE).toContain("delivery is not observable from here");
    expect(CHANNEL_DOCTRINE).toContain("rather than assuming it woke");
  });

  it("says an agent handle stamps nobody, so no inbox is involved", () => {
    expect(facts("@k3v7d2mq", []).tags).toBeUndefined();
    expect(facts("@k3v7d2mq", []).wake).toBe("@agent-k3v7d2mq");
    expect(CHANNEL_DOCTRINE).toContain("it stamps nobody and lands in no Tags inbox");
    expect(CHANNEL_DOCTRINE).toContain("starts no inbox entry");
  });

  it("reports member handles against the server's own COUNT — all landed", () => {
    expect(facts("@samuel @diana", ["u-1", "u-2"]).tags).toBe("2/2");
  });

  it("says NONE resolved when the count is zero", () => {
    // ⚠ `0/1` IS the old "NONE of them resolved / nobody's Tags inbox has it",
    // and it is the ONE signal in the product that catches a misspelled handle
    // (INVARIANTS §10). It may never be traded for brevity.
    expect(facts("@dia", []).tags).toBe("0/1");
  });

  it("⚠ IS HONEST ABOUT A PARTIAL RESOLVE — it will not guess WHICH", () => {
    // The stamp is a set of reader ids; the tokens are strings. There is no join
    // here, and inventing one by position would name the wrong token as the
    // failure — which is worse than saying nothing, because it is actionable and
    // wrong. The fraction states the arithmetic and names nobody.
    const tags = String(facts("@samuel @dia", ["u-1"]).tags);
    expect(tags).toBe("1/2");
    expect(tags).not.toContain("samuel");
    expect(tags).not.toContain("dia");
  });

  it("splits a MIXED body into its two halves — the case that misled the repro", () => {
    // ⚠ THE HEADLINE CASE OF THIS FILE. The member half LANDED, and the agent
    // half is not in the fraction at all: a `1/2` here — one stamp over two
    // tokens — is the half-failure narration the live orchestrator acted on.
    expect(facts("@samuel please look, @agent-x2sz1ztt carry on", ["u-1"])).toEqual({
      tags: "1/1",
      wake: "@agent-x2sz1ztt",
    });
  });
});

/**
 * ⚠ `postGuidanceLines` IS GONE AND THIS IS ITS GUARD (T12). It spliced up to
 * three standing paragraphs under every successful post; each is now stated once
 * in `channel-doctrine.ts`. Both halves are asserted in every case below — the
 * paragraph is out of the RESULT, and the rule is still IN the product — so the
 * prose can neither grow back nor silently disappear.
 */
describe("what a post result actually carries about its `@` tokens", () => {
  const CHANNEL = { id: "chan-1", slug: "eng", name: "eng", visibility: "private" };

  async function resultOf(body: string, resolved: string[], thread?: string) {
    const client = {
      listChannels: vi.fn(async () => [CHANNEL]),
      postChannelMessage: vi.fn(async () => ({
        id: "m1",
        seq: 42,
        kind: "message",
        authorUserId: "u-me",
        metadata: { ...(thread ? { taskId: thread } : {}), mentionedUserIds: resolved },
      })),
    } as unknown as DoplClient;
    const res = await opPost(client, "eng", body, thread ? { thread } : {});
    expect(res.isError).toBeFalsy();
    return res.content[0].text;
  }

  it("⚠ AN AGENT-ONLY BODY GETS NO ROSTER VERDICT", async () => {
    // ⚠ THE SECOND HALF OF THE 2026-08-31 FIX. `tagOutcomeNote`'s zero branch was
    // five causes about spelling, membership and ambiguity — printed over a body
    // that named no member at all, it answered a question the caller did not ask,
    // in the voice of a defect, about the one thing they did right. There is no
    // fraction to misread now: `tags=-`, and the handle is reported as a wake.
    const out = await resultOf("@agent-x2sz1ztt read the room", []);
    expect(out).toContain("tags=-");
    expect(out).toContain("wake=@agent-x2sz1ztt");
    expect(out).not.toContain("tags=0/1");
    expect(out).not.toContain("RESOLVED TO NOBODY");
    expect(out).not.toContain("FIVE");
  });

  it("a MEMBER handle that reached nobody still reports the verdict", async () => {
    // ⚠ The VERDICT stayed and the CAUSES left, and neither is derivable from
    // the other — so both are pinned: `0/1` here, the five reasons in the
    // doctrine one `op="help"` away.
    const out = await resultOf("@dia can you look", []);
    expect(out).toContain("tags=0/1");
    expect(out).not.toContain("wake=@");
    expect(CHANNEL_DOCTRINE).toContain("WHY A TAG RESOLVES TO NOBODY — FIVE CAUSES");
  });

  it("a MIXED body reports both, in the two fields that cannot be confused", async () => {
    const out = await resultOf("@dia and @agent-x2sz1ztt", []);
    expect(out).toContain("tags=0/1");
    expect(out).toContain("wake=@agent-x2sz1ztt");
  });

  it("the standing lines are OUT of the result and IN the doctrine", async () => {
    // ⚠ At most ONE standing line used to ride here, chosen by where the post
    // LANDED — the main-room sparseness bar or the when-to-tag note. Both were
    // true before the call and after it, so both moved; `landed=` is what the
    // result says about where this post went.
    const room = await resultOf("@agent-x2sz1ztt go", []);
    expect(room).toContain("landed=room");
    expect(room).not.toContain("POSTED TO THE ROOM ITSELF");
    const threaded = await resultOf("no handles", [], "44444444-4444-4444-4444-444444444444");
    expect(threaded).toContain("landed=thread");
    expect(threaded).not.toContain("NOBODY IS TAGGED IN THIS POST");
    // ⚠ …and neither rule may simply vanish from the product. The sparseness bar
    // is keyed on the agent's OWN run, which is checkable by the agent and not by
    // the server, so it reads identically in the doctrine — and there once.
    expect(CHANNEL_DOCTRINE).toContain(
      "IF YOU HAVE ALREADY POSTED TO THIS CHANNEL IN THIS RUN, THE NEXT ONE NEEDS A REASON A HUMAN WOULD NAME OUT LOUD",
    );
    expect(CHANNEL_DOCTRINE).toContain("WHEN IT IS WORTH IT");
  });

  it("a body with no `@` at all reports both fields as absent", async () => {
    const out = await resultOf("just a report", [], "44444444-4444-4444-4444-444444444444");
    expect(out).toContain("tags=- wake=-");
  });
});
