/**
 * THE PER-MENTION REPORT — what each `@…` in a posted body actually was
 * (2026-08-31).
 *
 * ── THE DEFECT IT CLOSES ─────────────────────────────────────────────────────
 * `tagOutcomeNote` answers ONE question — how many HUMAN handles the server
 * stamped — and then, on zero, spends a paragraph on five spelling-and-roster
 * causes. That is the right answer for a body whose tokens are all member
 * handles. It is the WRONG answer for the ordinary shape of an orchestration
 * post, which carries both kinds at once ("@samuel please look,
 * @agent-x2sz1ztt carry on"): the count is over the human half, and printed
 * alone it reads as a verdict on the whole body. On 2026-08-31 a live
 * orchestrator read exactly that and concluded its AGENT handle was misspelled.
 *
 * ── THE LINE THIS PACKAGE IS ALLOWED TO DRAW ─────────────────────────────────
 * Three facts fix the shape of every assertion below, and each of them is a
 * limit rather than a feature:
 *   • THE GRAMMAR IS PUBLIC, so the ID FORM is decidable HERE, exactly.
 *   • WHETHER AN AGENT HANDLE REACHED ANYTHING IS NOT DECIDABLE ANYWHERE ON THE
 *     SERVER — the resolver is a desktop, over ids minted on that desktop. So
 *     the report says what a token IS and what the LAW does with it, never that
 *     it arrived.
 *   • WHICH human handle resolved is not decidable either: the server stamps
 *     READER IDS, not the tokens they came from. A partial resolve therefore has
 *     to say "at least one reached nobody, and which is not knowable from here"
 *     — inventing a join by position or by count would name the wrong token.
 */

import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "@dopl/client";
import {
  classifyMentions,
  mentionBreakdownLine,
  postGuidanceLines,
} from "./channel-post-guidance";

const CH = "bb0f57db-bb46-4ce6-af96-83eb8e2dbf28";

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
    // ⚠ Same discipline as `bodyCarriesATag`: the server skips a handle inside a
    // code span, and swallowing it HERE would leave the one line that explains
    // why it reached nobody unwritten. This asks what the AUTHOR wrote.
    expect(kinds("write `@samuel` to tag them")).toEqual(["handle:samuel"]);
  });

  it("answers empty for a body with no tokens", () => {
    expect(classifyMentions("no handles here")).toEqual([]);
    expect(classifyMentions("")).toEqual([]);
  });
});

describe("mentionBreakdownLine — says what it knows and nothing past it", () => {
  it("is absent when the body carried no `@`", () => {
    expect(mentionBreakdownLine([], 0)).toBeNull();
  });

  it("⚠ NAMES AN AGENT HANDLE AS A WAKE, WITH ITS TWO LIMITS", () => {
    // ⚠ The zero COUNT beside it is about the human roster and says nothing
    // about this token — which is exactly what the repro's caller read it as.
    const line = mentionBreakdownLine(classifyMentions("@agent-x2sz1ztt go"), 0)!;
    expect(line).toContain("AGENT HANDLE");
    expect(line).toContain("a WAKE and not a tag");
    // (1) OWN OPERATOR ONLY — the 2026-08-28 fence, which the carve did not move.
    expect(line).toContain("never another member's");
    // (2) NOT OBSERVABLE — the wake is decided on a desktop no server can see.
    expect(line).toContain("THIS SERVER CANNOT CONFIRM IT LANDED");
    expect(line).toContain("rather than assuming it woke");
  });

  it("says an agent handle stamps nobody, so no inbox is involved", () => {
    const line = mentionBreakdownLine(classifyMentions("@k3v7d2mq"), 0)!;
    expect(line).toContain("stamps nobody");
    expect(line).toContain("never land in a Tags inbox");
  });

  it("reports member handles against the server's own COUNT — all landed", () => {
    const line = mentionBreakdownLine(classifyMentions("@samuel @diana"), 2)!;
    expect(line).toContain("MEMBER HANDLES");
    expect(line).toContain("stamped 2 readers");
  });

  it("says NONE resolved when the count is zero", () => {
    const line = mentionBreakdownLine(classifyMentions("@dia"), 0)!;
    expect(line).toContain("NONE of them resolved");
    expect(line).toContain("nobody's Tags inbox has it");
  });

  it("⚠ IS HONEST ABOUT A PARTIAL RESOLVE — it will not guess WHICH", () => {
    // The stamp is a set of reader ids; the tokens are strings. There is no join
    // here, and inventing one by position would name the wrong token as the
    // failure — which is worse than saying nothing, because it is actionable and
    // wrong.
    const line = mentionBreakdownLine(classifyMentions("@samuel @dia"), 1)!;
    expect(line).toContain("stamped only 1 of 2");
    expect(line).toContain("WHICH ONE is not knowable from here");
  });

  it("splits a MIXED body into its two halves — the case that misled the repro", () => {
    const line = mentionBreakdownLine(
      classifyMentions("@samuel please look, @agent-x2sz1ztt carry on"),
      1,
    )!;
    expect(line).toContain("`@agent-x2sz1ztt`");
    expect(line).toContain("`@samuel`");
    expect(line).toContain("AGENT HANDLE");
    expect(line).toContain("MEMBER HANDLE");
    // ⚠ THE TWO HALVES ARE REPORTED SEPARATELY, which is the whole point: the
    // stamped count is over the MEMBER half and says nothing about the agent one.
    // The member half LANDED; a bare count of 1 over two tokens would have read
    // as a half-failure of the whole body.
    expect(line).toContain("it landed");
  });
});

describe("postGuidanceLines — which lines a post result actually gets", () => {
  const lines = (body: string, resolvedIds?: string[], landedThread?: string) =>
    postGuidanceLines({
      channelId: CH,
      landedThread,
      body,
      message: stored(resolvedIds),
    });

  it("⚠ AN AGENT-ONLY BODY GETS NO ROSTER PARAGRAPH", () => {
    // ⚠ THE SECOND HALF OF THE 2026-08-31 FIX. `tagOutcomeNote`'s zero branch is
    // five causes about spelling, membership and ambiguity — printed over a body
    // that named no member at all, it answers a question the caller did not ask,
    // in the voice of a defect, about the one thing they did right.
    const out = lines("@agent-x2sz1ztt read the room", []).join("\n");
    expect(out).toContain("AGENT HANDLE");
    expect(out).not.toContain("YOUR `@` TAG RESOLVED TO NOBODY");
    expect(out).not.toContain("FIVE THINGS DO THIS");
  });

  it("a MEMBER handle that reached nobody still gets the five causes", () => {
    // ⚠ The breakdown says WHICH token is unaccounted for; the note says the
    // five reasons and the remedy. Neither is derivable from the other, so a
    // body with a failed member handle gets both, in that order.
    const out = lines("@dia can you look", []);
    expect(out[0]).toContain("MEMBER HANDLE");
    expect(out[1]).toContain("YOUR `@` TAG RESOLVED TO NOBODY");
  });

  it("a MIXED body gets the breakdown AND the causes", () => {
    const out = lines("@dia and @agent-x2sz1ztt", []).join("\n");
    expect(out).toContain("AGENT HANDLE");
    expect(out).toContain("FIVE THINGS DO THIS");
  });

  it("leaves the standing lines exactly where they were", () => {
    // ⚠ At most ONE standing line, chosen by where the post LANDED — unchanged
    // by this wave, and asserted here so the new lines cannot quietly become a
    // second one.
    const room = lines("@agent-x2sz1ztt go", []).join("\n");
    expect(room).toContain("POSTED TO THE ROOM ITSELF");
    const threaded = lines("no handles", [], "t-1").join("\n");
    expect(threaded).toContain("NOBODY IS TAGGED IN THIS POST");
    // A THREADED post that DID carry a tag gets neither standing line.
    const both = lines("@dia", ["u1"], "t-1");
    expect(both).toHaveLength(2);
    expect(both.join("\n")).not.toContain("NOBODY IS TAGGED IN THIS POST");
  });

  it("a body with no `@` at all is byte-identical to before this wave", () => {
    expect(lines("just a report", [], "t-1")).toEqual([
      expect.stringContaining("NOBODY IS TAGGED IN THIS POST"),
    ]);
  });
});
