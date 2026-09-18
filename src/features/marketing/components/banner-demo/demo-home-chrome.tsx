"use client";

/**
 * The banner demo's /home chrome: the account rail, the gray panel's header strip
 * and the 290px channel column that frame the record pane.
 *
 * It COMPOSES the product's own recipes rather than copying them. /home itself
 * lives in `apps/desktop-ui/`, which the root tree cannot import, so this mounts
 * the pieces that were moved into the root tree for exactly that reason:
 *   - `shared/ui/page-action-button.ts › PAGE_ACTION_BTN` (the header pills);
 *   - `features/home/tabs.ts › HOME_TABS` (the face selector's options, so a
 *     renamed or sixth face reaches this scene without an edit);
 *   - `channels/components/collapse-wells.tsx › WellsColumn` over
 *     `channels/components/home-channel-wells.ts › HOME_CHANNEL_WELLS`, at
 *     `shared/ui/panel-well.ts › PANEL_WELL_ON_PANEL`;
 *   - `shared/ui/home-channel-row.tsx › HomeChannelRow`, the same component
 *     `relationship-list.tsx` renders.
 *
 * Nothing below picks a colour, radius or type size — those are
 * `globals.css › THE APP FRAME PALETTE` and the kit's own faces. Geometry with no
 * token (the 54px rail, the 40px tile) is in `marketing.css`.
 *
 * Nothing here is pressable: the slot is decorative and `aria-hidden`, so every
 * control that is a `<button>` on the real page is a `<span>` here — same face,
 * no focus stop inside a hidden subtree. The only real buttons are inside the
 * record pane, which is the product's own surface.
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
 * The account rail — Home pinned top and selected, workspace tiles under it,
 * create at the end (`account-rail.tsx`).
 */
export function DemoAccountRail() {
  return (
    <nav className="lp-demo-rail" aria-label="Account">
      {/* (2026-09-09) The selected tile is the rail's own fill, not
          `.raised-tab`, whose bevel the product deleted. `.is-active` carries
          `--rail-tile-fill`. */}
      <span className="lp-demo-rail-tile is-active">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicons/android-chrome-512x512.png"
          alt=""
          className="lp-demo-rail-mark"
          draggable={false}
        />
      </span>
      {/* The account/container break is 4px of rhythm and no rule
          (`account-rail.module.css`); the only line belongs to the selected
          tile. */}
      <div className="lp-demo-rail-group">
        {/* (2026-09-17) Image tiles, not letter tiles: `WorkspaceGlyph` initials
            a workspace only when it has no icon, and every real one has one, so a
            rail of letters showed the product's fallback as its face. */}
        {DEMO_WORKSPACES.map((ws) => (
          <span key={ws.name} className="lp-demo-rail-tile">
            <WorkspaceGlyph name={ws.name} iconUrl={ws.iconUrl} size="md" />
          </span>
        ))}
      </div>
      {/* No `lp-demo-rail-create` hook: the product's create tile is `.tile` with
          a `Plus` in it and nothing else (`account-rail.module.css`). */}
      <span className="lp-demo-rail-tile">
        <Plus size={18} strokeWidth={1.8} />
      </span>
    </nav>
  );
}

/** The rail's workspace tiles. Every one has an icon — see the note above. */
const DEMO_WORKSPACES = [
  { name: "Northwind", iconUrl: "/img/dev-clouds.jpg" },
  { name: "Vermillion", iconUrl: "/img/framework-banner.jpg" },
  { name: "Lattice", iconUrl: "/img/site_thumbnail.jpg" },
] as const;

/**
 * The panel's header strip — `home-header.tsx`, control for control.
 *
 * (2026-09-15) "New channel" heads the list column, left-aligned and not
 * stretched. The cell is exactly `--home-list-w` wide, so the pill's left edge
 * lands on the channel rows' and the selector's on the record pane's.
 *
 * (2026-09-08) The selector is plain pills at 36px, semibold, and its options are
 * `HOME_TABS` itself rather than a marketing list.
 *
 * The scene never leaves Channel: the selector names the surface, the timeline
 * owns every state change.
 */
export function DemoHomeHeader() {
  return (
    // Symmetric padding: the controls are one 36px row, centred in the strip.
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
        {/* (2026-09-15) A black pill reading "Profile", last in the row — the
            page's only way into settings and the one exception to "one primary
            action". `PAGE_ACTION_BTN` worn bare: one word, no glyph. */}
        <span className={PAGE_ACTION_BTN}>Profile</span>
      </div>
    </div>
  );
}

/**
 * The search pill — (2026-09-13) always open at the kit's fixed 260px, which is
 * what `home-search.tsx` renders. The closed state is still the kit's and still
 * lives on `[data-open]`; it simply has no renderer here.
 *
 * A `<span>` where the page has an `<input>`: a field inside an `aria-hidden`
 * subtree is a focus stop nobody can see. The placeholder ink is stated by the
 * utility rather than a `::placeholder` this element cannot have.
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
 * The 290px channel column — (2026-09-15) three collapsible gray wells, drawn by
 * the product's own `WellsColumn` over the product's own well set.
 *
 * `PANEL_WELL_ON_PANEL` is the fill because the panel under this column IS
 * `--home-panel`, so the default `PANEL_WELL` would be gray on the same gray.
 * `showEmpty`: all three boxes always draw, because a visible Pinned box is how
 * you learn there is a pin.
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
      {/* `overflow-hidden` where the real column is `overflow-y-auto`: nothing
          scrolls in a scripted scene. Everything else is the real column's box. */}
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
 * The demo's own `localStorage` key, not `HOME_CHANNEL_WELLS_KEY`: reading the
 * product's would let a returning operator's saved posture change the height of a
 * fixed-size marketing canvas. Nothing here toggles a well, so it is never
 * written and the column opens on the set's own defaults.
 */
const DEMO_WELLS_KEY = "dopl.banner-demo.wells";
