import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NAV } from "@/shared/layout/app-shell/app-sidebar-core";
import { ChannelsSkeleton } from "#/pages/channels/channels-skeleton";
import {
  HomeIdentityPanelsSkeleton,
  HomeKnowledgePanelsSkeleton,
  HomePageSkeleton,
} from "#/pages/home/home-skeleton";
import { HOME_DEFAULT_TAB, HOME_TABS } from "#/pages/home/home-tabs";
// ⚠ THE WELL SET THE CHANNEL COLUMN'S GHOST MAPS (2026-09-22) — read, never re-typed.
import { HOME_CHANNEL_WELLS } from "#/pages/home/channel-wells";
import { HOME_CARD_FACE } from "@/shared/ui/home-card-marks";
import { AccountRailSkeleton, ShellChromeSkeleton } from "./shell-skeleton";
import { sectionSkeleton } from "./section-skeleton";

/**
 * THE APP FRAME'S LOADING STATES — the workspace shell's chrome, the boot cover
 * and /home's frame. ONE reason to change: those three ghosts are all built out
 * of `app-shell.module.css` + `account-rail.module.css`, so a restructure of the
 * frame moves all three and this file with them.
 *
 * ⚠ ITS OWN FILE, and the split is the 500-line cap (`eslint.config.mjs ›
 * max-lines`, an error over `apps/*​/src/**`): `page-skeletons.test.tsx` sat at
 * the cap, and one file per reason to change puts the SHELL's chrome here —
 * it changes when the app frame does — and the per-PAGE shapes there, where
 * they change when a page does. /home's geometry describe MOVED here with the
 * shell block on 2026-09-10, for the same reason: /home's ghost mounts
 * `shell.root` / `.body` / `.surface` itself, so it is a frame shape.
 *
 * Same two kinds of assertion that file uses, and for its reasons: a RENDER pin
 * for what a reader gets, and a SOURCE pin for geometry shared with the real
 * chrome — a CSS-module class is a build artifact and a Tailwind arbitrary value
 * is a string, so neither is comparable any other way, and a source scan is
 * BIDIRECTIONAL: it fails when the ghost drifts AND when the shell does.
 */
const file = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Source with comments stripped — these files EXPLAIN what they replaced, so a
 *  raw scan would fail on the very docblock recording the decision. */
const code = (rel: string) =>
  file(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SHELL_SKELETON = file("./shell-skeleton.tsx");
const HOME_SKELETON = file("../../pages/home/home-skeleton.tsx");
const APP_SHELL = code("../app-shell/app-shell.tsx");

function ghosts(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="skeleton"]');
}

/** Every visible string on the surface. A skeleton's only text is `sr-only`. */
function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".sr-only").forEach((node) => node.remove());
  return clone.textContent?.trim() ?? "";
}

/**
 * THE TWO STATES SAMUEL WAS LOOKING AT ON 2026-09-10 — cold open and workspace
 * switch — and they are the two that had no shape at all: both rendered
 * `PageLoading` inside a bare full-screen box, so the app's frame (rail, dark
 * ground, sidebar, page card) was torn down for the read and rebuilt after it.
 *
 * ⚠ THESE PINS ARE STRUCTURAL PARITY, NOT LOOK. What is asserted is that the
 * ghost composes the SAME boxes the loaded surface composes, in the same nesting
 * — so the resolve is a fade of contents rather than a re-layout — and that the
 * geometry the ghost invented is gone from BOTH files.
 */
describe("the shell's own loading state mirrors the shell", () => {
  /**
   * ⚠ THE SIX BOXES, READ OUT OF `app-shell.tsx` ITSELF. A CSS-module class is a
   * build artifact, so the comparable thing is the EXPRESSION; both files are
   * scanned, which makes the pin bidirectional — a restructure of the real shell
   * fails it just as loudly as a drift in the ghost.
   */
  it("composes the shell's own five boxes, class expression for class expression", () => {
    for (const box of [
      "className={shell.root}",
      "className={shell.body}",
      "className={shell.surface}",
      'cn("page-float", shell.panel)',
      "className={shell.pageCard}",
    ]) {
      expect(APP_SHELL).toContain(box.replace("shell.", "styles."));
      expect(SHELL_SKELETON).toContain(box);
    }
    // The sidebar is the core's box, and the ghost wears it directly.
    expect(SHELL_SKELETON).toContain("className={shell.sidebar}");
    expect(
      file("../../../../../src/shared/layout/app-shell/app-sidebar-core.tsx")
    ).toContain("className={styles.sidebar}");
  });

  /**
   * 🚫 THE INVENTED GEOMETRY IS GONE — a full-screen cover holding the generic
   * ghost's centred column was the whole of the old pending state.
   * ⚠ THE COVER SURVIVES ON THE ERROR BRANCH ONLY, deliberately: `PageError` is
   * text and a button, and it is not this file's `PageLoading` that is being
   * replaced there. So the pin is that `PageLoading` has NO caller left here.
   */
  it("no longer paints a bare full-screen cover while it loads", () => {
    expect(APP_SHELL).not.toContain("PageLoading");
    expect(APP_SHELL).toContain("<ShellChromeSkeleton");
    const { container } = render(
      <ShellChromeSkeleton>{sectionSkeleton("overview")}</ShellChromeSkeleton>
    );
    expect(container.querySelector(".max-w-\\[960px\\]")).toBeNull();
  });

  /**
   * ⚠ ONE `role="status"` FOR ONE LOAD. The chrome stands in `SkeletonChrome`
   * (the module class without the announcement) and the PAGE skeleton inside the
   * card brings the status region — nesting two would announce the same load
   * twice, and painting the chrome outside the module class would drop the
   * `prefers-reduced-motion` opt-out §1A requires.
   */
  it("announces once, drops its motion everywhere, and presses nothing", () => {
    const { container } = render(
      <ShellChromeSkeleton>{sectionSkeleton(null)}</ShellChromeSkeleton>
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(visibleText(container)).toBe("");
    // Every shimmering block stands inside a `skeleton-surface.module.css` surface.
    ghosts(container).forEach((node) => {
      expect(node.closest('[class*="surface"]')).not.toBeNull();
    });
  });

  /** ⚠ ONE ROW PER `NAV` ENTRY — the count is the real nav's, so a ninth
   *  section moves the ghost with it. */
  it("ghosts one sidebar row per real nav section", () => {
    const { container } = render(
      <ShellChromeSkeleton>{sectionSkeleton("channels")}</ShellChromeSkeleton>
    );
    // `.nav-chip` is the row recipe on both sides; the foot's Settings row wears
    // it too, which is why the expected count is NAV + 1.
    expect(container.querySelectorAll(".nav-chip")).toHaveLength(NAV.length + 1);
  });

  /**
   * ⚠ THE RAIL IS THE RAIL'S OWN MODULE. The 2026-08-28 /home ghost restated
   * `pt-[7px]` and silently stopped being the rail's shape when 2026-09-09 moved
   * that pad to `calc(--shell-gap-top + --page-float-gap-top)`; reading `.rail`,
   * `.tile` and `.workspaces` is what makes that impossible.
   */
  it("the rail ghost mounts account-rail's own classes, never restated numbers", () => {
    expect(SHELL_SKELETON).toContain(
      'import rail from "#/components/app-shell/account-rail.module.css"'
    );
    for (const cls of ["rail.rail", "rail.tile", "rail.workspaces"]) {
      expect(SHELL_SKELETON).toContain(cls);
    }
    expect(code("./shell-skeleton.tsx")).not.toContain("pt-[7px]");
    const { container } = render(<AccountRailSkeleton />);
    expect(container.querySelectorAll('[class*="tile"]')).toHaveLength(5);
  });

  /**
   * 🔒 **THE GHOST'S OWN BOXES ARE FLAT (Samuel, 2026-09-21: *"on the left side,
   * where the rails are for the channel, that is also elevated … we basically
   * just shouldn't have elevated components"*).** TWO boxes here had a raised
   * face — the brand pill (the `.auth-btn-3d-light` gradient, a 1px line and
   * four shadows) and the Pro card (`--home-card` over `--border-strong`) — and
   * both are stripped by an ATTRIBUTE rule, not by dropping their class: the
   * class is the only statement of their padding, radius and margin, and the
   * ghost restating those is the drift `pt-[7px]` already cost this file once.
   *
   * ⚠ THE FRAME IS NOT A SKELETON CONTAINER. `.root` / `.surface` / `.pageCard`
   * and the rail are the app's own chrome, on screen before and after the read;
   * the pin above already fixes them, and flattening them would tear the frame
   * down for the load — the defect this ghost exists to close.
   */
  it("strips the raised faces without restating an inset", () => {
    const { container } = render(
      <ShellChromeSkeleton>{sectionSkeleton("overview")}</ShellChromeSkeleton>
    );
    expect(container.querySelectorAll("[data-skeleton]")).toHaveLength(2);

    // BIDIRECTIONAL: the rule that flattens them lives with the real recipes,
    // gated on the attribute, so the LOADED sidebar is untouched.
    const shellCss = file(
      "../../../../../src/shared/layout/app-shell/app-shell.module.css"
    );
    expect(shellCss).toContain(".brandPill[data-skeleton]");
    expect(shellCss).toContain(".wordsCard[data-skeleton]");
    // 🚫 and the ghost still names no inset of its own.
    const ghost = code("./shell-skeleton.tsx");
    for (const inset of ["p-[18px]", "rounded-[10px]", "px-[10px]"]) {
      expect(ghost).not.toContain(inset);
    }
  });

  /**
   * ⚠ THE SWITCH GHOSTS THE PAGE IT IS HEADING FOR, off the same
   * `activeSectionFromPath` the nav highlights with — so the card under the
   * sidebar is the section's own shape and not a generic one.
   */
  it("picks the routed section's own skeleton", () => {
    expect(APP_SHELL).toContain(
      "sectionSkeleton(activeSectionFromPath(location.pathname))"
    );
    const CHANNELS = render(<>{sectionSkeleton("channels")}</>).container;
    expect(CHANNELS.innerHTML).toBe(
      render(<ChannelsSkeleton label="Opening workspace" />).container.innerHTML
    );
  });

  /**
   * ⚠ THE COLD OPEN IS /home's FRAME, because that is where a cold launch lands:
   * `/api/boot` with no segment answers the caller's personal container and boot
   * routes it to `HOME_PATH`. So the cover and /home's own pending gate paint the
   * SAME shape and the hand-off between them is invisible — where the white
   * `fixed inset-0` cover it replaced shared nothing with either.
   */
  it("the boot cover is /home's frame, not a white box", () => {
    const boot = code("../../pages/boot/index.tsx");
    expect(boot).toContain("<HomePageSkeleton");
    expect(boot).not.toContain("<PageLoading");
    // The error branch KEEPS the light cover: `PageError` is text and a button.
    expect(boot).toContain('className="fixed inset-0 z-50 flex bg-white"');
    expect(boot).toContain("<PageError");
  });
});

describe("the /home shapes are /home's own geometry", () => {
  /**
   * ⚠ TWO CELLS OF ONE VAR, NOT A COLUMN AND A PAD (2026-09-10). The header
   * stopped being `pl-[var(--home-list-w)]` on 2026-08-30, when the operator's
   * face moved into that column and the pad became a real `w-[…] px-3` CELL
   * holding it. The ghost still wore the pad, so its selector started one `px-3`
   * left of the real one and the avatar had no slot.
   */
  it("sizes the list column and the header cell from ONE width var", () => {
    const { container } = render(<HomePageSkeleton />);
    expect(
      container.querySelectorAll(".w-\\[var\\(--home-list-w\\)\\]")
    ).toHaveLength(2);
    // ⚠ `min-w-0` JOINED IT ON 2026-09-13, when the cell's content became
    // full-width, and it stayed on 2026-09-15 when the content became the SEARCH
    // FIELD (Samuel: "move the search bar at the top, to replace the Samuel's home
    // button on top of the channel picker"): without it the cell's content could
    // push the selector off the record pane's left edge, which is the one
    // alignment this cell is for.
    const CELL =
      'className="flex w-[var(--home-list-w)] min-w-0 shrink-0 items-center px-3"';
    expect(file("../../pages/home/home-header.tsx")).toContain(CELL);
    expect(HOME_SKELETON).toContain(CELL);
    // 🚫 THE PAD IS GONE, and that is half the pin: bidirectional.
    expect(code("../../pages/home/home-skeleton.tsx")).not.toContain(
      "pl-[var(--home-list-w)]"
    );
    // The generic page ghost's giveaway — a centred document column /home has
    // never had.
    expect(container.querySelector(".max-w-\\[960px\\]")).toBeNull();
  });

  /** ⚠ BYTE-SHARED WITH `index.tsx`'s OWN PANE, and the `flex-col` is why it is
   *  worth pinning: the real pane is a ROW holding one `Crossfade`, and the
   *  ghost carried a column for as long as it drew a 52px pane header the
   *  landing face does not have. */
  it("draws the record pane as the page's own bordered column", () => {
    const PANE =
      "mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] border-2 border-home-panel-line bg-home-card";
    expect(file("../../pages/home/index.tsx")).toContain(PANE);
    expect(HOME_SKELETON).toContain(PANE);
    const { container } = render(<HomePageSkeleton />);
    expect(container.querySelector(".border-home-panel-line")).not.toBeNull();
  });

  /** ⚠ ONE PILL PER `HOME_TABS` ENTRY — FIVE since the Ontology face landed
   *  (2026-09-09) and the ghost still drew four, in a `.seg-track` the control
   *  dropped on 2026-09-08 (Samuel: plain pills, no track). The count is read
   *  off the table, so a sixth face cannot leave the ghost behind. */
  it("ghosts one selector pill per face, without offering anything to press", () => {
    const { container } = render(<HomePageSkeleton />);
    expect(container.querySelector(".seg-track")).toBeNull();
    // ⚠ SCOPED TO THE HEADER STRIP (`.pr-5`, which only it wears) SINCE
    // 2026-09-13. The bare `.gap-1\.5` query counted the whole page, and the
    // channel-row ghost's second line is a `gap-1.5` row of peer faces now — so an
    // unscoped count reads 19 and says nothing about the selector.
    expect(
      container.querySelectorAll(".pr-5 .gap-1\\.5 > [data-slot=\"skeleton\"]")
    ).toHaveLength(HOME_TABS.length);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  /**
   * 🔒 **THE CHANNEL COLUMN GHOSTS THE THREE GRAY WELLS, ONE PER
   * `HOME_CHANNEL_WELLS` ENTRY (Samuel, 2026-09-22):** *"it doesn't include the
   * gray boxes for Pin[ned], Recent and Earlier. It also doesn't include any
   * component or skeleton for an actual channel. It just looks like little things
   * are directly on the background color, which is bad."*
   *
   * ⚠ **THE SET IS READ, NOT RE-TYPED** — same argument as the selector pills
   * above: a fourth well or a renamed one moves the ghost with it.
   * ⚠ **STILL NOTHING TO PRESS** (the assertion above covers it for the whole
   * page): the loaded well's header is a real `<button>` and the ghost's is a box.
   * ⚠ **A GRAY FILL IS NOT ELEVATION** — the well wears the loaded column's own
   * `PANEL_WELL_ON_PANEL`, which has no hairline and no shadow, and the rows inside
   * stand on the flat `bg-home-card` rather than on `HOME_CARD_FACE`'s gradient.
   * That is the 2026-09-21 flatness ruling kept, and the second half of this pin.
   */
  it("ghosts one gray well per channel well, flat and inert", () => {
    const { container } = render(<HomePageSkeleton />);
    const wells = container.querySelectorAll("section.bg-\\[var\\(--seg-fill\\)\\]");
    expect(wells).toHaveLength(HOME_CHANNEL_WELLS.length);
    // The two OPEN wells draw rows; the closed one draws its header alone.
    expect(container.querySelectorAll(".bg-home-card.rounded-\\[14px\\]").length)
      .toBeGreaterThan(0);
    const ghost = file("../../pages/home/home-list-skeleton.tsx");
    expect(ghost).toContain('from "@/shared/ui/panel-well"');
    expect(ghost).toContain("HOME_CHANNEL_WELLS.map");
    // 🚫 BIDIRECTIONAL: the raised row face stays on the PAGE and out of the ghost.
    // ⚠ COMMENT-STRIPPED, on this suite's stated rule — the ghost's docblock NAMES
    // the face it does not wear, and a raw scan would make the repair "delete the
    // explanation".
    const ghostCode = code("../../pages/home/home-list-skeleton.tsx");
    expect(ghostCode).not.toContain("HOME_CARD_FACE");
    expect(ghostCode).not.toContain("auth-btn-3d");
    expect(code("../../../../../src/shared/ui/home-channel-row.tsx")).toContain(
      "HOME_CARD_FACE"
    );
    expect(HOME_CARD_FACE).toContain("auth-btn-3d");
  });

  /** ⚠ THE LANDING FACE IS OVERVIEW (`home-tabs.ts › HOME_DEFAULT_TAB`), so the
   *  ghost's pane is Overview's — TWO `.bento` Usage cards (the bar, then the plot
   *  at the real plot height) over the 2×2 rails. It ghosted the CHANNELS face (a
   *  pane header over `TranscriptSkeleton`) for nine days after the page stopped
   *  landing there.
   *  ⚠ BIDIRECTIONAL: the strings are read out of `overview-panels.tsx`.
   *  ⚠ **`"bento flex flex-col gap-4 p-3.5"` WAS ON THIS LIST UNTIL 2026-09-13**,
   *  when Samuel split the one Usage card into two — the shared string is the
   *  histogram card's `"bento flex flex-col p-3.5"` and the `gap-3` between them
   *  now, and the bar's card is `"bento p-3.5"` on both sides. */
  it("ghosts the face the page actually opens on", () => {
    expect(HOME_DEFAULT_TAB).toBe("overview");
    // ⚠ The rail ghost MOVED to `#/components/overview/rank-rail.tsx ›
    // RailsGhost` on 2026-09-17 (both Overviews had a byte-identical copy), so
    // its card size is pinned against THAT file — the scan stays bidirectional.
    const panels =
      file("../../pages/home/overview-panels.tsx") +
      file("../overview/rank-rail.tsx");
    // ⚠ GEOMETRY ONLY SINCE 2026-09-21 — see the FACE block below. The two
    // `.bento` strings left this list when the ghost stopped drawing a face;
    // what the two sides still share is the column, the grid and the rail size.
    for (const shared of [
      'className="flex flex-col gap-3"',
      'className="grid grid-cols-2 gap-3"',
      'className="h-40 rounded-[14px]"',
    ]) {
      expect(panels).toContain(shared);
      expect(HOME_SKELETON).toContain(shared);
    }
    // 🔒 THE FACE IS THE PAGE'S ALONE (Samuel, 2026-09-21: the skeletons are
    // FLAT — *"we basically just shouldn't have elevated components"*). The two
    // Usage cards keep `.bento` on the PAGE and the ghost wears
    // `home-skeleton.tsx › GHOST_FLAT_FACE`, so this pins the split in BOTH
    // directions: parity here would re-elevate the loading state, and a bare
    // `rounded-[14px]` on the ghost would drop the 1px border box and pull every
    // block inside in by a pixel.
    for (const face of ['"bento p-3.5"', '"bento flex flex-col p-3.5"']) {
      expect(panels).toContain(face);
      expect(HOME_SKELETON).not.toContain(face);
    }
    // ⚠ **THE CONSTANT MOVED TO `home-ghost-face.ts` ON 2026-09-22** — a §1 split,
    // because the channel-column ghost left `home-skeleton.tsx` the same day and
    // both wear this face; a constant in either file would have the other importing
    // THROUGH it. The pin follows the split and is otherwise unchanged: the face is
    // still spelled ONCE, and the frame ghost still reads it rather than re-typing
    // a `rounded-[14px]` of its own.
    expect(file("../../pages/home/home-ghost-face.ts")).toContain(
      'export const GHOST_FLAT_FACE = "rounded-[14px] border border-transparent"'
    );
    expect(HOME_SKELETON).toContain(
      'import { GHOST_FLAT_FACE } from "./home-ghost-face"'
    );
    // The plot height is IMPORTED, the way the Overview page's ghost takes it.
    expect(HOME_SKELETON).toContain(
      'import { PLOT_HEIGHT_CLASS } from "#/components/charts/bar-series"'
    );
    expect(code("../../pages/home/home-skeleton.tsx")).not.toContain(
      "TranscriptSkeleton"
    );
  });

  it("keeps both faces on the panel hook the record pane repaints through", () => {
    for (const el of [
      <HomeKnowledgePanelsSkeleton key="k" />,
      <HomeIdentityPanelsSkeleton key="a" />,
    ]) {
      const { container } = render(el);
      expect(container.querySelectorAll("[data-section-panel]")).toHaveLength(2);
    }
  });
});
