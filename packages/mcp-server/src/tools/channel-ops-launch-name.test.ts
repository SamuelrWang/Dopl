/**
 * 🔒 **AN AGENT THAT LAUNCHES AN AGENT MUST NAME IT** — the two refusals
 * (`channel-ops-launch-name.ts`; Samuel, 2026-09-15).
 *
 * Verbatim: *"if agents are spinning up agents, they should be the ones that are naming the
 * agent. Shouldn't be a nameless agent. And certainly shouldn't be an agent with the id as the
 * name."*
 *
 * ⚠ **BOTH HALVES ARE PINNED, AND THE SECOND IS THE ONE THAT WOULD ROT.** "A nameless launch is
 * refused" is the headline and nothing will quietly undo it — the field is required at the schema
 * too. "An id is not a name" has no second fence anywhere, it is reachable by ACCIDENT rather
 * than by perversity (`read_sessions` prints `@agent-<id>`, so a caller copying the neighbouring
 * op's output files an id as a name), and it undoes the whole ruling one launch at a time.
 *
 * ⚠ **THE MESSAGES ARE ASSERTED, NOT ONLY THE REFUSAL.** A refusal an orchestrator cannot act on
 * is a retry loop — which is precisely what `channel-session-handle.ts` records the last
 * unactionable error on this lane costing.
 */

import { describe, expect, it } from "vitest";
import { isNameRefusal, launchName } from "./channel-ops-launch-name";

const text = (answer: ReturnType<typeof launchName>): string =>
  isNameRefusal(answer) ? (answer.content[0].text as string) : "";

describe("launchName — a launch must be named", () => {
  it("takes an ordinary name, trimmed", () => {
    const answer = launchName("  Bug reviewer  ");
    expect(isNameRefusal(answer)).toBe(false);
    // ⚠ THE TRIMMED VALUE IS WHAT COMES BACK, so the op files the string that was measured.
    expect(isNameRefusal(answer) ? null : answer.name).toBe("Bug reviewer");
  });

  it("refuses nothing at all, and says what to pass", () => {
    for (const blank of [undefined, "", "   "]) {
      const answer = launchName(blank);
      expect(isNameRefusal(answer), JSON.stringify(blank)).toBe(true);
      expect(text(answer)).toContain("missing required param: name");
      // ⚠ THE SHAPE AND AN EXAMPLE, because "name is required" is a fact the caller already had.
      expect(text(answer)).toContain("1-60 characters on one line");
      expect(text(answer)).toContain("@bug-reviewer");
    }
  });

  it("🔒 refuses an AGENT ID as a name, in every spelling a caller could paste", () => {
    // ⚠ `read_sessions` PRINTS `@agent-<id>`, so these are the shapes that get copied.
    for (const pasted of ["x2sz1ztt", "agent-x2sz1ztt", "@agent-x2sz1ztt", "@x2sz1ztt"]) {
      const answer = launchName(pasted);
      expect(isNameRefusal(answer), pasted).toBe(true);
      expect(text(answer)).toContain("is an agent id, not a name");
      // ⚠ AND IT SAYS WHY THE ID IS THE WRONG THING TO REACH FOR, which is the ruling itself.
      expect(text(answer)).toContain("never shown to a person");
    }
  });

  it("🔒 does NOT refuse an eight-letter WORD — the naïve test did, and that is why it changed", () => {
    // ⚠ **`isAgentId(bareAgentId(name))` REFUSED `reviewer`**, because `AGENT_ID_RE` is
    // `^[a-z][a-z0-9]{7}$` and so is every eight-letter lower-case word. A caller doing exactly
    // what the copy asked was told its name was an id — **a refusal nobody can explain is worse
    // than the leak it prevents.** `looksLikeAgentId` separates the pasted forms (refused
    // outright) from a bare eight characters (refused only when it carries a DIGIT).
    for (const fine of ["reviewer", "deployer", "auditors", "verifier", "Scout", "Agent Smith"]) {
      expect(isNameRefusal(launchName(fine)), fine).toBe(false);
    }
    // ⚠ AND NEAR-MISSES ON THE LENGTH ARE NAMES TOO — the grammar is exact-length.
    for (const fine of ["x2sz1zt", "x2sz1zttt"]) {
      expect(isNameRefusal(launchName(fine)), fine).toBe(false);
    }
  });

  it("names the accepted trade out loud: a DIGIT-FREE id pasted BARE gets through", () => {
    // ⚠ **THIS PINS A KNOWN HOLE ON PURPOSE.** An id is random over `[a-z0-9]`, so roughly one in
    // eleven carries no digit and is indistinguishable from a word here. It arrives as a stored
    // name, renders on a card as gibberish, and the operator renames it — visible and
    // recoverable. The alternative refuses `reviewer` forever, which is neither. ⚠ If this case
    // ever needs to change, the fix is NOT a wider regex: it is the caller passing the id in a
    // field that is an id.
    expect(isNameRefusal(launchName("qwertyui"))).toBe(false);
    // …while the SAME string pasted as an address is still refused, which is the case that
    // actually happens.
    expect(isNameRefusal(launchName("@agent-qwertyui"))).toBe(true);
  });
});
