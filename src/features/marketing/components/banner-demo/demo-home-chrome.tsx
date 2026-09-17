"use client";

/**
 * The banner demo's /home CHROME — the account rail, the gray panel's header
 * strip and the 290px channel column that frame the record pane.
 *
 * ⚠ **IT COMPOSES THE PRODUCT'S OWN RECIPES; IT DOES NOT COPY THEM.** /home
 * itself lives in a DIFFERENT APP — `apps/desktop-ui/src/pages/home/` and
 * `apps/desktop-ui/src/components/app-shell/account-rail.tsx` resolve `#/*`
 * against the SPA's own src, and the root `tsconfig.json` excludes `apps`
 * outright — so this file cannot mount those PAGES. What it can do, and does, is
 * read every piece of them that was moved into the root tree for exactly this
 * reason (2026-09-17):
 *
 *   - the header's two black pills — `shared/ui/page-action-button.ts ›
 *     PAGE_ACTION_BTN`, the class list "New channel" and "Profile" wear;
 *   - the face selector's options — `features/home/tabs.ts › HOME_TABS`, so a
 *     renamed or a sixth face reaches this scene without an edit;
 *   - the channel column's three gray wells — `channels/components/collapse-wells.tsx ›
 *     WellsColumn` over `channels/components/home-channel-wells.ts ›
 *     HOME_CHANNEL_WELLS`, at `shared/ui/panel-well.ts › PANEL_WELL_ON_PANEL`;
 *   - the ROW — `shared/ui/home-channel-row.tsx › HomeChannelRow`, the same
 *     component `relationship-list.tsx` renders.
 *
 * ⚠ **WHICH MAKES THE TOKEN DISCIPLINE THE REST OF IT.** Nothing below picks a
 * colour, a radius or a type size: the frame ink, the panel gray, the card white
 * and the panel line are `globals.css › THE APP FRAME PALETTE` (the same four
 * values `apps/desktop-ui/src/styles/tokens.css` carries), the faces are the
 * kit's `.auth-btn-3d-light` / `.raised-tab` / `.search-expand*`, and
 * `SegmentedControl`, `Avatar` and `WorkspaceGlyph` are the SHARED primitives
 * the real page mounts. Geometry that has no token — the 54px rail, the 40px
 * tile — is in `marketing.css` beside its source reference.
 *
 * 🚫 **NOTHING HERE IS PRESSABLE.** The slot is decorative and `aria-hidden`
 * (`banner-demo.tsx`), so every control that is a `<button>` on the real page is
 * a `<span>` here — same face, no focus stop inside a hidden subtree. The only
 * real buttons in the scene are inside the RECORD PANE, which is the product's
 * own surface and is what the scripted cursor presses.
 *
 * Sources to keep this in step with, all read 2026-09-17:
 *   `apps/desktop-ui/src/pages/home/index.tsx`             — the frame
 *   `apps/desktop-ui/src/pages/home/home-header.tsx`       — the header strip
 *   `apps/desktop-ui/src/pages/home/home-search.tsx`       — the open pill
 *   `apps/desktop-ui/src/pages/home/relationship-list.tsx` — the column
 *   `apps/desktop-ui/src/components/app-shell/account-rail.{tsx,module.css}`
 */

import { useMemo } from "react";
import { Plus, Search } from "lucide-react";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { WorkspaceGlyph } from "@/shared/layout/app-shell/workspace-switcher-core";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { PANEL_WELL_ON_PANEL } from "@/shared/ui/panel-well";
import { HomeChannelRow } from "@/shared/ui/home-channel-row";
import { HOME_TABS, type HomeTab } from "@/features/home/tabs";
import {
  WellsColumn,
  type WellItem,
} from "@/features/channels/components/collapse-wells";
import {
  HOME_CHANNEL_WELLS,
  type HomeChannelWellId,
} from "@/features/channels/components/home-channel-wells";
import type { HomeRowMock } from "./demo-home-rows";

const NOOP = () => {};

/**
 * The ACCOUNT rail — Home pinned top and selected, workspace tiles under it,
 * create at the end (`account-rail.tsx`). Home is the active tile because /home
 * is the surface on screen, so it wears the kit's `.raised-tab` exactly as the
 * real one does.
 */
export function DemoAccountRail() {
  return (
    <nav className="lp-demo-rail" aria-label="Account">
      <span className="lp-demo-rail-tile raised-tab">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicons/android-chrome-512x512.png"
          alt=""
          className="lp-demo-rail-mark"
          draggable={false}
        />
      </span>
      {/* ⚠ The account/container break is 4px of RHYTHM and no rule — the
          divider that used to sit here is deleted (`account-rail.module.css`);
          the only line in this rail belongs to the selected tile. */}
      <div className="lp-demo-rail-group">
        {["Northwind", "Vermillion", "Lattice"].map((name) => (
          <span key={name} className="lp-demo-rail-tile">
            <WorkspaceGlyph name={name} iconUrl={null} size="md" />
          </span>
        ))}
      </div>
      <span className="lp-demo-rail-tile lp-demo-rail-create">
        <Plus size={18} strokeWidth={1.8} />
      </span>
    </nav>
  );
}

/**
 * The panel's header strip — `home-header.tsx`, control for control.
 *
 * ⚠ **"New channel" HEADS THE LIST COLUMN (Samuel, 2026-09-15:** *"move the new
 * channel button to be where the search bar now is. It will be left aligned
 * basically. And move the search bar back"*). The cell is exactly
 * `--home-list-w` wide, so the pill's LEFT edge lands on the channel rows' and
 * the selector's left edge lands on the record pane's — one number for both.
 * ⚠ **LEFT-ALIGNED, NOT STRETCHED** — the pill hugs its label; no `w-full`.
 *
 * ⚠ **THE SELECTOR IS PLAIN PILLS AT 36px, SEMIBOLD** (Samuel, 2026-09-08), and
 * its options are `HOME_TABS` itself rather than a marketing list — the scene
 * names the same five faces the product does, in the same order.
 *
 * ⚠ **THE SCENE NEVER LEAVES Channel** — the selector NAMES the surface here, it
 * does not drive it (the timeline owns every state change in the demo).
 */
export function DemoHomeHeader() {
  return (
    // ⚠ SYMMETRIC PADDING. The controls are one 36px row, centred in the strip.
    <div className="flex items-center justify-between gap-3 py-3 pr-5">
      <div className="flex min-w-0 items-center">
        <div className="flex w-[var(--home-list-w)] min-w-0 shrink-0 items-center px-3">
          <span className={PAGE_ACTION_BTN}>New channel</span>
        </div>
        <SegmentedControl<HomeTab>
          options={HOME_TABS}
          value="channels"
          onChange={NOOP}
          variant="plain"
          size="lg"
          weight="semibold"
        />
      </div>
      <div className="flex items-center gap-2.5">
        <DemoHomeSearch />
        {/* ⚠ **A BLACK PILL READING "Profile", LAST IN THE ROW (Samuel,
            2026-09-15)** — the page's only way into settings, and the ONE
            exception to "one primary action". `PAGE_ACTION_BTN` worn BARE: one
            word, no glyph (`home-settings-control.tsx`). */}
        <span className={PAGE_ACTION_BTN}>Profile</span>
      </div>
    </div>
  );
}

/**
 * The search pill — **ALWAYS OPEN, at the kit's fixed 260px** (Samuel,
 * 2026-09-13: *"remove the expanding animation, just have the bar always be
 * expanded fixed … just have it say Search…"*), which is what `home-search.tsx`
 * renders. This scene showed the CLOSED 36px face until 2026-09-17; the closed
 * state is still the kit's and still lives on `[data-open]`, it simply has no
 * renderer today.
 *
 * ⚠ **A `<span>` WHERE THE PAGE HAS AN `<input>`** — see the file's docblock: a
 * field inside an `aria-hidden` subtree is a focus stop nobody can see. The
 * placeholder ink is the kit's own `--text-muted`, stated by the utility rather
 * than by a `::placeholder` this element cannot have.
 */
function DemoHomeSearch() {
  return (
    <div className="search-expand" data-open="true">
      <div className="auth-btn-3d-light search-expand-shell">
        <span className="search-expand-toggle" aria-hidden="true">
          <Search size={15} strokeWidth={2} />
        </span>
        <span className="search-expand-input flex items-center text-text-muted">
          Search…
        </span>
      </div>
    </div>
  );
}

/**
 * The 290px channel column — **three collapsible gray wells since 2026-09-15**
 * (Samuel: *"one for Pinned, one for Recents … and Earlier"*), drawn by the
 * product's own `WellsColumn` over the product's own well set.
 *
 * ⚠ `PANEL_WELL_ON_PANEL` IS THE FILL AND THE REASON IS THIS SURFACE: the panel
 * under this column IS `--home-panel`, so the default `PANEL_WELL` would be gray
 * on the same gray (Samuel: *"there's no gray background on this at all"*).
 * ⚠ `showEmpty` — all three boxes are always drawn, because *"a **Pinned** box
 * you can see is how you learn there is a pin"*.
 */
export function DemoChannelList({
  rows,
  selectedId,
}: {
  rows: HomeRowMock[];
  selectedId: string;
}) {
  const filed = useMemo<WellItem<HomeChannelWellId>[]>(
    () =>
      rows.map((row) => ({
        key: row.id,
        well: row.well,
        node: (
          <HomeChannelRow
            row={row}
            selected={row.id === selectedId}
            onSelect={NOOP}
          />
        ),
      })),
    [rows, selectedId],
  );
  return (
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      {/* ⚠ `overflow-hidden` WHERE THE REAL COLUMN IS `overflow-y-auto` — there
          is nothing to scroll in a scripted scene and a scrollbar has no place
          in a decorative one. Everything else is the real column's own box. */}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 pt-1">
        <WellsColumn
          wells={HOME_CHANNEL_WELLS}
          items={filed}
          storageKey={DEMO_WELLS_KEY}
          face={PANEL_WELL_ON_PANEL}
          showEmpty
        />
      </div>
    </div>
  );
}

/**
 * ⚠ **THE DEMO'S OWN `localStorage` KEY, NOT `HOME_CHANNEL_WELLS_KEY`.** Nothing
 * in this scene toggles a well, so the key is never written and the column
 * always opens on the SET's own defaults — Pinned and Recent open, Earlier
 * closed. Reading the product's key instead would let a returning operator's
 * saved posture change the height of a fixed-size marketing canvas.
 */
const DEMO_WELLS_KEY = "dopl.banner-demo.wells";
