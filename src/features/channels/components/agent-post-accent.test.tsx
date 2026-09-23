// @vitest-environment jsdom
/**
 * **WHO WEARS A CHANNEL AGENT'S COLOUR, WHAT COLOUR, AND WHAT THAT COLOUR LOOKS LIKE**
 * (Samuel, 2026-09-13; restyled 2026-09-14; docs/specs/agent-colors.md items 4 and 9).
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
 * ⚠ **AND THE FOURTH FACE IS THE ENDED ONE, WHICH IS AN ACCENT WITHOUT A COLOUR.** That is
 * the bank rule made visible (*"once the agent has ended, that color needs to be returned to
 * the color bank"*) and it is exactly the case a boolean `isBoxed` would collapse: a neutral
 * accent and no accent are different claims about the AUTHOR, and `agent-box-rule.ts` returns
 * `{ color: null }` versus `null` to keep them apart.
 *
 * ── ⚠ THE FACE CHANGED ON 2026-09-14 AND THE PINS BELOW CHANGED WITH IT ────────────────
 *
 * The 2026-09-13 face was a full bordered BOX with a coloured top bar holding the pill
 * (the message-box-agent component, deleted). Samuel: *"instead of it being an entire box, I want to
 * change it to instead be a vertical bar. For messages that are right aligned, this bar
 * should sit to the right, for messages left aligned, bar should be on the left. And move the
 * agent/user identification pill to the right again, And basically, have the colored box,
 * instead of this long box, make it just around the pill, like a bordering, rounded to fit.
 * and it's attached to a vertical bar, that travels the length/amount of lines of the
 * messages from that agent."* The rendered cases therefore pin a BORDER on the pill, a BAR on
 * the OUTER side, and the ABSENCE of the frame — the last one because a leftover wrapper
 * border is invisible to every other assertion in this file.
 *
 * ⚠ **MUTATION-VERIFIED (2026-09-13, re-verified 2026-09-14). Each of these turns a case
 * below red:**
 *   (a) making `agentBoxOf` return a box for an unstamped agent post (dropping the
 *       `agentId === null` arm) — the DESKTOP-AGENT case;
 *   (b) making it return `null` instead of `{ color: null }` when the index has no colour —
 *       the ENDED case, and it is the same mutation the filter's People option is verified
 *       against, from the other side;
 *   (c) dropping `ended ? null` from `view-model.ts › indexAgents` — the RECLAIM case;
 *
 * ⚠ **THE RENDERED FACE LEFT THIS FILE ON 2026-09-16, AT THE 500-LINE CAP (§1):
 * `agent-post-accent-face.test.tsx`.** The seam is the one `agent-pill-open.test.tsx` was cut
 * on — this file pins WHICH posts get an accent and moves when the RULE moves; that one pins
 * what the accent is DRAWN as and moves when the face moves, which it has now done three
 * times in three days. Mutations (d)–(f), all of them about the drawn face, moved with it.
 */

import { afterEach, describe, it, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import { AGENT_ACCENT_NEUTRAL, agentBoxOf, agentPostAccent } from "./agent-box-rule";
import { indexAgents, indexMembers, type AgentRosterEntry } from "./view-model";
import type { MessageRow } from "./view-model-rows";

/** ⚠ **EXPLICIT, BECAUSE THIS PROJECT DOES NOT CONFIGURE testing-library's AUTO-CLEANUP.**
 *  ⚠ KEPT THOUGH THIS HALF NO LONGER RENDERS (2026-09-16): the rule is the FILE's, the face
 *  suite next door depends on it being universal, and a cheap no-op is the wrong thing to
 *  delete. Without it every `render` in a suite stays mounted for the rest of the RUN, and the leak crosses FILE
 *  boundaries in the same worker — on 2026-09-13 four unrelated suites (`composer.test.tsx`,
 *  `composer-launch.test.tsx`, `channel-surface.test.tsx`, `new-thread-dialog.test.tsx`) went red on
 *  "there is exactly ONE X on screen" assertions, all four passing in isolation, because of renders
 *  leaked from here. The sibling suites that render already do this (`composer-launch-marker.test.tsx`);
 *  a new one must. */
afterEach(cleanup);

const ME = "11111111-1111-1111-1111-111111111111";
const AGENT = "ab12cd34";

/** A built row, narrowed to the fields the accent and the rule read. ⚠ `as MessageRow` rather
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

const indexWith = (identities: Array<[string, AgentRosterEntry]>) =>
  indexMembers([], ME, new Map(identities));

describe("agentBoxOf — the three-way split", () => {
  it("gives a CHANNEL AGENT post its colour", () => {
    const index = indexWith([[AGENT, { displayName: "Bug Reviewer", description: null, color: "agent-07" }]]);
    expect(agentBoxOf(row(), index)).toEqual({ color: "agent-07" });
  });

  it("leaves a PERSON's post with no accent at all", () => {
    const index = indexWith([]);
    expect(agentBoxOf(row({ agent: false, agentId: null }), index)).toBeNull();
  });

  it("leaves a DESKTOP AGENT (unstamped, channel-less MCP) with no accent", () => {
    // 🔒 **MUTATION (a).** This is the arm that looks like the accented arm from `authorKind`
    // alone: `agent: true` with no session id. Samuel's rule puts it on the WHITE side, and an
    // implementation that painted every `agent` row would pass every other case in this file.
    const index = indexWith([]);
    expect(agentBoxOf(row({ agentId: null }), index)).toBeNull();
  });

  it("accents an agent the index has never heard of, NEUTRALLY — never as a person", () => {
    // 🔒 **MUTATION (b).** `null` and `{ color: null }` are different answers, and this is the
    // case that separates them. A peer's agent whose projection row has aged out of the poll
    // must keep reading as an AGENT; demoting it to a person's row would also move its posts
    // into the filter's "People" bucket, which is the same bug seen from the filter's side.
    const index = indexWith([]);
    expect(agentBoxOf(row(), index)).toEqual({ color: null });
  });

  it("accents an ENDED agent NEUTRALLY — its key went back to the bank", () => {
    const index = indexWith([[AGENT, { displayName: "Bug Reviewer", description: null, ended: true, color: null }]]);
    expect(agentBoxOf(row(), index)).toEqual({ color: null });
  });
});

describe("agentPostAccent — the key becomes paint in exactly one place", () => {
  it("resolves a key to its token reference, never to a colour value", () => {
    expect(agentPostAccent({ color: "agent-07" })).toEqual({
      key: "agent-07",
      paint: "var(--agent-color-07)",
    });
  });

  it("resolves the neutral face to `--border-strong`, and carries NO key", () => {
    // ⚠ THE KEY IS THE DOM HOOK, so a neutral accent must not invent one: "an agent with no
    // colour" and "an agent wearing grey" are the same state and must be queryable as one.
    expect(agentPostAccent({ color: null })).toEqual({
      key: null,
      paint: AGENT_ACCENT_NEUTRAL,
    });
    expect(AGENT_ACCENT_NEUTRAL).toBe("var(--border-strong)");
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

