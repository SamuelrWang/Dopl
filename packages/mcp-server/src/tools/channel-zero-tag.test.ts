/**
 * THE ZERO-TAG DIAGNOSTIC — the copy an agent reads when the server resolved its
 * `@…` to nobody.
 *
 * ⚠ WHERE IT LIVES NOW (T10/T12, 2026-09-02). It used to be
 * `channel-post-guidance.ts › tagOutcomeNote`, spliced under EVERY post whose
 * mention count was zero. The five causes did not stop being true — they stopped
 * being worth re-transmitting per write — so they are stated ONCE in
 * `channel-doctrine.ts › TAGGING` and reached with `dopl_channel(op="help")`.
 * What a post result carries instead is the VERDICT, `tags=<resolved>/<attempted>`.
 * Every case below therefore has TWO halves and needs both: the rule is still
 * SHIPPED (asserted against the doctrine) and the paragraph is no longer in the
 * RESULT (asserted as an absence on the fact line).
 *
 * ⚠ IT IS STILL THE SILENT-FAILURE LINE, which is why its wording is pinned at
 * all. A misspelled handle POSTS FINE, reaches nobody's Tags inbox, and without
 * the verdict the agent believes it escalated (INVARIANTS §10). Whether a tag
 * really resolved is the server's (`lib/mentions.ts`,
 * `server/service-writes-metadata-mentions.ts`).
 *
 * §2 SPLIT out of `channel-post-guidance.test.ts` on 2026-08-24, at the 500-line
 * cap (it measured 494). The seam is SUBJECT, not arithmetic: that file drives
 * `opPost` / `opCreateThread` through stub clients and asserts what a WRITE
 * leaves in an agent's context; this one asserts the COPY of the standing text
 * plus the pure fact builders, and drives no client.
 *
 * HISTORY WORTH KEEPING, because the cause list has been wrong in both
 * directions:
 *  - 2026-08-22, a cause REMOVED. The copy told agents they might have tagged
 *    themselves. An agent's tag at its own operator is KEPT now, so that line
 *    talked agents out of the one escalation that works.
 *  - 2026-08-24, a cause ADDED. See the agent-id case at the bottom.
 */

import { describe, it, expect } from "vitest";
import type { ChannelMessage } from "@dopl/client";
import { CHANNEL_DOCTRINE } from "./channel-doctrine";
import { postMentionFacts } from "./channel-post-guidance";

/**
 * THE CAUSE LIST, SLICED OUT OF THE DOCTRINE BY ITS OWN HEADINGS.
 *
 * ⚠ SCOPED, AND THE SCOPE IS THE POINT. Several cases below are ABSENCE claims
 * ("this list must not tell an agent it tagged itself"), and the doctrine is
 * ~20k characters of other rules — one of which, three sentences later, says
 * tagging your own operator is usually right. Asserted over the whole text they
 * would either pass vacuously or fail on the sentence they exist to protect.
 */
function causes(): string {
  const start = CHANNEL_DOCTRINE.indexOf("WHY A TAG RESOLVES TO NOBODY");
  // ⚠ THE CLOSING HEADING MOVED (B8). The list used to be followed by a
  // `WHEN IT IS WORTH IT` section, which the collapse deleted as encouragement
  // — the doctrine carries contracts now. The receiving-side paragraph is what
  // follows the list, so it is the new fence, and the scope this function exists
  // to give is unchanged: the cause list and nothing either side of it.
  const end = CHANNEL_DOCTRINE.indexOf("WHAT HAPPENS ON THE RECEIVING SIDE");
  // ⚠ Guarded rather than assumed: a slice off two `indexOf(-1)` is the empty
  // string, and every `not.toContain` below would then pass over nothing.
  expect(start, "the cause list's heading moved or was renamed").toBeGreaterThan(-1);
  expect(end, "the receiving-side paragraph moved or was renamed").toBeGreaterThan(start);
  return CHANNEL_DOCTRINE.slice(start, end);
}

/** A stored message carrying the server's own stamped resolution. */
const stored = (mentionedUserIds: string[] = []): ChannelMessage =>
  ({ id: "m1", seq: 9, kind: "message", metadata: { mentionedUserIds } }) as unknown as ChannelMessage;

/** The `tags=` token a post over `body` would carry, given that stamp. */
const verdict = (body: string, resolved: string[] = []) =>
  postMentionFacts(body, stored(resolved)).tags;

describe("the zero-tag line names the causes it actually has", () => {
  it("leads with CODE — the cause an agent hits without noticing", () => {
    expect(causes()).toContain("THE HANDLE WAS IN CODE");
    // ⚠ RE-POINTED: "working as intended" was the reassurance; the compressed
    // list states the MECHANISM instead, which carries the same claim — a
    // code-span handle is quoted text, so tagging nobody is the correct outcome
    // and not a failure to repair.
    expect(causes()).toContain("quoted text and tags nobody");
  });

  it("still names spelling, and now names the two the roster explains", () => {
    // ⚠ RE-POINTED AT THE COMPRESSED LIST'S OWN WORDING (B8). Each cause is one
    // clause now rather than a capitalised heading, and the remedy names the
    // ROSTER rather than the op that reads it — `op="members"` is
    // `op="rooms" action="members"`, and the doctrine stopped spelling the call.
    // All four claims are unchanged.
    expect(causes()).toContain("the spelling missed");
    expect(causes()).toContain("EXACT and never a prefix");
    expect(causes()).toContain("they are not a member of THIS channel");
    expect(causes()).toContain("two members answer to it");
    expect(causes()).toContain("check the roster");
  });

  it("does NOT tell an agent it may have tagged itself", () => {
    // ⚠ An agent's tag at its OWN operator is now KEPT (the escalation path,
    // `server/service-writes-metadata-mentions.ts`). Naming it as a cause here
    // would talk the agent out of the one thing that works.
    expect(causes().toLowerCase()).not.toContain("yourself");
    expect(causes().toLowerCase()).not.toContain("your own");
  });

  it("closes on the REMEDY, and asserts no failure it cannot prove", () => {
    // ⚠ **PIN RETIRED: the old-server caveat is deleted BY RULING**, not by
    // drift — wave B §4 (`docs/specs/mcp-v2-wave-b.md:280`) deletes the prose
    // that hedged the list, and the doctrine carries contracts only now. What
    // INVARIANTS §13 actually forbids is UNCHANGED and is asserted here in its
    // load-bearing direction: no clause in this list claims a delivery failure,
    // because none of the five can be told apart from a server that stamps
    // nothing. The list ends on the roster remedy, which is what a cause
    // appended after it would be read past.
    expect(causes()).not.toContain("looks identical from here");
    expect(causes()).not.toMatch(/was not delivered|delivery failed|never arrived/i);
    expect(causes().indexOf("check the roster")).toBeGreaterThan(
      causes().indexOf("THE HANDLE WAS IN CODE"),
    );
  });
});

/**
 * CAUSE (5) — "YOU TAGGED AN AGENT ID" (2026-08-24).
 *
 * ⚠ ADDED BECAUSE BOTH SIDES OF A LIVE TWO-AGENT TEST HIT IT INDEPENDENTLY, on
 * v1.19.0. Mentions resolve against the channel's HUMAN roster, so an agent id
 * matches nothing and never can — while `@agent-<id>` in a body is a real,
 * working, DIFFERENT mechanism: the WAKE the `launch_agent` bullet teaches. The
 * four-cause copy therefore reported the agent's correct action as a probable
 * spelling mistake and sent it to `op="members"` to check a name that could not
 * be on that list. That is the worst shape a diagnostic can take: it is not
 * merely unhelpful, it actively proposes the wrong repair.
 *
 * ⚠ T12 CLOSED THE SAME DEFECT A SECOND WAY, and the two halves are independent.
 * The cause survives here as PROSE; the RESULT no longer counts an agent handle
 * in `tags=` at all, so the mis-narration cannot even be rendered — see the last
 * case in this block.
 */
describe("cause (5): an agent id is a WAKE, and can never be a tag", () => {
  it("names the cause, and names it as a NON-tag rather than a bad tag", () => {
    expect(causes()).toContain("YOU TAGGED AN AGENT ID");
    // ⚠ Both halves are load-bearing. Without the first, the agent reads a
    // working wake as broken; without the second, it reads "tag them properly"
    // and goes looking for a spelling that does not exist. ⚠ The first is now
    // spelled "tags resolve against the HUMAN roster" (it was "the human roster
    // only"); same claim, and the emphasis moved onto the word that carries it.
    expect(causes()).toContain("HUMAN roster");
    // ⚠ RE-POINTED: "not a failure" was the reassurance and the compressed list
    // states the mechanism — an agent id is resolved against the HUMAN roster,
    // so it stamps nobody. Same second half, and it is still what stops the
    // reader hunting for a spelling that does not exist.
    expect(causes()).toContain("stamps nobody");
  });

  it("keeps the wake CORRECT — it must not read as a thing to stop doing", () => {
    // ⚠ THIS COPY WAS BRIEFLY WRONG IN BOTH DIRECTIONS AND THE HISTORY IS WORTH
    // KEEPING. It said `@<agentid>` "is a WAKE for that agent's machine" — true
    // of a HUMAN writing it, and false of an AGENT, which is the only thing that
    // reads a tool result, because the 2026-08-28 loop fence refused every
    // agent-authored message. Samuel's SAME-ACCOUNT CARVE (2026-08-31) made the
    // original sentence true again rather than requiring it to be softened, and
    // the prefixed form is now what the copy names. This case is what stops
    // either direction being "corrected" back.
    expect(causes()).toContain("lands in no Tags inbox");
    // ⚠ RE-POINTED ONE SECTION OVER: the compressed cause list states what an
    // agent id does NOT do; that `@agent-<id>` IS a working wake is stated in
    // the LAW, which is where the exception lives. Both halves are still pinned,
    // which is the whole point of this case — neither direction may be
    // "corrected" back.
    expect(CHANNEL_DOCTRINE).toContain("`@agent-<id>` in a body wakes THAT agent");
    expect(CHANNEL_DOCTRINE).toContain("YOUR OWN AGENTS ARE THE ONE EXCEPTION");
    // ⚠ WHICH agent it wakes is stated in the doctrine's OWN AGENTS section
    // rather than inside the cause list — the half that used to ride here as
    // "a WAKE for that agent". Pinned so the claim cannot vanish from BOTH.
    expect(CHANNEL_DOCTRINE).toContain("wakes THAT agent");
  });

  it("sends this cause to NO roster remedy — that is the wrong turn it fixes", () => {
    // ⚠ The remedy sentence enumerates (2), (3) and (4) by number precisely so
    // adding a cause cannot silently widen it. An agent id is not on the member
    // list, so "check op=members and re-post" is the advice that wasted both
    // test agents' turns. (The call is spelled `op="members"` rather than
    // `dopl_channel(op="members"` now that the text is read as one document.)
    expect(causes()).toContain("For (2), (3) and (4), check the roster");
    expect(causes()).not.toContain("For (2), (3), (4) and (5)");
  });

  it("counts itself honestly — the header says FIVE and there are five", () => {
    // ⚠ A cause list whose header disagrees with its body is how a sixth cause
    // gets appended and read as noise. Derived from the copy, not asserted as a
    // literal, so the numbering and the count cannot drift apart.
    expect(causes()).toContain("FIVE CAUSES");
    // ⚠ SCOPED TO THE LIST, AND CASE-INSENSITIVE (B8). The compressed causes
    // (2)-(4) open lowercase where (1) and (5) keep their headings, and the
    // REMEDY sentence re-cites "(2), (3) and (4)" — counted over the whole slice
    // that sentence would double three of them. Cutting at the remedy is what
    // keeps this an honest count of the BODY against the header.
    const list = causes().split("For (2)")[0];
    const numbered = [...list.matchAll(/\((\d)\) [A-Za-z]/g)].map((m) => m[1]);
    expect(numbered).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("stays before the roster remedy, which is still LAST", () => {
    // ⚠ RE-POINTED WITH THE CAVEAT'S RETIREMENT (wave B §4): the sentence this
    // cause had to precede is now the roster REMEDY rather than the deleted
    // old-server hedge. The claim is the same one and is the reason the ordering
    // is pinned at all — a cause added after the closing sentence is read past
    // it, and this cause in particular must not fall inside a remedy that
    // deliberately excludes it.
    expect(causes().indexOf("YOU TAGGED AN AGENT ID")).toBeLessThan(
      causes().indexOf("For (2), (3) and (4), check the roster"),
    );
  });

  it("⚠ AN AGENT HANDLE IS NOT COUNTED IN THE VERDICT AT ALL", () => {
    // ⚠ THE STRUCTURAL HALF OF THE 2026-08-31 FIX, and it is stronger than the
    // prose one. `tagFact` is over MEMBER handles only, so an agent-only body
    // reports NO fraction — a `0/1` there would be a stamp nobody was ever going
    // to make, which is the exact number the live orchestrator acted on. The
    // token rides `wake=` instead, which states what was WRITTEN, not what
    // arrived.
    const facts = postMentionFacts("@agent-x2sz1ztt carry on", stored());
    expect(facts.tags).toBeUndefined();
    expect(facts.wake).toBe("@agent-x2sz1ztt");
  });

  it("says nothing at all on a post that DID resolve readers", () => {
    // ⚠ RE-EXPRESSED (T12): the two branches used to be different LANES — a
    // report on success, a five-cause paragraph on failure — and a cause list
    // under a working call read as a warning about it. There is ONE lane now and
    // the shape is identical either way, so what this pins is that the verdict
    // is the WHOLE of what a resolved tag earns: a fraction, and no diagnosis.
    // (What a POST's line then carries is asserted op-level, in
    // `channel-mention-report.test.ts`; the renderer itself has its own suite.)
    expect(postMentionFacts("@a @b hi", stored(["u-1", "u-2"]))).toEqual({
      tags: "2/2",
      wake: undefined,
    });
    expect(verdict("@dia can you look")).toBe("0/1");
  });
});
