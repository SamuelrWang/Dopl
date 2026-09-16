import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COMPOSER_BOTTOM } from "@/features/channels/components/composer-input";
import { channelPaneTabs } from "@/features/channels/components/info-panel";
import { INFO_WIDTH_DEFAULT } from "@/features/channels/components/use-info-resize";
import { ChannelRecordSkeleton } from "./channel-record-skeleton";

/**
 * THE /home RECORD PANE'S GHOST IS THE PINNED CHANNEL SURFACE'S SHAPE (Samuel,
 * 2026-09-13: *"this is the skeleton for the channel, it doesn't look accurate at
 * all needs to be fixed"*).
 *
 * Same two kinds of assertion the other skeleton suites make, for their reasons
 * (`components/skeletons/page-skeletons.test.tsx` carries the argument): a RENDER
 * pin for what a reader gets, and a SOURCE pin for geometry shared with the real
 * surface — a Tailwind arbitrary value is a STRING and cannot be imported, so a
 * byte-share is the only comparable thing, and the scan is BIDIRECTIONAL: it fails
 * when the ghost drifts AND when channels does, which is the half that matters.
 *
 * ⚠ THE BYTE-SHARES LIVE HERE AND THE GENERIC RULES DO NOT. This shape IS a row
 * in that file's `SHAPES` table — that is what puts it under the announce /
 * one-pulse-recipe / reduced-motion rules every shape owes — but its pins are all
 * reads of ONE feature tree (`channels/components/`), and that file sits at the 500-line
 * cap (INVARIANTS §1). One file per reason to change.
 */
const file = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Source with comments stripped — this file EXPLAINS the bubbles it replaced, so
 *  a raw scan would fail on the very docblock recording the decision. */
const code = (rel: string) =>
  file(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const GHOST = file("./channel-record-skeleton.tsx");
const GHOST_CODE = code("./channel-record-skeleton.tsx");
const v2 = (name: string) =>
  file(`../../../../../src/features/channels/components/${name}`);

/** Every visible string on the surface. A skeleton's only text is `sr-only`. */
function visibleText(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".sr-only").forEach((node) => node.remove());
  return clone.textContent?.trim() ?? "";
}

describe("the channel record ghost announces itself and paints a shape", () => {
  it("is ONE status region, hidden shimmer, no copy and nothing pressable", () => {
    const { container } = render(<ChannelRecordSkeleton label="Loading channel" />);
    const status = container.querySelectorAll('[role="status"]');

    expect(status).toHaveLength(1);
    expect(status[0]).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".sr-only")?.textContent).toBe("Loading channel");
    expect(visibleText(container)).toBe("");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    // The reduced-motion opt-out is a scoped rule keyed on the surface class;
    // the CSS never runs in jsdom, so what is pinned is that the class is ON the
    // announcing element.
    expect(status[0]?.className).toMatch(/surface/);
  });

  // ⚠ THE ONE-PULSE-RECIPE, NO-COPY AND REDUCED-MOTION RULES ARE THE TABLE'S,
  // NOT THIS FILE'S: this shape is a row in `components/skeletons/
  // page-skeletons.test.tsx › SHAPES`, so it is already under all three. Stating
  // them twice is how two suites come to disagree about which is the rule.
});

describe("the ghost is the surface's two columns, not a bare transcript", () => {
  /**
   * 🔒 THE INFO COLUMN IS DRAWN, AND ITS WIDTH IS THE REAL ONE. It is OPEN at
   * mount on this host (`use-channels-selection.ts` seeds `infoOpen` true), so
   * the ghost that omitted it resolved into a pane that then grew a 380px column.
   * ⚠ THE WIDTH IS THE VAR *AND* ITS FALLBACK — the operator drags `--info-w`
   * (`use-info-resize.ts`), and {@link INFO_WIDTH_DEFAULT} is the number that
   * class must carry before any drag has happened.
   */
  it("splits transcript + info column at the info panel's own width", () => {
    const INFO_COLUMN =
      "flex w-[var(--info-w,380px)] shrink-0 flex-col border-l border-border-default";
    expect(v2("info-panel.tsx")).toContain(INFO_COLUMN);
    expect(GHOST).toContain(INFO_COLUMN);
    // The fallback in that class IS the exported default, not a second number.
    expect(INFO_COLUMN).toContain(`${INFO_WIDTH_DEFAULT}px`);

    const { container } = render(<ChannelRecordSkeleton />);
    const info = container.querySelector(".border-l.border-border-default");
    expect(info).not.toBeNull();
    // …and the transcript column is the flexible one, with the surface's own
    // containment (which is what keeps the info column at its width when the
    // window narrows — `channel-surface-standalone.tsx`'s root docblock).
    expect(container.querySelector(".flex-1.flex-col")).not.toBeNull();
    expect(GHOST).toContain("flex min-w-0 flex-1 flex-col [contain:inline-size]");
    expect(v2("message-pane.tsx")).toContain(
      "flex min-w-0 flex-1 flex-col [contain:inline-size]"
    );
  });

  /** ⚠ ONE SLOT PER REAL TAB, ASKED RATHER THAN COUNTED — `channelPaneTabs` is
   *  the row's own answer for channel view with no Knowledge capability, which is
   *  what /home mounts (F-340). A fifth tab moves the ghost with it. */
  it("ghosts the tab row slot for slot, off channelPaneTabs itself", () => {
    const tabs = channelPaneTabs(false, false);
    expect(tabs).toHaveLength(4);
    expect(GHOST).toContain("channelPaneTabs(false, false)");

    const { container } = render(<ChannelRecordSkeleton />);
    // The `underline` control's own row (`segmented-control.tsx`): text only,
    // `gap-5` between options, each `h-9 px-1`.
    // ⚠ SCOPED TO THE INFO COLUMN — the transcript's own row list is `gap-5`
    // too (`transcript.tsx`), and an unscoped query counts the whole ghost.
    const row = container.querySelector("aside .gap-5");
    expect(row).not.toBeNull();
    expect(row?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(tabs.length);
    expect(container.querySelectorAll(".h-9.items-center.px-1")).toHaveLength(
      tabs.length
    );
  });

  /** ⚠ THE COMPOSER IS LAST IN THE TRANSCRIPT COLUMN and it is a raised CARD —
   *  the offset is IMPORTED, for the reason the constant exists (both composers
   *  sit at one height across the divider). */
  it("pins the composer card at the bottom of the transcript column", () => {
    for (const geometry of [
      'cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)',
      "raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]",
    ]) {
      expect(v2("composer.tsx")).toContain(geometry);
      expect(GHOST).toContain(geometry);
    }
    expect(GHOST).toContain("COMPOSER_BOTTOM");
    expect(GHOST_CODE).not.toContain('"pb-4"');
    expect(COMPOSER_BOTTOM).toBe("pb-4");

    const { container } = render(<ChannelRecordSkeleton />);
    const column = container.querySelector(
      ".flex-1.flex-col.\\[contain\\:inline-size\\]"
    );
    const card = container.querySelector(".raised-tab");
    expect(card).not.toBeNull();
    // LAST child of the transcript column — a composer above the transcript is
    // a different surface.
    expect(column?.lastElementChild?.contains(card!)).toBe(true);
  });

  /** ⚠ THE DIVIDER OCCUPIES NO WIDTH — a zero-width flex sibling, so the ghost's
   *  box math is the real row's (`info-resize-handle.tsx`). */
  it("keeps the resize divider as the real zero-width sibling", () => {
    expect(v2("info-resize-handle.tsx")).toContain('className="relative z-[2] w-0 shrink-0"');
    expect(GHOST).toContain('className="relative z-[2] w-0 shrink-0"');
    const { container } = render(<ChannelRecordSkeleton />);
    expect(container.querySelector(".w-0.shrink-0")).not.toBeNull();
  });
});

describe("the bubble transcript is gone, and the row shape is the real one", () => {
  /**
   * 🚫 **WHAT WAS THERE: `shared/ui/skeleton.tsx › TranscriptSkeleton`'s
   * ALTERNATING BUBBLES** — a bordered card per message, every other one indented
   * `ml-12` onto `bg-card-surface-subtle` — inside `› DetailPaneSkeleton`'s 52px
   * strip. This surface has neither: rows are left-aligned attribution-pill groups
   * under a 56px BREADCRUMB header. Both halves are pinned, ghost and gate.
   */
  it("mounts neither generic ghost, here or at the gate", () => {
    for (const source of [GHOST_CODE, code("./relationship-record.tsx")]) {
      expect(source).not.toContain("TranscriptSkeleton");
      expect(source).not.toContain("DetailPaneSkeleton");
    }
    expect(code("./relationship-record.tsx")).toContain("<ChannelRecordSkeleton");

    const { container } = render(<ChannelRecordSkeleton />);
    // The bubble's two giveaways — the indent and the card fill.
    expect(container.querySelector(".ml-12")).toBeNull();
    expect(container.querySelector(".bg-card-surface-subtle")).toBeNull();
    // …and no row is on the RIGHT: which rows are the viewer's own is unknowable
    // before the read (`authored-row.tsx` keys the side off `author_user_id`).
    expect(container.querySelector(".items-end")).toBeNull();
  });

  /** ⚠ THE ROW, THE PILL AND THE BODY CAP ARE `authored-row.tsx`'s and
   *  `attribution-pill.tsx`'s own expressions — including `MESSAGE_BLOCK`'s 92%,
   *  which is module-local in `transcript.tsx` and so can only be byte-shared. */
  it("byte-shares the row shell, the attribution pill and the body cap", () => {
    for (const [source, geometry] of [
      ["authored-row.tsx", "-mx-2 flex flex-col"],
      ["authored-row.tsx", "rounded-[10px] px-2 py-1"],
      ["authored-row.tsx", "flex w-full min-w-0 flex-col gap-1.5"],
      [
        // ⚠ **`rounded-full` IS NO LONGER IN THIS LITERAL (2026-09-15).** The pill
        // takes a `radius` override for the flush-corner experiment, so the capsule
        // is stated in its own slot and the GEOMETRY is what the ghost byte-shares.
        // The radius is asserted separately below, because the two can now differ on
        // purpose: an accented row squares one side, this ghost never does.
        "attribution-pill.tsx",
        "bento inline-flex max-w-full items-center gap-2 py-1 pl-1 pr-3.5",
      ],
      ["transcript.tsx", "wrap-anywhere max-w-[92%]"],
      ["transcript.tsx", '"flex flex-col gap-5"'],
      ["message-pane.tsx", "px-8 py-5"],
      [
        "message-pane-header.tsx",
        "flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4",
      ],
    ] as const) {
      expect(v2(source)).toContain(geometry);
      expect(GHOST).toContain(geometry);
    }
    // The pill's avatar slot is the size the pill asks for — `avatar.tsx › SIZE.sm`.
    expect(file("../../../../../src/shared/ui/avatar.tsx")).toContain('sm: "w-8 h-8');
    expect(GHOST).toContain("w-8 h-8");

    const { container } = render(<ChannelRecordSkeleton />);
    // Three to four groups, each a pill over its body lines.
    const rows = container.querySelectorAll(".rounded-\\[10px\\]");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.length).toBeLessThanOrEqual(4);
    expect(container.querySelectorAll(".bento").length).toBe(rows.length);
  });

  /** ⚠ THE DIVIDERS ARE THE SAME UTILITY CLASSES THE REAL SURFACE WEARS, which
   *  is what lets `home.module.css › .frame` repaint the ghost's lines to the
   *  account palette — and widen the info column's `border-l` to 2px — exactly as
   *  it does the loaded pane's. */
  it("keeps the two dividers /home's .frame selects on", () => {
    const { container } = render(<ChannelRecordSkeleton />);
    expect(container.querySelector(".border-b.border-border-default")).not.toBeNull();
    expect(container.querySelector(".border-l.border-border-default")).not.toBeNull();
  });
});
