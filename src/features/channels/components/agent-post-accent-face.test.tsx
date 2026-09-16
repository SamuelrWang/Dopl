// @vitest-environment jsdom
/**
 * **WHAT A CHANNEL AGENT'S ACCENT LOOKS LIKE, RENDERED** — the frame around the pill and
 * the bar down the post's outer edge (Samuel, 2026-09-14; restyled 2026-09-16).
 *
 * ⚠ **SPLIT OFF `agent-post-accent.test.tsx` ON 2026-09-16, AT THE 500-LINE CAP (§1), AND
 * THE SEAM IS THE HONEST ONE** — the precedent is `agent-pill-open.test.tsx` leaving
 * `agent-attribution.test.tsx` the same way. That file pins **WHICH posts get an accent**
 * (`agent-box-rule.ts › agentBoxOf`'s three-way split, `› agentPostAccent`'s key→paint
 * resolution, `view-model.ts › indexAgents`'s bank rule) and moves when the RULE moves.
 * This one pins **what the accent is drawn as** and moves when the FACE moves — which it
 * has now done three times in three days. Nothing changed in the move except the cases
 * Samuel's 2026-09-16 pass rewrote.
 *
 * ⚠ **EVERY QUERY BELOW IS STRUCTURAL, NOT BY CLASS NAME, WHEREVER IT CAN BE.** The bar is
 * `article > span[aria-hidden]` because it is the row's only non-column child; the frame is
 * the span that WRAPS `[data-attribution-pill]`. A suite that found them by their utility
 * strings would pass over a bar rendered inside the body column, which is the one
 * arrangement the ruling forbids.
 *
 * ⚠ **MUTATION-VERIFIED (2026-09-14, carried over with the cases):**
 *   (d) pinning `authored-row.tsx`'s row direction to `flex-row` (dropping the
 *       `mine ? "flex-row-reverse"` arm) — **1 revert, 1 failure** (the right-aligned case;
 *       the left-aligned one stays green, which is why both sides are pinned);
 *   (e) dropping `self-stretch` from `ACCENT_BAR` — **1 revert, 2 failures**;
 *   (f) restoring `rounded-full` on `ACCENT_BAR` — **1 revert, 1 failure**.
 */

import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AGENT_ACCENT_NEUTRAL, agentPostAccent } from "./agent-box-rule";
import { AuthoredRow } from "./authored-row";
import type { MessageRow } from "./view-model-rows";

/** ⚠ **EXPLICIT, BECAUSE THIS PROJECT DOES NOT CONFIGURE testing-library's AUTO-CLEANUP** —
 *  see the sibling file's note; a leaked render crosses FILE boundaries in one worker. */
afterEach(cleanup);

const AGENT = "ab12cd34";

/** A built row, narrowed to the fields the accent reads. ⚠ `as MessageRow` rather than a
 *  full fixture: this suite is about the FACE, and a whole row would put every unrelated
 *  field of `view-model-rows.ts` into these cases' blast radius. */
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

  it("FRAMES the pill in the agent's colour — a stadium on the outer sides, SQUARE where it meets the bar", () => {
    // 🔒 Samuel, 2026-09-14, twice: "where it connects with the bar, it should be a
    // straight, not rounded" → the frame's bar-side edge is a straight vertical line.
    const { container } = renderRow();
    const wrap = ring(container)!;
    expect(wrap.className).toContain("border-[3px]");
    expect(wrap.className).not.toMatch(/\brounded-full\b/);
    expect(wrap.className).toMatch(/rounded-(l|r)-full/);
    expect(wrap.className).toMatch(/rounded-(l|r)-none/);
    // Peer post (left-aligned, bar on the left): the LEFT side is the square one.
    expect(wrap.className).toContain("rounded-r-full rounded-l-none");
    // ⚠ THE TOKEN BY REFERENCE — `lib/agent-colors.ts › agentColorVar` is the only place the
    // name is spelled, and Tailwind cannot carry a colour chosen by a runtime key.
    expect(wrap.style.borderColor).toBe("var(--agent-color-07)");
  });

  /**
   * 🔒 **ONE DRAWN SHAPE, NOT THREE (Samuel, 2026-09-16)**: *"it looks like, the
   * borderline, the badge, and the vertical line, are 3 different components, is it
   * possible to make it a single component? Because here, you see that the lines overlap
   * and cause it to be darker."*
   *
   * ⚠ **THE PROPERTY IS THE COUNT OF STROKES, AND EVERY OTHER CASE IN THIS FILE IS BLIND
   * TO IT.** A ring, a border and a bar can all be true at once and each assertion above
   * passes. The three that have to hold together: the FRAME is a real border on three
   * sides, the bar-side edge is dropped so the bar IS the fourth (no band painted twice —
   * which is what made the neutral 12%-black face composite DARKER at the join), and the
   * PILL inside draws nothing at all.
   * ⚠ **`ring-` MUST BE ABSENT, not merely unused.** A ring is painted OVER the element's
   * own box-shadow, so re-adding one would silently put the badge's elevation back under
   * an opaque band — the exact defect Samuel reported as the shadow being *"covered behind
   * the borderline"*.
   */
  it("draws ONE stroke: a border on the frame, none on the pill, and the bar as the fourth edge", () => {
    const { container } = renderRow();
    const wrap = ring(container)!;
    const pill = container.querySelector<HTMLElement>("[data-attribution-pill]")!;
    // The frame is the one bordered box — three sides, the bar-side edge dropped.
    expect(wrap.className).toContain("border-[3px]");
    expect(wrap.className).toContain("border-l-0");
    expect(wrap.className).not.toContain("ring-");
    // ⚠ NO SECOND BORDER ON THE PILL: `.bento` is a hairline AND an elevation, and
    // `bits.tsx › agentAccent` tints it per id — together they were the third component.
    expect(pill.className).not.toMatch(/\bbento\b/);
    expect(pill.className).not.toMatch(/\bborder-/);
    expect(pill.className).not.toMatch(/\bring-/);
    // ⚠ AND THE ELEVATION IS ON THE OUTERMOST BOX, so nothing can clip it.
    expect(wrap.className).toContain("shadow-[var(--shadow-bento)]");
    expect(pill.className).not.toMatch(/shadow-/);
  });

  /**
   * 🔒 **THE FRAME'S TOP STROKE AND THE BAR'S TOP END START AT THE SAME LINE.**
   *
   * ⚠ **THE PROPERTY IS AN ABSENCE, AND IT IS THE ONE THE RING ERA HID.** A ring wrapped
   * the corner — it painted ABOVE the bar's top end as well as beside it — so the wrapper
   * could be pulled anywhere and the two still met. A three-sided border's top stroke
   * starts at the bar's INNER edge, so a `-mt-[3px]` "to keep the ring's layout" offsets
   * the two marks diagonally and opens a 3px notch at the corner: the exact *"3 different
   * components"* reading, reintroduced by the fix for it. The frame is the content
   * column's first child and the bar is `self-stretch` over the same box, so NO top margin
   * is what aligns them.
   */
  it("does not pull its top edge off the bar's, or the corner opens a notch", () => {
    const { container } = renderRow();
    const wrap = ring(container)!;
    expect(wrap.className).not.toMatch(/-mt-/);
    expect(wrap.className).not.toMatch(/-my-/);
    // ⚠ THE BOTTOM IS STILL PULLED — nothing has to meet there, and it keeps the 3px gap
    // to the body that the ring's own overhang produced.
    expect(wrap.className).toContain("-mb-[3px]");
  });

  /**
   * 🔒 **THE PRESS AND THE BORDER ARE ON ONE ELEMENT (Samuel, 2026-09-15: the border
   * "detaches" from the badge on hover).**
   *
   * ⚠ **THE PROPERTY IS "EXACTLY ONE ELEMENT MOVES, AND IT IS THE ONE WEARING THE
   * RING" — NOT "the wrapper has a translate class".** A transform moves only the
   * element it is on, so the bug and its two plausible bad fixes are all shapes of
   * the same mistake: the lift on the INNER pill (what shipped, leaving the border
   * behind) or on BOTH (a 2px lift). Pinning the pill's side is what makes this
   * suite catch the second one.
   * ⚠ THE RING-SIDE ASSERTION USES `has-[button:…]` ON PURPOSE: that variant is the
   * thing carrying "only when the pill is actually pressable", so a refactor that
   * lifts the wrapper unconditionally — animating an inert capsule in the pop-out
   * window — fails here too.
   */
  /**
   * 🔒 **THE RING AND THE BAR ARE THE SAME WIDTH (Samuel, 2026-09-15, option (b): the
   * ring thickens to the bar's 3px rather than the bar thinning to the ring's 2px).**
   *
   * ⚠ **THE PROPERTY IS THE MATCH, NOT EITHER NUMBER.** `GUTTER`'s geometry lays the ring
   * over the bar, so the two are halves of ONE line of colour and any difference between
   * them reappears as the step Samuel reported — with the little triangular gaps where the
   * ring's curve pulls off the leftover sliver. Asserting `ring-2` alone (which this suite
   * did) pins a number while saying nothing about the relationship that actually has to
   * hold, which is why the 1px mismatch lived here through two reviews.
   * ⚠ Pinned as a PAIR in one case on purpose: a future retune that moves the bar to 4px
   * and forgets the ring fails HERE, in a case whose name says what is wrong.
   */
  /**
   * 🔬 **THE FLUSH EXPERIMENT (Samuel, 2026-09-15)** — *"on the left side it is still
   * rounded but on the right side (or basically wherever side it is that meets the
   * vertical line), I want it to actually be a sharp corner."*
   *
   * ⚠ **THE PROPERTY IS THAT THE PILL AND ITS RING TURN THE SAME CORNER.** The ring has
   * been square on the bar side since 2026-09-14; the capsule inside it was not, and the
   * crescent between a straight border and a curved edge is the *"two empty gaps with
   * these triangles"*. So this asserts the PAIR, not the pill alone — squaring one and
   * not the other is the bug in either direction.
   * ⚠ **THIS WHOLE CASE REVERTS WITH THE EXPERIMENT.** It is pinned in its own `it` and
   * its own commit so Samuel can look at it and say no without unpicking items 1 and 2.
   */
  it("squares the BADGE on the bar side too, so it sits flush with the line", () => {
    const { container } = renderRow();
    const pill = container.querySelector<HTMLElement>("[data-attribution-pill]")!;
    // Peer post: bar on the LEFT, so the LEFT corner is the square one — on both.
    expect(pill.className).toContain("rounded-l-none");
    expect(pill.className).toContain("rounded-r-full");
    expect(pill.className).not.toMatch(/\brounded-full\b/);
    expect(ring(container)!.className).toContain("rounded-l-none");
  });

  it("leaves a person's pill a full capsule — nothing to sit flush against", () => {
    // ⚠ THE OTHER HALF OF THE OVERRIDE: `radius` is asked for by an ACCENTED row, it is
    // not a new default. A human row has no bar, so squaring it would be a corner cut
    // against nothing.
    // ⚠ THE SECOND ARG IS THE BOX AND IT MUST BE `null` HERE — `renderRow` defaults it to
    // a real colour, so omitting it renders an ACCENTED row and proves nothing about the
    // unaccented one.
    const { container } = renderRow({ agent: false, agentId: null }, null);
    const pill = container.querySelector<HTMLElement>("[data-attribution-pill]")!;
    expect(pill.className).toMatch(/\brounded-full\b/);
  });

  it("matches the frame's stroke to the bar's width, or the join shows a step", () => {
    const { container } = renderRow();
    expect(bar(container)!.className).toContain("w-[3px]");
    expect(ring(container)!.className).toContain("border-[3px]");
  });

  it("moves the RING, not the pill, so the border cannot detach on hover", () => {
    const { container } = renderRow();
    const wrap = ring(container)!;
    const pill = container.querySelector<HTMLElement>("[data-attribution-pill]")!;

    expect(wrap.className).toContain("has-[button:hover]:-translate-y-0.5");
    expect(wrap.className).toContain("has-[button:active]:translate-y-0.5");
    // ⚠ BOTH PROPERTIES TRANSITION (2026-09-16). It was `transition-transform`, so the
    // hover shadow below would have SNAPPED while the lift animated.
    expect(wrap.className).toContain("transition-[transform,box-shadow]");
    expect(wrap.className).toContain("motion-reduce:transition-none");
    // ⚠ AND THE PILL ITSELF STAYS PUT — the half that fails if the motion is ever
    // copied back onto the button "so the pill still feels pressable".
    expect(pill.className).not.toMatch(/translate-y/);
  });

  /**
   * 🔒 **THE HOVER DEEPENS THE SHADOW, AND IT IS THE BLACK BUTTON'S OWN STEP (Samuel,
   * 2026-09-16)**: *"when I hover over like one of the black buttons, it translates up,
   * and the shadow gets darker/larger. And that's what makes it clearly visible. Can we
   * add the same functionality, when it translates up, it like has more shadowing?"*
   *
   * ⚠ **THE PROPERTY IS THE TOKEN, NOT "A SHADOW CHANGES".** `--shadow-raised-hover` is
   * `.auth-btn-3d:hover`'s ambient pair EXTRACTED — that rule names the token now — so a
   * literal here, or a second hand-tuned pair, is the drift docs/DESIGN-SYSTEM.md forbids
   * and is exactly what this case exists to fail.
   */
  it("deepens the badge's shadow on hover, on the black button's own token", () => {
    const { container } = renderRow();
    expect(ring(container)!.className).toContain(
      "has-[button:hover]:shadow-[var(--shadow-raised-hover)]"
    );
  });

  /**
   * 🔒 **THE SHADOW IS ON THE RING, NOT ON THE PILL (Samuel, 2026-09-15: the shadow
   * must cover the ENTIRE badge including the ring; on ringed badges it is blocked
   * while the ringless "You" badge shows it fine).**
   *
   * ⚠ **THE PROPERTY IS *WHICH ELEMENT* CASTS IT.** The pill's `.bento` elevation is
   * cast from the pill's border box, and the ring is an opaque 3px band sitting on
   * exactly that band — so the shadow had nowhere to fall. Moving it to the outer
   * element is the fix, and asserting it HERE (rather than asserting "a shadow
   * exists somewhere") is what would catch a well-meaning revert that puts the
   * elevation back on the capsule.
   * ⚠ **THE TOKEN BY REFERENCE.** `--shadow-bento` is `.bento`'s own pair extracted
   * rather than copied, so a ringed badge and a ringless one cannot drift apart —
   * a literal shadow here would be the drift docs/DESIGN-SYSTEM.md forbids.
   */
  it("casts the badge's elevation from the FRAME, so nothing can swallow it", () => {
    const { container } = renderRow();
    expect(ring(container)!.className).toContain("shadow-[var(--shadow-bento)]");
  });

  it("leaves an UNFRAMED pill's own elevation alone — Samuel's reference case", () => {
    // ⚠ The "You" badge is the control in his report: it already showed a shadow
    // correctly, so `.bento` must still be the elevation on a row with no ring.
    const { container } = renderRow({ agent: false, agentId: null }, null);
    const pill = container.querySelector<HTMLElement>("[data-attribution-pill]")!;
    expect(pill.className).toContain("bento");
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
    expect(ring(container)!.style.borderColor).toBe(AGENT_ACCENT_NEUTRAL);
  });

  it("leaves a PERSON's row with no bar and an unframed pill", () => {
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
