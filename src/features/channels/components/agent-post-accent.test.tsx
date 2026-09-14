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
 * messages from that agent."* The rendered cases therefore pin a RING on the pill, a BAR on
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
 *   (d) 2026-09-14 — pinning `authored-row.tsx`'s row direction to `flex-row` (dropping the
 *       `mine ? "flex-row-reverse"` arm), which puts every own-agent post's bar on the wrong
 *       edge: **1 revert, 1 failure** (the right-aligned case; the left-aligned one stays
 *       green, which is precisely why both sides are pinned and not just one);
 *   (e) 2026-09-14 — dropping `self-stretch` from `ACCENT_BAR`, which collapses the bar to
 *       zero height and ends the *"travels the length of the messages"* rule: **1 revert,
 *       2 failures** (the row-height case and the continuation case);
 *   (f) 2026-09-14 — restoring `rounded-full` on `ACCENT_BAR`, which puts a cap back on the
 *       end the ring joins: **1 revert, 1 failure**.
 */

import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AGENT_ACCENT_NEUTRAL, agentBoxOf, agentPostAccent } from "./agent-box-rule";
import { AuthoredRow } from "./authored-row";
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

const indexWith = (identities: Array<[string, AgentIdentity]>) =>
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

/**
 * THE RENDERED FACE — a ring around the pill and a bar down the post's outer edge.
 *
 * ⚠ **EVERY QUERY BELOW IS STRUCTURAL, NOT BY CLASS NAME, WHEREVER IT CAN BE.** The bar is
 * `article > span` because it is the row's only non-column child; the ring is the span that
 * WRAPS `[data-attribution-pill]`. A suite that found them by their utility strings would
 * pass over a bar rendered inside the body column, which is the one arrangement the ruling
 * forbids.
 */
describe("the accent, rendered", () => {
  const renderRow = (
    over: Partial<MessageRow> = {},
    box: Parameters<typeof agentPostAccent>[0] | null = { color: "agent-07" }
  ) => {
    const r = row(over);
    return render(
      <AuthoredRow
        id={r.id}
        side={r.side}
        author={r.author}
        authorLabel={r.authorLabel}
        time={r.time}
        agent={r.agent}
        agentId={r.agentId}
        agentName="Bug Reviewer"
        continuation={r.continuation}
        flash={false}
        accent={box && agentPostAccent(box)}
      >
        <p>the parser is fixed</p>
      </AuthoredRow>
    );
  };

  /** ⚠ `[aria-hidden]` IS LOAD-BEARING IN THIS SELECTOR, not decoration: on an UNACCENTED
   *  row the attribution pill is itself a `<span>` directly under the article
   *  (`attribution-pill.tsx` renders one when the pill is inert), so a bare `article > span`
   *  would find the pill and report a bar on every person's post. */
  const bar = (c: HTMLElement) => c.querySelector<HTMLElement>("article > span[aria-hidden]");
  const ring = (c: HTMLElement) =>
    c.querySelector<HTMLElement>("[data-attribution-pill]")?.parentElement ?? null;

  it("carries the KEY on the row, not a resolved colour", () => {
    // ⚠ THE KEY IS THE STABLE HOOK (`attribution-pill.tsx`'s `data-attribution-pill`
    // precedent). Asserting on the key rather than on a computed `oklch()` also keeps this
    // suite from breaking every time the palette is retuned — which the token block invites.
    const { container } = renderRow();
    expect(container.querySelector("[data-agent-color='agent-07']")).not.toBeNull();
  });

  it("carries NO colour attribute on the neutral face", () => {
    const { container } = renderRow({}, { color: null });
    expect(container.querySelector("[data-agent-color]")).toBeNull();
  });

  it("RINGS the pill in the agent's colour — a stadium on the outer sides, SQUARE where it meets the bar", () => {
    // 🔒 Samuel, 2026-09-14, twice: "where it connects with the bar, it should be a
    // straight, not rounded" → the ring's bar-side edge is a straight vertical line.
    const { container } = renderRow();
    const wrap = ring(container)!;
    expect(wrap.className).toContain("ring-2");
    expect(wrap.className).not.toMatch(/\brounded-full\b/);
    expect(wrap.className).toMatch(/rounded-(l|r)-full/);
    expect(wrap.className).toMatch(/rounded-(l|r)-none/);
    // Peer post (left-aligned, bar on the left): the LEFT side is the square one.
    expect(wrap.className).toContain("rounded-r-full rounded-l-none");
    // ⚠ THE TOKEN BY REFERENCE — `lib/agent-colors.ts › agentColorVar` is the only place the
    // name is spelled, and Tailwind cannot carry a colour chosen by a runtime key.
    expect(wrap.style.getPropertyValue("--tw-ring-color")).toBe("var(--agent-color-07)");
    // ⚠ NO OFFSET: the ring has to REACH the bar, which is what makes the two read as one
    // shape. `ring-offset-2` would open a 2px hole between them.
    expect(wrap.className).not.toContain("ring-offset");
  });

  it("hangs the bar on the RIGHT of a right-aligned post", () => {
    // 🔒 **MUTATION (d)**, one of its two cases. Samuel: *"For messages that are right
    // aligned, this bar should sit to the right"*. An agent hangs on its OPERATOR's side
    // (INVARIANTS §5), so the viewer's own agents are `side: "me"` and this is the ordinary
    // case on the machine that launched them — not an edge case.
    const { container } = renderRow({ side: "me" });
    expect(container.querySelector("article")!.className).toContain("flex-row-reverse");
    expect(bar(container)!.style.backgroundColor).toBe("var(--agent-color-07)");
  });

  it("hangs the bar on the LEFT of a left-aligned post", () => {
    // 🔒 **MUTATION (d)**, the other case: a mutation that pins the direction to `flex-row`
    // leaves this one green, which is exactly why both sides are pinned.
    const { container } = renderRow({ side: "peer" });
    const cls = container.querySelector("article")!.className;
    expect(cls).toContain("flex-row");
    expect(cls).not.toContain("flex-row-reverse");
  });

  it("gives the bar the ROW's height, not its own content's", () => {
    // 🔒 **MUTATION (e).** Samuel: *"a vertical bar, that travels the length/amount of lines
    // of the messages from that agent"*. An empty stretched item is measured by its siblings;
    // without `self-stretch` it measures zero and the bar disappears entirely.
    const { container } = renderRow();
    expect(bar(container)!.className).toContain("self-stretch");
    expect(bar(container)!.className).toContain("w-[3px]");
    expect(container.querySelector("article")!.className).toContain("items-stretch");
  });

  it("cuts the bar SQUARE at the end that meets the pill, rounded only at the far end", () => {
    // ⚠ Samuel, 2026-09-14, over the first build of this face: *"where it connects with the
    // bar, it should be a straight, not rounded"*. The TOP is the end the ring joins, and a
    // cap there tapers to a point exactly where one colour has to run into the other — so the
    // join reads as two marks that nearly touch. `rounded-full` on this element is the
    // regression, and it is invisible to every other case in this file.
    const { container } = renderRow();
    expect(bar(container)!.className).toContain("rounded-b-full");
    expect(bar(container)!.className).not.toContain("rounded-full");
    expect(bar(container)!.className).not.toContain("rounded-t");
  });

  it("draws NO frame — no border, no 14px box around the post", () => {
    // ⚠ **THE DELETION IS THE RULING** (*"instead of it being an entire box"*), and nothing
    // else in this file would notice a leftover wrapper: a ring, a bar and a border can all
    // be true at once.
    const { container } = renderRow();
    expect(container.querySelector(".border-2")).toBeNull();
    expect(container.querySelector('[class*="rounded-[14px]"]')).toBeNull();
  });

  it("keeps the BAR on a continuation and drops the ring with the pill", () => {
    // ⚠ Samuel's run rule, unchanged: a continuation has no pill, so there is nothing to ring
    // — but the bar is a fact about the post's LINES and must still run its height.
    const { container } = renderRow({ continuation: true });
    expect(container.querySelector("[data-attribution-pill]")).toBeNull();
    expect(bar(container)).not.toBeNull();
    expect(bar(container)!.className).toContain("self-stretch");
  });

  it("paints an ENDED agent's ring and bar NEUTRALLY", () => {
    const { container } = renderRow({}, { color: null });
    expect(bar(container)!.style.backgroundColor).toBe(AGENT_ACCENT_NEUTRAL);
    expect(ring(container)!.style.getPropertyValue("--tw-ring-color")).toBe(
      AGENT_ACCENT_NEUTRAL
    );
  });

  it("leaves a PERSON's row with no bar and an unringed pill", () => {
    const { container } = renderRow({ agent: false, agentId: null }, null);
    expect(bar(container)).toBeNull();
    // ⚠ THE PILL IS UNWRAPPED, which is the stronger claim than "no ring class": the ring is
    // a WRAPPER, so its absence must mean the pill sits directly on the row as it always has.
    expect(ring(container)!.tagName).toBe("ARTICLE");
  });

  it("gives each post in a run its OWN bar — one post, one bar", () => {
    // ⚠ Samuel's *"one post, one bar"*, which is the deleted box's *"one post, one box"* over
    // the new face. Merging would mean one bar spanning two articles, and there is no element
    // that could own it without the run becoming a row shape of its own.
    const { container } = render(
      <>
        <AuthoredRow
          id="m1"
          side="peer"
          author={row().author}
          authorLabel="R"
          time="09:41"
          agent
          agentId={AGENT}
          agentName="R"
          continuation={false}
          flash={false}
          accent={agentPostAccent({ color: "agent-07" })}
        >
          <p>one</p>
        </AuthoredRow>
        <AuthoredRow
          id="m2"
          side="peer"
          author={row().author}
          authorLabel="R"
          time="09:42"
          agent
          agentId={AGENT}
          agentName="R"
          continuation
          flash={false}
          accent={agentPostAccent({ color: "agent-07" })}
        >
          <p>two</p>
        </AuthoredRow>
      </>
    );
    expect(container.querySelectorAll("article > span[aria-hidden]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-agent-color='agent-07']")).toHaveLength(2);
  });
});
