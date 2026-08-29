/**
 * THE TWO COMPOSERS SHARE ONE INPUT RECIPE — a SOURCE SCAN, not a render.
 *
 * ⚠ WHY SOURCE AND NOT A RENDERED CLASS COMPARISON. What went wrong three times running is that
 * "match the other composer" was implemented as two class stacks nudged toward each other, and a
 * test that compared the two rendered strings would go green the moment they *happened* to agree —
 * and stay green while the next edit pulled them apart again. The property that actually holds is
 * STRUCTURAL: both files consume the same exported constant, so equality is not a coincidence
 * anyone can undo by re-tuning a padding at a call site. That is only assertable over the source.
 *
 * ⚠ IT IS THE SAME METHOD `template-editor.test.tsx › no concave surfaces` and
 * `preload-parity.test.mjs` use, and for the same reason: the invariant is about what the code
 * SAYS, not about what one render happened to produce.
 *
 * ⚠ COMMENTS ARE STRIPPED. Both files EXPLAIN the shared constant in a docblock right above the
 * use, so a raw scan would stay green with the code deleted — the exact mutation this exists to
 * catch. Measured: without the strip, reverting either call site is vacuous.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dirname;
const read = (f: string): string => readFileSync(join(HERE, f), "utf8");

/**
 * Code only — a comment mentioning a constant proves nothing.
 *
 * ⚠ IT STRIPS BLOCK COMMENTS WHOLE, not "lines that start with a comment marker". Both files
 * explain these recipes in `{/* … *\/}` JSX blocks whose CONTINUATION lines start with ordinary
 * words, so a per-line filter left the prose in and every ban below matched its own explanation.
 * Measured: with the naive filter, two of the four cases failed on comment text alone.
 */
const codeOf = (f: string): string =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

const CHANNEL = "composer.tsx";
const AGENT = "agent-composer.tsx";

describe("one input row, two composers", () => {
  it("both surfaces MOUNT ComposerInputRow", () => {
    // ⚠ THE PIN MOVED FROM CONSTANTS TO THE COMPONENT (2026-08-27), because the constants did not
    // work. Both files consumed `COMPOSER_INPUT_PAD` and `COMPOSER_INPUT_BORDER` and the two rows
    // STILL rendered differently side by side: the surfaces are different TREES, so the same
    // classes landed at different nesting levels, the send button sat in two different flex
    // contexts, and a `gap` meant for one axis added height on the other. Sharing strings between
    // two hand-built trees is not sharing a row.
    // ⚠ A TAG BOUNDARY, NOT A SUBSTRING. `toContain("<ComposerInputRow")` also matches
    // `<ComposerInputRowX`, so a rename-and-fork slipped straight past it — measured, while
    // mutation-testing this very case.
    for (const file of [CHANNEL, AGENT]) {
      expect(codeOf(file), `${file} stopped mounting the shared row`).toMatch(
        /<ComposerInputRow[\s/>]/
      );
    }
  });

  it("neither surface builds an input+button row of its own", () => {
    // ⚠ THE REGRESSION IS A REBUILD, NOT A DELETION. A file could mount the component somewhere
    // and still hand-roll a second field-plus-arrow beside it, which is how this drifted before —
    // so the PARTS are banned outright at the call sites.
    // ⚠ STILL TRUE AFTER THE ARROW MOVED (2026-08-28). Main's send now hangs at the end of its
    // TOOLBAR row rather than inside the input row, and the temptation that comes with a moved
    // control is to write the button out where it landed. It mounts `ComposerSend` instead — the
    // slot from the shared file — so the face is still built in exactly one place.
    for (const file of [CHANNEL, AGENT]) {
      expect(codeOf(file), `${file} hand-rolled a send button again`).not.toContain(
        "<SendButton"
      );
    }
    // ⚠ THE AGENT BAR NEVER NAMES THE FACE: its row IS the box and takes `.raised-tab` from the
    // shared component. The CHANNEL surface names it exactly ONCE — on the CARD, which is that
    // surface's one box (next case). A SECOND mention there is the face landing on the row as
    // well, which is the bubble-in-a-bubble this file exists to keep out.
    expect(codeOf(AGENT), "the agent bar re-stated the input face").not.toContain("raised-tab");
    expect(
      codeOf(CHANNEL).match(/raised-tab/g) ?? [],
      "the channel surface wears the face in more than one place"
    ).toHaveLength(1);
  });

  it("MAIN mounts the BARE row, the AGENT bar mounts the FACED one", () => {
    // ⚠ ONE BOX PER SURFACE (Samuel, 2026-08-27). The agent bar IS the row, so it wears the pill.
    // The channel composer already has a box — its card — so the row inside it draws no face at
    // all; a faced row in a bordered card is the bubble-in-a-bubble this closed. **The mutation
    // this catches is main going back to `face="pill"`**, which is that bubble returning.
    // ⚠ EACH SIDE IS PINNED BOTH WAYS. Asserting only "main says bare" stays green if main says
    // both, and the prop is required precisely so neither mount can inherit the other's face.
    const main = codeOf(CHANNEL);
    const agent = codeOf(AGENT);
    expect(main, "the channel composer re-grew an inner face").toContain('face="bare"');
    expect(main, "the channel composer mounted the pill").not.toContain('face="pill"');
    expect(agent, "the agent bar lost its pill").toContain('face="pill"');
    expect(agent, "the agent bar went bare — its row IS the box").not.toContain('face="bare"');
  });

  it("the two modes differ in the BOX and in nothing else", () => {
    // ⚠ THE ROW'S SHAPE IS ONE STRING, NOT A BRANCH. The axis, the alignment and the gap are
    // handed to both modes unconditionally, and so is the field's own recipe. A mode that laid
    // out differently would be two trees again — the exact failure this file's header is about.
    // ⚠ WHAT THE MODE DECIDES IS THE BOX, AND THE INSET IS PART OF THE BOX (Samuel, live review
    // 2026-08-28). The padding used to be unconditional, which made `"bare"` pay for an edge it
    // does not draw — 12px left and 6px top ON TOP OF the card's own inset, so the field sat
    // right of and below the toolbar icons under it. `PILL_FACE` carries the face and the inset
    // together; **the mutation this catches is either one drifting back out of that constant**,
    // which is how "bare" grows a second inset again.
    const row = codeOf("composer-input.tsx");
    expect(row).toContain('const ROW_GEOMETRY = "flex items-center gap-2"');
    expect(row, "the inset left the face it pays for").toContain(
      'const PILL_FACE = "raised-tab rounded-[10px] p-1.5 pl-3"'
    );
    expect(row, "the face switch grew a second class").toContain(
      'cn(ROW_GEOMETRY, face === "pill" && PILL_FACE)'
    );
    // Both call sites take the geometry from that one constant — neither states any of it.
    for (const file of [CHANNEL, AGENT]) {
      expect(codeOf(file), `${file} re-stated the row's padding`).not.toMatch(
        /p-1\.5|rounded-\[10px\]/
      );
    }
  });

  it("the ARROW hangs in the CARD's toolbar row on main, and inside the row on the agent bar", () => {
    // ⚠ ONE BUTTON, TWO PLACES, AND THE PLACE IS THE ONLY DIFFERENCE (Samuel, live review
    // 2026-08-28). Main's card is two rows — field over toolbar — and its one submit belongs at
    // the END of the toolbar, level with the icons, not floating at the card's top-right. The
    // agent bar is a single row, so its arrow stays in it.
    // ⚠ THE FACE IS NOT WHAT MOVED. `ComposerSend` is the shared slot; main mounting it is main
    // choosing a POSITION, and the ban on `<SendButton` above is what keeps that true. **The
    // mutation this catches is main losing the slot** — an arrow deleted with the input row's
    // send props, leaving a card whose only submit is the panel button.
    const main = codeOf(CHANNEL);
    expect(main, "main stopped mounting the shared arrow").toMatch(/<ComposerSend[\s/>]/);
    expect(
      codeOf(AGENT),
      "the agent bar lifted its arrow out of its own row"
    ).not.toMatch(/<ComposerSend[\s/>]/);
    // The bare mount is handed NO send wiring — the row it is in does not draw the button.
    expect(
      main.match(/<ComposerInputRow[\s\S]*?\/>/)?.[0] ?? "",
      "the bare row was handed send wiring it cannot render"
    ).not.toMatch(/sendDisabled|sendLabel|sendTitle/);
  });

  it("the bare row's field starts flush with the card's content box", () => {
    // ⚠ ONE INSET FOR THE CARD'S CONTENTS, AND THE CARD PAYS IT (Samuel, live review 2026-08-28:
    // *the input sits further up and left*). The card's `px-[13px] py-[11px]` is that one source;
    // the toolbar row adds nothing on top of it, and now neither does the input row, so the
    // field and the icons under it start from the same edge.
    // ⚠ THE PROPERTY IS "THE SHARED ROW SHAPE CARRIES NO PADDING AT ALL", asserted over the
    // string rather than by naming today's classes: any `p-*` back in `ROW_GEOMETRY` is an inset
    // charged to BOTH modes, which is what put the field 12px right of the toolbar. The pill's
    // own inset is not caught here and must not be — it belongs to the edge the pill draws.
    const shape = codeOf("composer-input.tsx").match(/const ROW_GEOMETRY = "([^"]*)"/)?.[1];
    expect(shape, "ROW_GEOMETRY is not a plain string any more").toBeTypeOf("string");
    expect(shape, "an inset came back onto the shape BOTH modes wear").not.toMatch(/\bp[xytblr]?-/);
    // And the toolbar row it must line up with still states no inset of its own either.
    expect(codeOf(CHANNEL), "the toolbar row grew an inset the field cannot match").toContain(
      '<div className="flex items-center gap-0.5">'
    );
  });

  it("the row owns the face, and no caller can override it", () => {
    // ⚠ NO `className`, NO `size`, NO `variant` ON THE COMPONENT. A prop that let one mount nudge
    // the face would re-open the exact gap this closed — the channel composer used to pass its
    // send button an `ml-1` and an opacity of its own, which is how the two came to look
    // different in the first place.
    const row = codeOf("composer-input.tsx");
    expect(row).toContain("raised-tab");
    expect(row).toContain("<SendButton");
    expect(row, "the shared row grew an override prop").not.toMatch(/\bclassName\??:/);
  });

  it("the channel composer's CARD wears the agent pill's face VERBATIM", () => {
    // ⚠ THE WHOLE FACE, NOT A LAYER OF IT (Samuel, live review 2026-08-27). An earlier pass gave
    // the card the raised recipe's 1px inset ring alone; beside the agent bar's dimensional
    // material it read FLAT, because the gradient, the bevel and the drops are the dimension.
    // **The class itself is the shared source** — the same `.raised-tab` the row wears in
    // `"pill"` mode — so there is nothing to re-derive and nothing to keep in step.
    // ⚠ THE MUTATIONS THIS CATCHES: back to `.bento` (a floating card, a different material);
    // back to an extracted `shadow-[inset…]` ring; a `bg-*` utility riding along, which outranks
    // the kit layer and flattens the gradient to a solid.
    // ⚠ THE PADDING CARRIES THE PIXEL THE BORDER USED TO. `.bento` declared a real 1px border and
    // this box is `border-box`; `.raised-tab` must sit on a BORDERLESS element (its ring is
    // inset, docs/DESIGN-SYSTEM.md), so `px-3 py-2.5` became `px-[13px] py-[11px]` and the outer
    // box — and therefore the card's HEIGHT — is unchanged. Restoring the scale values shrinks
    // the card 2px, which is the height regression this suite has caught twice.
    // ⚠ THE RADIUS IS RESTATED because `.raised-tab` carries none and `.bento`'s 14px left with
    // it. The CARD'S OWN radius wins — it is the one thing about the box that did not change.
    const box = codeOf(CHANNEL);
    expect(box).toContain('"raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]"');
    expect(box, "the card went back to a floating bento card").not.toMatch(/\bbento\b/);
    expect(box, "the card re-derived the edge instead of wearing the face").not.toMatch(
      /shadow-\[inset/
    );
    expect(box, "a bg-* utility flattened the raised gradient").not.toMatch(/\bbg-white\b/);
    expect(box, "the card grew a gap again").not.toMatch(/raised-tab[^"]*\bgap-\d/);
  });

  it("both composers hang off ONE bottom offset", () => {
    // ⚠ THE TWO BOXES SIT SIDE BY SIDE ACROSS THE PANE DIVIDER — the agent panel is `inset-y-0`
    // against the same bottom edge the message pane ends on — so their bottoms must be the same
    // number or one visibly floats higher. It did: `pb-4` here against `py-3` there, 4px apart
    // (Samuel, live review 2026-08-27). ⚠ ONE CONSTANT, NOT TWO EQUAL LITERALS: two numbers that
    // agree today is exactly the arrangement every earlier pass of this file shipped and lost.
    // ⚠ THE TOPS ARE DELIBERATELY NOT SHARED. Each surface's top spacing answers what sits ABOVE
    // it — a transcript, or a work stream — and is not what aligns the boxes.
    expect(codeOf("composer-input.tsx")).toContain('export const COMPOSER_BOTTOM = "pb-4"');
    expect(codeOf(CHANNEL)).toContain('cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)');
    expect(codeOf(AGENT)).toContain('cn("shrink-0 pt-3", COMPOSER_BOTTOM, className)');
    for (const file of [CHANNEL, AGENT]) {
      expect(codeOf(file), `${file} wrote its own bottom offset again`).not.toMatch(/\bpb-4\b/);
    }
  });
});

describe("the agent pane's divider", () => {
  it("carries the SAME border class the pane's own lines do", () => {
    // ⚠ THE COLOUR IS NOT CHOSEN IN THE COMPONENT. On /home both are recoloured by
    // `pages/home/home.module.css › .frame :global(.border-border-default)`, which is the blue
    // being pointed at; a hardcoded `border-link` was a different blue AND dropped the class that
    // rule keys on, so the divider could not track the pane's other lines.
    const panel = codeOf("agent-panel.tsx");
    expect(panel).toContain("border-l border-border-default");
    expect(panel, "the divider picked its own blue again").not.toMatch(/border-link\b/);
    // The header rule it must match, still stated the same way.
    expect(panel).toContain("border-b border-border-default");
  });
});
