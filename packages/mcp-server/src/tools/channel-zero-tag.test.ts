/**
 * THE ZERO-TAG DIAGNOSTIC — the copy an agent reads when the server resolved its
 * `@…` to nobody (`channel-post-guidance.ts › tagOutcomeNote`, count 0).
 *
 * ⚠ IT IS THE SILENT-FAILURE LINE, which is why its wording is pinned at all. A
 * misspelled handle POSTS FINE, reaches nobody's Tags inbox, and without this
 * line the agent believes it escalated. Everything here is a string assertion on
 * one exported builder; whether a tag really resolved is the server's
 * (`lib/mentions.ts`, `server/service-writes-metadata-mentions.ts`).
 *
 * §2 SPLIT out of `channel-post-guidance.test.ts` on 2026-08-24, at the 500-line
 * cap (it measured 494). The seam is SUBJECT, not arithmetic: that file drives
 * `opPost` / `opCreateThread` through stub clients and asserts what a WRITE
 * leaves in an agent's context; this one asserts the COPY of a pure string
 * builder and imports nothing else. A file at the cap does not just stop
 * growing, it stops being correctable — and the fifth cause below is exactly a
 * correction that had to fit.
 *
 * HISTORY WORTH KEEPING, because the cause list has been wrong in both
 * directions:
 *  - 2026-08-22, a cause REMOVED. The copy told agents they might have tagged
 *    themselves. An agent's tag at its own operator is KEPT now, so that line
 *    talked agents out of the one escalation that works.
 *  - 2026-08-24, a cause ADDED. See the agent-id case at the bottom.
 */

import { describe, it, expect } from "vitest";
import { tagOutcomeNote } from "./channel-post-guidance";

describe("the zero-tag line names the causes it actually has", () => {
  const zero = () => tagOutcomeNote("chan-1", 0);

  it("leads with CODE — the cause an agent hits without noticing", () => {
    expect(zero()).toContain("THE HANDLE WAS IN CODE");
    expect(zero()).toContain("working as intended");
  });

  it("still names spelling, and now names the two the roster explains", () => {
    expect(zero()).toContain("SPELLING");
    expect(zero()).toContain("THEY ARE NOT IN THIS CHANNEL");
    expect(zero()).toContain("TWO MEMBERS ANSWER TO IT");
    expect(zero()).toContain('op="members"');
  });

  it("does NOT tell an agent it may have tagged itself", () => {
    // ⚠ An agent's tag at its OWN operator is now KEPT (the escalation path,
    // `server/service-writes-metadata-mentions.ts`). Naming it as a cause here
    // would talk the agent out of the one thing that works.
    expect(zero().toLowerCase()).not.toContain("yourself");
    expect(zero().toLowerCase()).not.toContain("your own");
  });

  it("keeps the old-server caveat, and keeps it LAST", () => {
    // INVARIANTS §13: an old server that stamps nothing is indistinguishable
    // from here, so the line may not assert a delivery failure it cannot prove.
    expect(zero()).toContain("looks identical from here");
    expect(zero().indexOf("looks identical from here")).toBeGreaterThan(
      zero().indexOf("THE HANDLE WAS IN CODE"),
    );
  });
});

/**
 * CAUSE (5) — "YOU TAGGED AN AGENT ID" (2026-08-24).
 *
 * ⚠ ADDED BECAUSE BOTH SIDES OF A LIVE TWO-AGENT TEST HIT IT INDEPENDENTLY, on
 * v1.19.0. Mentions resolve against the channel's HUMAN roster, so an agent id
 * matches nothing and never can — while `@<agentid>` in a body is a real,
 * working, DIFFERENT mechanism: the WAKE the `launch_agent` bullet teaches. The
 * four-cause copy therefore reported the agent's correct action as a probable
 * spelling mistake and sent it to `op="members"` to check a name that could not
 * be on that list. That is the worst shape a diagnostic can take: it is not
 * merely unhelpful, it actively proposes the wrong repair.
 */
describe("cause (5): an agent id is a WAKE, and can never be a tag", () => {
  const zero = () => tagOutcomeNote("chan-1", 0);

  it("names the cause, and names it as a NON-tag rather than a bad tag", () => {
    expect(zero()).toContain("YOU TAGGED AN AGENT ID");
    // ⚠ Both halves are load-bearing. Without the first, the agent reads a
    // working wake as broken; without the second, it reads "tag them properly"
    // and goes looking for a spelling that does not exist.
    expect(zero()).toContain("the human roster only");
    expect(zero()).toContain("That is not a failure");
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
    expect(zero()).toContain("starts no inbox entry");
    expect(zero()).toContain("`@agent-<id>` is a WAKE for that agent");
    expect(zero()).toContain("working as intended");
  });

  it("sends this cause to NO roster remedy — that is the wrong turn it fixes", () => {
    // ⚠ The remedy sentence enumerates (2), (3) and (4) by number precisely so
    // adding a cause cannot silently widen it. An agent id is not on the member
    // list, so "check op=members and re-post" is the advice that wasted both
    // test agents' turns.
    expect(zero()).toContain('For (2), (3) and (4), check dopl_channel(op="members"');
    expect(zero()).not.toContain("For (2), (3), (4) and (5)");
  });

  it("counts itself honestly — the header says FIVE and there are five", () => {
    // ⚠ A cause list whose header disagrees with its body is how a sixth cause
    // gets appended and read as noise. Derived from the copy, not asserted as a
    // literal, so the numbering and the count cannot drift apart.
    expect(zero()).toContain("FIVE THINGS DO THIS");
    const numbered = [...zero().matchAll(/\((\d)\) [A-Z]/g)].map((m) => m[1]);
    expect(numbered).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("stays before the old-server caveat, which is still LAST", () => {
    // The caveat under-promises for the whole list; a cause added after it
    // would be read past the sentence that hedges it.
    expect(zero().indexOf("YOU TAGGED AN AGENT ID")).toBeLessThan(
      zero().indexOf("looks identical from here"),
    );
  });

  it("says nothing at all on a post that DID resolve readers", () => {
    // The two branches are different lanes: a resolved tag gets a REPORT, and
    // a cause list under it would read as a warning about a working call.
    expect(tagOutcomeNote("chan-1", 2)).toContain("TAGGED 2 people");
    expect(tagOutcomeNote("chan-1", 2)).not.toContain("AGENT ID");
  });
});
