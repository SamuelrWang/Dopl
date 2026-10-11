// @vitest-environment jsdom
/**
 * 🔴 **THE WORKING PILLS MUST NOT RIDE ON THE DRAFT'S ADDRESS** (Samuel, #3166,
 * 2026-10-11: the typing pills and the recipient arrow disappeared out of a live
 * room together, mid-session, with no commit in between).
 *
 * ⚠ **THEY VANISHED TOGETHER BECAUSE THEY WERE ONE ELEMENT, AND THAT IS THE ONLY
 * THING THIS FILE IS ABOUT.** `62d34326` deleted the `→ nobody` face by returning
 * NO ELEMENT — right, per *"if there is no addressee just have it be nothing"* —
 * and in the same diff added the working strip as a CHILD of that element. So the
 * ruling about the ARROW was enforced on the whole row, and the pills became
 * conditional on a fact they have nothing to do with. The two are different feeds:
 * `channel-surface.tsx` builds the strip from `agentSessions` (my own agents
 * mid-turn, off the desktop bridge) and the recipients from `liveAgents`.
 *
 * ⚠ **AND THE TRIGGER WAS NOT A CODE CHANGE, WHICH IS WHY NO BISECT WOULD HAVE
 * FOUND IT.** `lib/agent-mentions-responder.ts › resolveDefaultResponder` answers
 * "nobody" on purpose (F-705, *never a guess that wanders*) once SEVERAL agents are
 * live and none of them is the one this user addressed last. One live agent takes
 * the `only agent` arm and the line renders. So a room that was fine all evening
 * went blank the moment the second agent launched — the latent coupling, exposed by
 * a count. {@link several agents live} pins exactly that.
 *
 * ⚠ **THE SUITE THAT SHOULD HAVE CAUGHT THIS NEVER NAMED `working`** —
 * `composer-recipients.test.tsx` has no occurrence of the prop at all, so every
 * assertion there was about a row that happened to be addressed. This file is the
 * missing half, and it is separate because that one sits AT the 500-line cap
 * (INVARIANTS §1: an at-cap file cannot absorb a line, comment or otherwise).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ComposerRecipients } from "./composer-recipients";
import { draftReach, type LiveAgentSession } from "../lib/draft-recipients";
import { member, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

/** Two live agents, so `resolveDefaultResponder` is past its `only agent` arm. */
const AGENT_A: LiveAgentSession = { name: "k3v7d2mq", displayName: "Research Bot" };
const AGENT_B: LiveAgentSession = { name: "z9q1w4er", displayName: "Composer Fix" };

/** ⚠ THE VIEWER'S OWN ROW CARRIES THE DEFAULT (`last_addressed`), so a blank line
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
 *  whole contract (`working?: ReactNode` — the line never reads a session feed). */
const STRIP = <span data-testid="working-strip">Research Bot…</span>;

const strip = () => screen.queryByTestId("working-strip");
const arrow = () => screen.queryByLabelText("Recipients");

describe("🔒 #3166 — the working strip survives an unaddressed draft", () => {
  it("several agents live and none addressed lately: no arrow, pills STILL there", () => {
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

    // The ruling holds — there is no addressee, so there is no arrow and no name.
    expect(arrow()).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("Research Bot,");
    // 🔴 THE REGRESSION. Before the fix this was `null`: the pills were inside the
    // element the early return deleted.
    expect(strip()).not.toBeNull();
  });

  it("the data really does reach that gate — the reach is empty, not merely unrendered", () => {
    // Proves the test above is exercising the F-705 arm and not a typo in the body:
    // the RULE itself returns nobody for this input, which is what emptied the row.
    const reach = draftReach({
      body: "what broke",
      members: MEMBERS,
      sessions: [AGENT_A, AGENT_B],
      currentUserId: ME,
      unaddressedResponder: "last_addressed",
      recentAgentIds: [],
      threadOtherParty: null,
    });
    expect(reach.recipients).toEqual([]);

    // ⚠ AND ONE LIVE AGENT TAKES THE `only agent` ARM — why the room was fine until
    // the second agent launched. The count is the whole difference.
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

  it("nothing to say at all still draws NO element", () => {
    // The 2026-09-20 ruling, unchanged and load-bearing: the fix must not resurrect
    // an empty row as a ghost of the `→ nobody` face.
    const { container } = render(
      <ComposerRecipients
        body="what broke"
        members={MEMBERS}
        sessions={[AGENT_A, AGENT_B]}
        currentUserId={ME}
        recentAgentIds={[]}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("Escape drops the ADDRESS and keeps the pills", () => {
    // `cancelled` is about the addressee the author just refused. An agent does not
    // stop working because they pressed Escape.
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
    expect(arrow()).toBeNull();
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
    const row = arrow();
    expect(row).not.toBeNull();
    expect(row?.textContent ?? "").toContain("→");
    expect(strip()).not.toBeNull();
    // The strip is the LAST item in the same row, not a second band.
    expect(row?.contains(strip())).toBe(true);
  });

  it("the unaddressed row is not announced as Recipients", () => {
    // A strip of working agents labelled "Recipients" would lie to a screen reader —
    // and it is also what keeps `composer-recipients.test.tsx › noLine()` and
    // `demo-home-chrome.test.tsx` literally true rather than accidentally passing.
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
    expect(screen.queryByLabelText("Recipients")).toBeNull();
    expect(screen.getByLabelText("Agents working")).toBeTruthy();
  });
});
