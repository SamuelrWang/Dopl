/**
 * 🔒 **THE UNNAMED FACE, AND THE ONE PLACE AN ID IS STILL SHOWN TO A PERSON**
 * (Samuel, 2026-09-15).
 *
 * Verbatim: *"right now, the agent IDs we have, I want to make it so that the user really doesnt
 * see it … if a user launches an agent with no name, just give it the name, New Agent"* and
 * *"the only time the agent id should be used in a sent message, is only if there is actually two
 * agents with the exact same name that are active."*
 *
 * ⚠ **THE SECOND SENTENCE WAS SUPERSEDED LATER THE SAME DAY, AND THAT IS WHY THIS FILE HAS NO
 * DISCRIMINATOR CASES.** It briefly licensed a muted `#<id>` on own-agent cards where two
 * ADDRESSABLE agents wore one face. Samuel then removed the CASE rather than the display: *"no
 * two agents that are addressable can have the same name … it will automatically auto-resolve to
 * coder-1 … coder-2 and so on and so forth"* — so a second `New Agent` is STORED as
 * `New Agent-1` (`dopl-desktop-app/main/agent-name-unique.js`) and there is nothing to tie-break.
 * ⚠ **ENDED AGENTS MAY SHARE A NAME AND ARE SHOWN UNSUFFIXED** (*"If an agent is ended, they
 * can't be addressed anyway, so it won't matter"*), which is the last case below.
 *
 * `agent-id-visibility.test.ts` is the SOURCE sweep that keeps the id off every surface; this is
 * the behavioural half of the face it leaves in its place.
 */

import { describe, expect, it } from "vitest";
import { NEW_AGENT_NAME, agentFaceName } from "@/shared/lib/agent-name";
import { agentDisplayName } from "./agents-model-identity";

const A = "k3v7d2mq";
const B = "m8q1zzzz";

describe("the unnamed face", () => {
  it("is `New Agent`, never the id", () => {
    // ⚠ **IT WAS `#<id>` FROM 2026-08-31 TO 2026-09-15**, defended by INVARIANTS §11 as "a NAME
    // the operator was shown at launch and accepted" — true only while the dialog PREFILLED it,
    // which is the thing Samuel asked to stop in the same breath.
    expect(agentDisplayName({ agentId: A })).toBe(NEW_AGENT_NAME);
    expect(agentDisplayName({ agentId: A, displayName: null })).toBe("New Agent");
    expect(agentDisplayName({ agentId: A })).not.toContain(A);
  });

  it("prefers the operator's own name, and reads whitespace as absent", () => {
    expect(agentDisplayName({ agentId: A, displayName: "Bug Reviewer" })).toBe("Bug Reviewer");
    // ⚠ A NAME OF `"   "` IS ONE NOBODY TYPED ON PURPOSE and renders as a blank line, which is
    // strictly worse than the word (§11: UNKNOWN is not EMPTY, and an empty label is not a fact).
    expect(agentDisplayName({ agentId: A, displayName: "   " })).toBe(NEW_AGENT_NAME);
    expect(agentFaceName("  ")).toBe(NEW_AGENT_NAME);
  });

  it("still prefers a LEGACY pool handle when no id was reported at all", () => {
    // ⚠ A MAIN OLDER THAN 2026-08-21 EMITS `flint` AND NO `agentId`, and `flint` is a label its
    // operator actually read on a pill — not an id. ⚠ **WHERE AN ID IS REPORTED, `name` IS THAT
    // ID** (`main/session-summary.js › nameOf`), so it must never be shown: that is exactly the
    // leak `home/server/overview-tally.ts › mapAgents` had.
    expect(agentDisplayName({ name: "flint" })).toBe("flint");
    expect(agentDisplayName({ agentId: A, name: A })).toBe(NEW_AGENT_NAME);
  });
});

describe("two agents that legitimately share a face", () => {
  it("🔒 are BOTH shown by name, with no id anywhere — ENDED agents may duplicate", () => {
    // ⚠ **THE ONLY WAY TWO CARDS READ THE SAME NOW IS IF ONE OF THEM HAS ENDED.** Samuel: *"If an
    // agent is ended, they can't be addressed anyway, so it won't matter. They can have duplicate
    // names."* There is nothing to choose between, so nothing is disambiguated — and a `#<id>` on
    // a finished run is the leak this whole wave removed.
    const live = { agentId: A, displayName: "Coder", state: "idle" as const };
    const dead = { agentId: B, displayName: "Coder", state: "ended" as const };
    expect(agentDisplayName(live)).toBe("Coder");
    expect(agentDisplayName(dead)).toBe("Coder");
    expect(agentDisplayName(dead)).not.toContain(B);
  });

  it("🔒 and an ADDRESSABLE pair reads two DIFFERENT names, because the store made them so", () => {
    // ⚠ **THIS IS A CLAIM ABOUT THE COMMIT PATH, ASSERTED HERE ONLY AS THE FACE IT PRODUCES.**
    // The rule itself is `dopl-desktop-app/main/agent-name-unique.js` and is driven by
    // `dopl-desktop-app/test/agent-name-unique.test.mjs`; what this pins is that the resolution
    // this module does is a plain one — it never re-derives a suffix and never invents one.
    expect(agentDisplayName({ agentId: A, displayName: "Coder" })).toBe("Coder");
    expect(agentDisplayName({ agentId: B, displayName: "Coder-1" })).toBe("Coder-1");
  });
});
