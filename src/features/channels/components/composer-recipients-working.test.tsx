// @vitest-environment jsdom
/**
 * 🔴 **THE WORKING PILLS MUST NOT RIDE ON THE DRAFT'S ADDRESS** (Samuel, #3166,
 * 2026-10-11: the typing pills and the recipient arrow disappeared out of a live
 * room together, mid-session, with no commit in between).
 *
 * ⚠ **THEY VANISHED TOGETHER BECAUSE THEY WERE ONE ELEMENT, AND THAT IS WHAT THIS
 * FILE PINS.** `62d34326` deleted the `→ nobody` face by returning NO ELEMENT —
 * per the 2026-09-20 *"if there is no addressee just have it be nothing"* — and in
 * the same diff added the working strip as a CHILD of that element. So a ruling
 * about the ARROW was enforced on the whole row, and the pills became conditional
 * on a fact they have nothing to do with. The two are different feeds:
 * `channel-surface.tsx` builds the strip from `agentSessions` (my own agents
 * mid-turn, off the desktop bridge) and the recipients from `liveAgents`.
 *
 * ⚠ **AND THE TRIGGER WAS NOT A CODE CHANGE, WHICH IS WHY NO BISECT WOULD HAVE
 * FOUND IT.** `lib/agent-mentions-responder.ts › resolveDefaultResponder` answers
 * "nobody" on purpose (F-705, *never a guess that wanders*) once SEVERAL agents are
 * live and none of them is the one this user addressed last. One live agent takes
 * the `only agent` arm and the line renders. So a room that was fine all evening
 * went blank the moment the second agent launched — the latent coupling, exposed by
 * a count, which the second case below pins directly.
 *
 * ⚠ **SAMUEL'S FIX IS A FACE, NOT A BRANCH** (#3166): the line renders at EVERY
 * state, saying `→ @nobody` when it reaches nobody, and the pills always show. That
 * REVERSES 2026-09-20 by name, and it is the stronger shape — an unconditional row
 * cannot take a child down with it, so the whole class of bug goes rather than this
 * one instance of it. F-705 itself is untouched.
 *
 * ⚠ **THE SUITE THAT SHOULD HAVE CAUGHT THIS NEVER NAMED `working`** —
 * `composer-recipients.test.tsx` had no occurrence of the prop, so every assertion
 * there was about a row that happened to be addressed. This file is the missing
 * half, and it is separate because that one sits AT the 500-line cap (INVARIANTS
 * §1: an at-cap file cannot absorb a line, comment or otherwise).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ComposerRecipients, REACH_NOBODY_LABEL } from "./composer-recipients";
import { draftReach, type LiveAgentSession } from "../lib/draft-recipients";
import { member, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

/** Two live agents, so `resolveDefaultResponder` is past its `only agent` arm. */
const AGENT_A: LiveAgentSession = { name: "k3v7d2mq", displayName: "Research Bot" };
const AGENT_B: LiveAgentSession = { name: "z9q1w4er", displayName: "Composer Fix" };

/** ⚠ THE VIEWER'S OWN ROW CARRIES THE DEFAULT (`last_addressed`), so `@nobody`
 *  here is the LAST arm answering nobody — never the `"none"` short-circuit. */
const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang", email: "sam@example.com" }),
  member({
    userId: PEER,
    displayName: "Diana Taylor",
    email: "diana@example.com",
    unaddressedResponder: null,
  }),
];

/** The strip as `agent-activity.tsx` hands it over: an opaque node, which is the
 *  whole contract (`working?: ReactNode` — the line never reads a session feed).
 *  ⚠ ITS TEXT NAMES NO AGENT, so the "F-705 guessed nobody" assertions below cannot
 *  pass or fail on the strip's own content. */
const STRIP = <span data-testid="working-strip">2 working</span>;

const strip = () => screen.queryByTestId("working-strip");
const row = () => screen.queryByLabelText("Recipients");
const rowText = () => row()?.textContent ?? "";

describe("🔒 #3166 — the working strip survives an unaddressed draft", () => {
  it("several agents live and none addressed lately: `@nobody`, and pills STILL there", () => {
    // The exact state Samuel's room was in: the swarm had launched, and the agents
    // were addressed by the ORCHESTRATOR rather than by him, so his own
    // `recentAgentIds` names none of them.
    render(
      <ComposerRecipients
        body="what broke"
        members={MEMBERS}
        sessions={[AGENT_A, AGENT_B]}
        currentUserId={ME}
        recentAgentIds={[]}
        working={STRIP}
      />
    );

    // The line renders and NAMES the empty state (#3166).
    expect(rowText()).toContain(REACH_NOBODY_LABEL);
    // ⚠ F-705 IS UNTOUCHED: neither live agent is guessed at.
    expect(rowText()).not.toContain("Research Bot");
    expect(rowText()).not.toContain("Composer Fix");
    // 🔴 THE REGRESSION ITSELF. Before the fix this was `null` — the pills sat
    // inside the element the early return deleted.
    expect(strip()).not.toBeNull();
  });

  it("the data really does reach that state — the reach is empty, not merely unrendered", () => {
    // Proves the case above exercises the F-705 arm rather than a typo in the body:
    // the RULE itself returns nobody for this input, which is what emptied the row.
    expect(
      draftReach({
        body: "what broke",
        members: MEMBERS,
        sessions: [AGENT_A, AGENT_B],
        currentUserId: ME,
        unaddressedResponder: "last_addressed",
        recentAgentIds: [],
        threadOtherParty: null,
      }).recipients
    ).toEqual([]);

    // ⚠ AND ONE LIVE AGENT TAKES THE `only agent` ARM — why the room was fine until
    // the second agent launched. The count is the whole difference, and this pair is
    // the regression's actual trigger expressed as data.
    expect(
      draftReach({
        body: "what broke",
        members: MEMBERS,
        sessions: [AGENT_A],
        currentUserId: ME,
        unaddressedResponder: "last_addressed",
        recentAgentIds: [],
        threadOtherParty: null,
      }).recipients
    ).toHaveLength(1);
  });

  it("the line renders with no pills at all, rather than disappearing", () => {
    // Samuel's reversal of 2026-09-20: an empty reach is a FACE, not an absence, so
    // the row survives even when there is nothing working beside it.
    const { container } = render(
      <ComposerRecipients
        body="what broke"
        members={MEMBERS}
        sessions={[AGENT_A, AGENT_B]}
        currentUserId={ME}
        recentAgentIds={[]}
      />
    );
    expect(container.firstChild).not.toBeNull();
    expect(rowText()).toContain(REACH_NOBODY_LABEL);
    expect(strip()).toBeNull();
  });

  it("Escape drops the ADDRESS and keeps the pills", () => {
    // `cancelled` is about the addressee the author just refused. An agent does not
    // stop working because they pressed Escape — and the row says `@nobody`, which
    // is the visible confirmation that the key did something.
    render(
      <ComposerRecipients
        body="what broke"
        members={MEMBERS}
        sessions={[AGENT_A]}
        currentUserId={ME}
        recentAgentIds={[AGENT_A.name]}
        cancelled
        working={STRIP}
      />
    );
    expect(rowText()).toContain(REACH_NOBODY_LABEL);
    // The `esc to cancel` badge goes with the address it described.
    expect(rowText()).not.toContain("esc to cancel");
    expect(strip()).not.toBeNull();
  });

  it("an addressed draft still draws the arrow, the name and the strip together", () => {
    // The unchanged case, asserted here because the fix moved the arrow's branch:
    // the row still reads as ONE line, strip last, no `ml-auto` (Samuel's
    // left-aligned correction).
    render(
      <ComposerRecipients
        body="what broke"
        members={MEMBERS}
        sessions={[AGENT_A, AGENT_B]}
        currentUserId={ME}
        recentAgentIds={[AGENT_A.name]}
        working={STRIP}
      />
    );
    expect(rowText()).toContain("→");
    // ⚠ THE HANDLE, NOT THE FRIENDLY NAME — the line's own teaching half
    // (`composer-recipients.tsx`: the handle is what the resolver accepts).
    expect(rowText()).toContain("@research-bot");
    expect(rowText()).not.toContain(REACH_NOBODY_LABEL);
    // The strip is the LAST item in the SAME row, not a second band.
    expect(row()?.contains(strip())).toBe(true);
  });

  it("the pills are present at every reach state — one element, never two shapes", () => {
    // The invariant behind the fix, stated as itself: whatever the address does, the
    // strip is there. A future branch that re-couples them fails here first.
    for (const sessions of [[], [AGENT_A], [AGENT_A, AGENT_B]]) {
      render(
        <ComposerRecipients
          body="what broke"
          members={MEMBERS}
          sessions={sessions}
          currentUserId={ME}
          recentAgentIds={[]}
          working={STRIP}
        />
      );
      expect(strip(), `${sessions.length} live agents`).not.toBeNull();
      cleanup();
    }
  });
});
