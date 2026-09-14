/**
 * THE AGENT WINDOW'S GEOMETRY, PINNED AS EQUALITIES (Samuel, 2026-09-13, second pass).
 *
 * Every case here holds two things equal that live in files which do not import each other — which
 * is the whole reason `agent-window-frame.ts` exists. They are the rulings that FAIL SILENTLY: a
 * 42×36 "square", a 24px logo beside a 36px tile, a 260px rail on a 510px window, and a missing
 * `min-w-0` all render perfectly. Nothing on this list can be seen in jsdom (which paints nothing)
 * and nothing on it throws, so SOURCE is the only place the claim can be made — the same argument
 * `pages/agent-window/frame.test.ts` and `agent-window-chrome.test.tsx`'s drag-region case give.
 *
 * ⚠ **THE ONE CROSS-TREE READ IS `form-dialog.module.css`**, and it is the point of the first case:
 * Samuel named the popup field's underline as the thickness he wanted, so the number must be read
 * from THAT file rather than copied into a comment beside a hard-coded 2.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_NAME_TEXT,
  CHROME_ROW,
  INSET_PANEL,
  RAIL_COLLAPSED,
  RAIL_EXPANDED,
  RAIL_PAD,
  TAB_UNDERLINE,
  TAB_UNDERLINE_HEIGHT,
  TILE,
} from "./agent-window-frame";

const HERE = import.meta.dirname;

/** Code only — every file in this family argues about its own classes in prose, and a raw read
 *  matches the docblock recording a decision rather than the class making it. */
function code(path: string): string {
  return readFileSync(join(HERE, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const chrome = code("agent-window-chrome.tsx");
const rail = code("agent-window-rail.tsx");
const shell = code("agent-window-shell.tsx");
const view = code("agent-window.tsx");

describe("the active tab's underline is the popup field's underline", () => {
  /**
   * 🔒 *"For the top tab the line is too thin. It should be the same thickness as the underline on
   * the ontology page where you see the description. When the dashed line becomes black it should be
   * that thickness."*
   */
  it("takes its THICKNESS from `form-dialog.module.css › .line::after`, not a copied number", () => {
    const css = readFileSync(
      join(HERE, "../../../shared/ui/form-dialog.module.css"),
      "utf8"
    );
    const rule = css.slice(
      css.indexOf(".line::after {"),
      css.indexOf("}", css.indexOf(".line::after {"))
    );
    const height = /height:\s*(\d+)px/.exec(rule)?.[1];
    // ⚠ THE READ ITSELF IS AN ASSERTION: a renamed class silently matches nothing and `slice`
    // returns the rest of the file, so the capture must have produced a number.
    expect(height, "the popup field's underline rule moved or was renamed").toBeTruthy();
    expect(TAB_UNDERLINE_HEIGHT).toBe(`h-[${height}px]`);
  });

  it("is BLACK, FULL-BLEED and SQUARE-ENDED — the other three halves of that recipe", () => {
    // `.line::after` is `background: var(--text-primary)` with `left: 0; right: 0` and no radius.
    expect(TAB_UNDERLINE).toContain("bg-text-primary");
    expect(TAB_UNDERLINE).toContain("inset-x-0");
    // ⚠ `rounded-full` ON A 2px BAR TAPERS BOTH ENDS, which is most of why a 2px rule read as a
    // hairline. It was there, with `inset-x-2`, and both had to go.
    expect(TAB_UNDERLINE).not.toContain("rounded");
    expect(TAB_UNDERLINE).not.toContain("inset-x-2");
  });

  it("is the chrome's one underline — declared once, not re-spelled at the tab", () => {
    expect(chrome).toContain("TAB_UNDERLINE");
    expect(chrome, "the chrome grew its own underline rule").not.toMatch(/h-\[2px\]/);
  });
});

describe("the selected agent's tile and the Dopl mark are ONE square", () => {
  /** 🔒 *"the shaded area for the currently selected agent, it is not a perfect square. It has a
   *  longer width than height. It needs to be a perfect square. … increase the size of the Dopl
   *  logo. It should be the exact same size as that for the selected agent."* */
  it("is square by construction — one constant carrying BOTH dimensions, equal", () => {
    const [h, w] = TILE.split(" ");
    expect(h).toMatch(/^h-/);
    expect(w).toMatch(/^w-/);
    expect(h!.slice(2)).toBe(w!.slice(2));
  });

  it("is the collapsed rail's inner width, so the tile is a full-bleed row", () => {
    // 56px rail − 2 × 10px padding = 36px = `h-9`. The derivation is the constant's docblock; this
    // is the arithmetic, so a change to either width fails here rather than on screen.
    const railPx = Number(RAIL_COLLAPSED.replace("w-", "")) * 4;
    const padPx = Number(RAIL_PAD.replace("px-", "")) * 4;
    const tilePx = Number(TILE.split(" ")[0]!.replace("h-", "")) * 4;
    expect(railPx - 2 * padPx).toBe(tilePx);
  });

  it("is worn by the rail's collapsed row AND by the mark, from the same import", () => {
    expect(rail).toContain("TILE");
    expect(chrome).toContain("TILE");
    // ⚠ NEITHER SIDE MAY RE-SPELL IT. A literal `h-9 w-9` in either file is the drift this whole
    // module exists to prevent — "both 36px" by coincidence is what Samuel rejected.
    expect(rail).not.toMatch(/h-9\s+w-9/);
    expect(chrome).not.toMatch(/h-9\s+w-9/);
    // The mark was 24px in a 44px row; that is the size the ruling replaced.
    expect(chrome, "the mark kept its old 24px box").not.toMatch(/h-6 w-6/);
  });

  it("keeps the chrome row's height fixed — the drag band must not move", () => {
    expect(CHROME_ROW).toBe("h-[44px]");
    expect(chrome).toContain("CHROME_ROW");
  });
});

describe("the tab strip starts where the white panel starts", () => {
  /** 🔒 *"The things just don't align. Where you see the name of the agent at the top, the tab
   *  switcher should start on the left side and be aligned with the start of the white panel."* */
  it("gives the mark a slot of the RAIL's width with the RAIL's padding", () => {
    expect(chrome).toMatch(/railWidth, RAIL_PAD/);
    // ⚠ THE SLOT IS `shrink-0`: a slot that could be squeezed would slide the strip off the panel's
    // edge at exactly the narrow widths this pass is about.
    expect(chrome).toMatch(/shrink-0[^"]*", railWidth, RAIL_PAD\)/);
  });

  it("separates the two by the SAME gap the panel is inset by", () => {
    // The strip's x = rail width + this gap = the panel's x. One constant on both rows, or the
    // alignment is a coincidence that holds only while the two numbers happen to match.
    expect(chrome).toContain("FRAME_GAP");
    expect(shell).toContain("FRAME_GAP");
    expect(shell, "the body row hard-coded its gap again").not.toMatch(/flex min-h-0[^"]*gap-3/);
  });

  it("hands the rail's CURRENT width down, so the alignment holds expanded too", () => {
    expect(shell).toMatch(/const railWidth = collapsed \? RAIL_COLLAPSED : RAIL_EXPANDED/);
    expect(shell).toMatch(/railWidth=\{railWidth\}/);
  });
});

describe("the expanded rail is 2.5x the collapsed one, and never half the window", () => {
  /** 🔒 *"in the expanded view, the sidebar is just too large. … it should only increase in size to
   *  maybe double the size of the collapsed view or maybe 2.5x."* */
  it("is exactly 2.5 x 56px = 140px", () => {
    const collapsedPx = Number(RAIL_COLLAPSED.replace("w-", "")) * 4;
    expect(collapsedPx).toBe(56);
    expect(RAIL_EXPANDED).toBe(`w-[${collapsedPx * 2.5}px]`);
    // ⚠ 260px WAS THE OLD VALUE — 4.6x, and more than half of a 510px window.
    expect(RAIL_EXPANDED).not.toContain("260");
  });

  it("truncates its rows instead of taking the width back", () => {
    expect(rail).toContain("overflow-x-hidden");
    expect(rail).toMatch(/truncate/);
  });
});

describe("the white panel SHRINKS, and so nothing is pushed off the window", () => {
  /** 🔒 *"When I expand … the right side just gets completely cut off. The white panel gets
   *  completely cut off. … The white panel, the contents of the white panel, should be resizing. …
   *  Also … the top right, all of those things just get pushed out."* */
  it("is `min-w-0 flex-1` with no width of its own", () => {
    expect(INSET_PANEL).toContain("min-w-0");
    expect(INSET_PANEL).toContain("flex-1");
    expect(INSET_PANEL, "a fixed width cannot shrink").not.toMatch(/\bw-\[/);
  });

  /**
   * ⚠ **THE WHOLE CHAIN, WHICH IS THE ONLY FORM THIS CLAIM CAN TAKE.** A flex item's automatic
   * minimum size is its content's min-content width, so ONE ancestor without `min-w-0` pins the
   * whole window open and the root (`overflow: hidden`) clips instead. The panel already had its
   * link when the bug was reported.
   */
  it("has `min-w-0` on every link from the window's edge down to the panel", () => {
    expect(shell, "the shell column").toMatch(/flex min-h-0 min-w-0 flex-1 flex-col bg-home-panel/);
    expect(shell, "the rail+panel row").toMatch(/flex min-h-0 min-w-0 flex-1 pb-3 pr-3/);
    // Both of the agent view's branches — the gone-state is the one view the window renders alone.
    expect(view.match(/flex min-h-0 min-w-0 flex-1 flex-col/g)?.length).toBe(2);
  });

  it("keeps the chrome's right-hand group out of the shrink — it is the thing that must stay", () => {
    const rightGroup = chrome.slice(chrome.indexOf("{status}") - 400, chrome.indexOf("{status}"));
    expect(rightGroup).toContain("shrink-0");
    // And the STRIP is what gives way: `min-w-0 flex-1` on the tablist.
    expect(chrome).toMatch(/role="tablist"[\s\S]{0,200}min-w-0 flex-1/);
  });
});

describe("a tab label and a rail row are one type recipe", () => {
  /** 🔒 *"For the font, I think it should be the smaller one. I like the left side's smaller
   *  padding."* */
  it("is `text-body`, regular — the row step, not the 14px heading face", () => {
    expect(AGENT_NAME_TEXT).toContain("text-body");
    expect(AGENT_NAME_TEXT).toContain("font-normal");
    // ⚠ `TEMPLATE_NAME_TEXT`'s `text-title` is the candidate he rejected here.
    expect(AGENT_NAME_TEXT).not.toContain("text-title");
    // ⚠ AND NO INK: an active tab and an idle one are two colours of one recipe.
    expect(AGENT_NAME_TEXT).not.toContain("text-text-");
  });

  it("is imported by BOTH the strip and the rail, and re-spelled by neither", () => {
    expect(chrome).toContain("AGENT_NAME_TEXT");
    expect(rail).toContain("AGENT_NAME_TEXT");
    expect(chrome, "the tab kept its own 12px size").not.toContain("text-small");
  });

  it("puts the tab on the rail's smaller padding", () => {
    // Both rows are `px-2`; the tab was `px-2.5`.
    expect(chrome).toMatch(/rounded-\[8px\] px-2 transition-colors/);
    expect(rail).toMatch(/px-2 py-1\.5/);
  });
});
