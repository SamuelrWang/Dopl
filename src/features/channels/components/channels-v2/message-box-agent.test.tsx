// @vitest-environment jsdom
/**
 * **WHO GETS A COLOURED BOX, WHAT COLOUR, AND WHO STAYS WHITE** (Samuel, 2026-09-13;
 * docs/specs/agent-colors.md items 4 and 9).
 *
 * ⚠ **THE PROPERTY THIS SUITE EXISTS FOR IS THE THREE-WAY SPLIT, BECAUSE TWO OF ITS THREE
 * ARMS LOOK IDENTICAL FROM THE DATA.** `authorKind === "agent"` is true for BOTH a channel
 * agent session and a channel-less MCP write ("Desktop agent"), and Samuel ruled them
 * opposite ways in the same breath: *"If it's an agent in Dopl that's sending something, that
 * should be a specific color. … For desktop agents and for messages from users, keep those
 * white and without any box."* The discriminator is the stamped session id and nothing else,
 * so a regression here is a whole population of posts changing face with no type error and no
 * failing render.
 *
 * ⚠ **AND THE FOURTH FACE IS THE ENDED ONE, WHICH IS A BOX WITHOUT A COLOUR.** That is the
 * bank rule made visible (*"once the agent has ended, that color needs to be returned to the
 * color bank"*) and it is exactly the case a boolean `isBoxed` would collapse: a neutral frame
 * and no frame are different claims about the AUTHOR, and `agent-box-rule.ts` returns
 * `{ color: null }` versus `null` to keep them apart.
 *
 * ⚠ **MUTATION-VERIFIED (2026-09-13). Each of these turns a case below red:**
 *   (a) making `agentBoxOf` return a box for an unstamped agent post (dropping the
 *       `agentId === null` arm) — the DESKTOP-AGENT case;
 *   (b) making it return `null` instead of `{ color: null }` when the index has no colour —
 *       the ENDED case, and it is the same mutation the filter's People option is verified
 *       against, from the other side;
 *   (c) dropping `ended ? null` from `view-model.ts › indexAgents` — the RECLAIM case.
 */

import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { agentBoxOf } from "./agent-box-rule";
import { MessageBoxAgent } from "./message-box-agent";
import { indexAgents, indexMembers, type AgentIdentity } from "./view-model";
import type { MessageRow } from "./view-model-rows";

/** ⚠ **EXPLICIT, BECAUSE THIS PROJECT DOES NOT CONFIGURE testing-library's AUTO-CLEANUP.**
 *  Without it every `render` below stays mounted for the rest of the RUN, and the leak crosses FILE
 *  boundaries in the same worker — on 2026-09-13 four unrelated suites (`composer.test.tsx`,
 *  `composer-launch.test.tsx`, `channel-surface.test.tsx`, `new-thread-dialog.test.tsx`) went red on
 *  "there is exactly ONE X on screen" assertions, all four passing in isolation, because of renders
 *  leaked from here. The sibling suites that render already do this (`composer-launch-marker.test.tsx`);
 *  a new one must. */
afterEach(cleanup);

const ME = "11111111-1111-1111-1111-111111111111";
const AGENT = "ab12cd34";

/** A built row, narrowed to the fields the box and the rule read. ⚠ `as MessageRow` rather
 *  than a full fixture: this suite is about the BRANCH, and a whole row would put every
 *  unrelated field of `view-model-rows.ts` into these cases' blast radius. */
function row(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: "m1",
    side: "peer",
    author: { name: "Bug Reviewer" },
    authorLabel: "Bug Reviewer",
    time: "09:41",
    agent: true,
    agentId: AGENT,
    body: "the parser is fixed",
    continuation: false,
    mentionsMe: false,
    routedAgentIds: [],
    ...over,
  } as unknown as MessageRow;
}

const indexWith = (identities: Array<[string, AgentIdentity]>) =>
  indexMembers([], ME, new Map(identities));

describe("agentBoxOf — the three-way split", () => {
  it("boxes a CHANNEL AGENT post in its colour", () => {
    const index = indexWith([[AGENT, { displayName: "Bug Reviewer", description: null, color: "agent-07" }]]);
    expect(agentBoxOf(row(), index)).toEqual({ color: "agent-07" });
  });

  it("leaves a PERSON's post with no box at all", () => {
    const index = indexWith([]);
    expect(agentBoxOf(row({ agent: false, agentId: null }), index)).toBeNull();
  });

  it("leaves a DESKTOP AGENT (unstamped, channel-less MCP) with no box", () => {
    // 🔒 **MUTATION (a).** This is the arm that looks like the boxed arm from `authorKind`
    // alone: `agent: true` with no session id. Samuel's rule puts it on the WHITE side, and an
    // implementation that boxed every `agent` row would pass every other case in this file.
    const index = indexWith([]);
    expect(agentBoxOf(row({ agentId: null }), index)).toBeNull();
  });

  it("boxes an agent the index has never heard of, NEUTRALLY — never as a person", () => {
    // 🔒 **MUTATION (b).** `null` and `{ color: null }` are different answers, and this is the
    // case that separates them. A peer's agent whose projection row has aged out of the poll
    // must keep reading as an AGENT; demoting it to a person's row would also move its posts
    // into the filter's "People" bucket, which is the same bug seen from the filter's side.
    const index = indexWith([]);
    expect(agentBoxOf(row(), index)).toEqual({ color: null });
  });

  it("boxes an ENDED agent NEUTRALLY — its key went back to the bank", () => {
    const index = indexWith([[AGENT, { displayName: "Bug Reviewer", description: null, ended: true, color: null }]]);
    expect(agentBoxOf(row(), index)).toEqual({ color: null });
  });
});

describe("indexAgents — the bank rule, enforced where the projection is read", () => {
  it("keeps a LIVE agent's colour", () => {
    const map = indexAgents([{ agentId: AGENT, state: "working", color: "agent-04" }]);
    expect(map.get(AGENT)?.color).toBe("agent-04");
  });

  it("drops an ENDED agent's colour even when the feed still reports one", () => {
    // 🔒 **MUTATION (c).** The feed is allowed to be wrong here — a desktop mid-teardown, a
    // cached payload — and trusting it would paint a hue another member's agent may already
    // hold. Forcing `null` is the reclaim rule applied at the one place both trees read.
    const map = indexAgents([{ agentId: AGENT, state: "ended", color: "agent-04" }]);
    expect(map.get(AGENT)?.color).toBeNull();
    expect(map.get(AGENT)?.ended).toBe(true);
  });

  it("refuses a colour outside the sixteen, rather than passing it through", () => {
    const map = indexAgents([{ agentId: AGENT, state: "idle", color: "agent-99" }]);
    expect(map.get(AGENT)?.color).toBeNull();
  });

  it("does NOT let a later row with no colour delete an earlier row's", () => {
    // ⚠ **THE ONE THAT MATTERS MOST IN PRACTICE AND IS EASIEST TO LOSE.**
    // `derivations.ts` feeds this PEERS FIRST, OWN LAST on last-write-wins, because the local
    // feed's NAME is fresher — and the local feed carries no colour at all. Without the carry,
    // the operator's OWN agents would be the only uncoloured ones in the room, which reads as
    // "colours are broken" rather than as an ordering bug.
    const map = indexAgents([
      { agentId: AGENT, displayName: "Scout", state: "working", color: "agent-11" },
      { agentId: AGENT, displayName: "Bug Reviewer", state: "working" },
    ]);
    expect(map.get(AGENT)?.color).toBe("agent-11");
    expect(map.get(AGENT)?.displayName).toBe("Bug Reviewer");
  });

  it("still clears the colour when the LATER row is the ended one", () => {
    // ⚠ THE CARRY MUST NOT OUTRANK THE BANK RULE — `ended` is terminal and beats an incumbent.
    const map = indexAgents([
      { agentId: AGENT, state: "working", color: "agent-11" },
      { agentId: AGENT, state: "ended" },
    ]);
    expect(map.get(AGENT)?.color).toBeNull();
  });
});

describe("the box, rendered", () => {
  const renderBox = (color: Parameters<typeof MessageBoxAgent>[0]["color"]) =>
    render(
      <MessageBoxAgent row={row()} color={color} agentName="Bug Reviewer" flash={false}>
        <p>the parser is fixed</p>
      </MessageBoxAgent>
    );

  it("carries the KEY on the DOM, not a resolved colour", () => {
    // ⚠ THE KEY IS THE STABLE HOOK (`attribution-pill.tsx`'s `data-attribution-pill`
    // precedent). Asserting on the key rather than on a computed `oklch()` also keeps this
    // suite from breaking every time the palette is retuned — which the token block invites.
    const { container } = renderBox("agent-07");
    expect(container.querySelector("[data-agent-color='agent-07']")).not.toBeNull();
  });

  it("carries NO colour attribute on the neutral face", () => {
    const { container } = renderBox(null);
    expect(container.querySelector("[data-agent-color]")).toBeNull();
  });

  it("puts the attribution pill and the body inside one frame", () => {
    const { container } = renderBox("agent-07");
    // ⚠ THE PILL IS THE UNCHANGED ONE (Samuel: *"the pill's own recipe, unchanged"*), so it is
    // found by its own stable hook rather than by a class this file could have forked.
    // ⚠ SCOPED TO `container`, NOT `screen` / `document` — the STRONGER assertion either way: it
    // says the pill is INSIDE this frame rather than merely somewhere on the page.
    const frame = container.querySelector("[data-agent-color='agent-07']");
    expect(frame).not.toBeNull();
    expect(frame?.querySelector("[data-attribution-pill]")).not.toBeNull();
    expect(frame?.textContent).toContain("the parser is fixed");
  });

  it("renders one frame PER POST — a run by one agent does not merge", () => {
    // ⚠ Samuel's *"Consecutive posts by the same agent do NOT merge boxes"*. The frame must not
    // consult `continuation`: a merged box would drop the bar for the second post, and the bar
    // is where the time is — so every message after the first would lose its timestamp.
    const { container } = render(
      <>
        <MessageBoxAgent row={row({ id: "m1" })} color="agent-07" agentName="R" flash={false}>
          <p>one</p>
        </MessageBoxAgent>
        <MessageBoxAgent
          row={row({ id: "m2", continuation: true })}
          color="agent-07"
          agentName="R"
          flash={false}
        >
          <p>two</p>
        </MessageBoxAgent>
      </>
    );
    expect(container.querySelectorAll("[data-agent-color='agent-07']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-attribution-pill]")).toHaveLength(2);
  });
});
