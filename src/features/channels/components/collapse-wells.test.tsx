// @vitest-environment jsdom
/**
 * THE WELL MACHINERY, AWAY FROM THE FOUR TIME SPANS (split 2026-09-15, when
 * /home's channel list asked for the box with a set that is **Pinned / Recent /
 * Earlier**).
 *
 * ⚠ **THIS SUITE DELIBERATELY DOES NOT RE-TEST THE COLLAPSE.** The chevron's one
 * rotation, the one-transition unmount, the `.collapse-grid` box and the
 * corrupt-write fallback are pinned once each, through a real surface, in
 * `agents-wells.test.tsx` and `threads-tab.test.tsx`. What is pinned HERE is the
 * two properties that only exist because the machinery is now general:
 *
 *  - **THE WELL SET IS THE CALLER'S, defaults included.** A second caller with a
 *    different set, different labels and TWO wells open by default has to work
 *    without touching this module.
 *  - **`face` VARIES THE FILL AND NOTHING ELSE.** Samuel retracted the `"tab"`
 *    variant the day it shipped (*"just make the gray dropdowns match exactly
 *    those instead"*) but kept the darker fill, because /home's column stands on
 *    the very token the default paints. So the assertion worth holding is that a
 *    second `face` is the SAME BOX — same header, same geometry — and that the
 *    default is still `PANEL_WELL` to the character.
 *  - **`showEmpty` DRAWS A WELL WITH NOTHING IN IT, AND IT DEFAULTS OFF.** *"I
 *    want there to be something there, like the gray box … but I still want it to
 *    be there"* is a ruling about /home's column; the two tabs keep hide-when-empty.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { PANEL_ROWS, PANEL_WELL, PANEL_WELL_ON_PANEL } from "@/shared/ui/panel-well";
import { SECTION_PANEL_SHELL } from "@/shared/ui/section-panel";
import { WellsColumn, type WellItem } from "./collapse-wells";
import type { WellSpec } from "./well-state";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** A set that is NOT the four recency spans: three wells, TWO open by default —
 *  /home's own shape (`pages/home/channel-wells.ts`), stated here as data. */
const SET: readonly WellSpec<"pinned" | "live" | "old">[] = [
  { id: "pinned", label: "Pinned", defaultOpen: true },
  { id: "live", label: "Live", defaultOpen: true },
  { id: "old", label: "Old", defaultOpen: false },
];

const ITEMS: WellItem<"pinned" | "live" | "old">[] = [
  { key: "p", well: "pinned", node: <p>papa</p> },
  { key: "l", well: "live", node: <p>lima</p> },
  { key: "o", well: "old", node: <p>oscar</p> },
];

function renderSet(
  items: readonly WellItem<"pinned" | "live" | "old">[] = ITEMS,
  face?: string
) {
  return render(
    <WellsColumn
      wells={SET}
      items={items}
      storageKey="dopl.test.generic"
      face={face}
    />
  );
}

describe("collapse-wells — the set is the caller's", () => {
  it("renders the caller's wells, in the caller's order, with the caller's defaults", () => {
    renderSet();
    expect(screen.queryAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Pinned",
      "Live",
      "Old",
    ]);
    // ⚠ TWO OPEN, which no hard-coded `{recent: true, …}` map could have produced.
    expect(screen.getByText("papa")).toBeTruthy();
    expect(screen.getByText("lima")).toBeTruthy();
    expect(screen.queryByText("oscar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Old" }));
    expect(screen.getByText("oscar")).toBeTruthy();
  });

  it("does not render a well with nothing in it", () => {
    renderSet([ITEMS[1]]);
    expect(screen.queryAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Live",
    ]);
  });

  it("files every item in exactly one well and never re-orders inside one", () => {
    renderSet([
      { key: "z", well: "live", node: <p>zulu</p> },
      { key: "y", well: "live", node: <p>yankee</p> },
    ]);
    const live = screen.getByRole("heading", { name: "Live" }).closest("section")!;
    expect(live.textContent).toBe("Livezuluyankee");
  });
});

describe("collapse-wells — `face` and `showEmpty`", () => {
  it("defaults to the Agents tab's well, to the character", () => {
    renderSet();
    const shell = screen.getByRole("heading", { name: "Live" }).closest("section")!;
    // ⚠ THE CONSTANT, not a copy of its current value — the same assertion both
    // tab suites make, restated here because this is the file that could break it.
    expect(shell.className).toBe(PANEL_WELL);
    const row = screen.getByRole("button", { name: "Live" });
    expect(row.className).toContain("w-full");
    // ⚠ THE HEADER IS INSIDE THE BOX and paints no fill of its own.
    expect(row.className).not.toContain("bg-");
    expect(within(shell).getByText("lima")).toBeTruthy();
  });

  it("swaps ONLY the fill on a `face` — same header, same geometry, same collapse", () => {
    renderSet(ITEMS, PANEL_WELL_ON_PANEL);
    const shell = screen.getByRole("heading", { name: "Live" }).closest("section")!;
    expect(shell.className).toBe(PANEL_WELL_ON_PANEL);
    // 🔒 **THE SHAPE IS UNCHANGED (Samuel, 2026-09-15: *"just make the gray
    // dropdowns match exactly those instead"*)** — the header row's class string
    // is the SAME one the default renders, and the box keeps the well's radius.
    const row = screen.getByRole("button", { name: "Live" });
    const other = render(
      <WellsColumn wells={SET} items={ITEMS} storageKey="dopl.test.face" />
    );
    const plain = within(other.container).getByRole("button", { name: "Live" });
    expect(row.className).toBe(plain.className);
    expect(PANEL_WELL_ON_PANEL).toContain("rounded-[14px]");
    // ⚠ AND IT IS A DIFFERENT FILL, or there was no reason to pass one.
    expect(PANEL_WELL_ON_PANEL).not.toContain("bg-home-panel");
    expect(PANEL_WELL).toContain("bg-home-panel");
  });

  it("hides an empty well by DEFAULT — the Agents and Threads rule, unchanged", () => {
    renderSet([ITEMS[1]]);
    expect(screen.queryAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Live",
    ]);
  });

  it("draws every well on `showEmpty`, with no placeholder copy in the empty ones", () => {
    render(
      <WellsColumn
        wells={SET}
        items={[ITEMS[1]]}
        storageKey="dopl.test.showempty"
        showEmpty
      />
    );
    expect(screen.queryAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Pinned",
      "Live",
      "Old",
    ]);
    // ⚠ A REAL BOX, not a bare heading…
    const pinned = screen.getByRole("heading", { name: "Pinned" }).closest("section")!;
    expect(pinned.className).toBe(PANEL_WELL);
    // …and NOTHING inside it but its own label (minimal copy, INVARIANTS §5).
    expect(pinned.textContent).toBe("Pinned");
    // ⚠ AND A CLOSED EMPTY WELL IS STILL DRAWN — `Old` is collapsed by default.
    const old = screen.getByRole("button", { name: "Old" });
    expect(old.getAttribute("aria-expanded")).toBe("false");
  });
});

/**
 * 🔒 **THE TWO THINGS SAMUEL SAW ON 2026-09-15, VERBATIM:** *"there are these like
 * weird vertical shadows/the shadows are being cut off. I'm also noticing that when
 * the gray box is retracted, the text isn't vertically centered."*
 *
 * ⚠ **BOTH ARE PINNED ON CLASS RECIPES, WHICH IS THE ONLY HONEST FORM HERE** —
 * jsdom lays nothing out, so a "the shadow is not clipped" assertion would be a
 * sentence about a renderer that never ran. What CAN be stated, and is what either
 * bug would have to break to come back, is (a) the clip box is wider than the
 * column by exactly the well's own padding and (b) an empty body carries no
 * padding of its own.
 */
describe("collapse-wells — the clip's bleed room and the empty body", () => {
  /** The animated clip box for one well. */
  function boxOf(label: string): HTMLElement {
    const row = screen.getByRole("button", { name: label });
    return row.parentElement!.querySelector<HTMLElement>(".collapse-grid")!;
  }
  /** The rows column inside it. */
  function columnOf(label: string): HTMLElement {
    return boxOf(label).firstElementChild as HTMLElement;
  }

  it("widens the CLIP BOX past the cards by exactly the well's own padding", () => {
    renderSet();
    // 🔒 *"the shadows are being cut off"* — `.collapse-grid` is `overflow:hidden`
    // and used to be exactly the cards' width, so every card's drop shadow was
    // sliced flush with its own edges.
    expect(boxOf("Live").className).toContain("-mx-3");
    // …and the column puts the cards back where they were, so nothing MOVED.
    expect(columnOf("Live").className).toContain("px-3");
    // ⚠ THE PAIR IS THE WELL'S OWN `p-3`, READ FROM THE GEOMETRY CONSTANT — 12px
    // out lands the clip on the well's BORDER box: past every shadow this
    // component holds (the hovered row's `0 10px 20px` reaches 10px sideways, the
    // `.bento` card's `0 6px 18px` 9px) and never outside the gray.
    expect(SECTION_PANEL_SHELL).toContain("p-3");
    // ⚠ AND THE COLUMN IS STILL THE WELL'S OWN ROW RECIPE, not a re-typed one.
    expect(columnOf("Live").className.startsWith(PANEL_ROWS)).toBe(true);
  });

  it("gives an EMPTY well no body padding — the header stays centered in the box", () => {
    render(
      <WellsColumn
        wells={SET}
        items={[ITEMS[1]]}
        storageKey="dopl.test.deadband"
        showEmpty
      />
    );
    // 🔒 *"when the gray box is retracted, the text isn't vertically centered"* —
    // with `box-sizing: border-box` a padded box cannot be shorter than its
    // padding, so an empty column stood 8px tall and hung a dead band under the
    // header.
    expect(columnOf("Pinned").className).not.toContain("pt-2");
    expect(columnOf("Pinned").textContent).toBe("");
    // ⚠ AND THE WELL THAT HAS ROWS STILL SEPARATES THEM FROM ITS HEADER — the
    // padding belongs to the content it separates, so this is the SAME assertion
    // in its other direction.
    expect(columnOf("Live").className).toContain("pt-2");
  });

  it("drops the body padding when a well closes, one transition late", async () => {
    renderSet();
    const row = screen.getByRole("button", { name: "Live" });
    expect(columnOf("Live").className).toContain("pt-2");

    fireEvent.click(row);
    // ⚠ STILL PADDED WHILE THE BOX SHRINKS — the cards are still mounted, and a
    // closing box with nothing inside it has no content to clip.
    expect(columnOf("Live").className).toContain("pt-2");
    // ⚠ AND GONE WITH THEM, so the collapsed well is `p-3` + header + `p-3`.
    await waitFor(() =>
      expect(columnOf("Live").className).not.toContain("pt-2")
    );
    expect(columnOf("Live").textContent).toBe("");
  });
});
