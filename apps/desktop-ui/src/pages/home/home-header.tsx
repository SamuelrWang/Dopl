import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { BootPayload } from "#/pages/boot/use-boot-state";
import { HomeSettingsControl } from "./home-settings-control";
import { HomeSearch } from "./home-search";
import { HOME_TABS, type HomeTab } from "./home-tabs";
import { PAGE_ACTION_BTN } from "./panel-buttons";

/**
 * /home's HEADER STRIP — the operator's face, the four-face selector, search
 * and the page's one primary action.
 *
 * ⚠ ITS OWN FILE SINCE 2026-09-09, and the reason is the same one
 * `home-settings-control.tsx` gives: `index.tsx` sits AT the 500-line cap
 * (`eslint.config.mjs › max-lines`, an error over `apps/*​/src/**`), so the
 * selection rulings of that day could not be added to it. This is markup with
 * one reason to change — what the strip HOLDS — while the page changes when its
 * layout or its reads do. No state moved: every value here is still the page's.
 */
export function HomeHeader({
  identity,
  onWorkspaceChanged,
  tab,
  onTabChange,
  query,
  onQueryChange,
  onNewChannel,
}: {
  identity: BootPayload;
  onWorkspaceChanged: () => void;
  tab: HomeTab;
  onTabChange: (next: HomeTab) => void;
  query: string;
  onQueryChange: (next: string) => void;
  onNewChannel: () => void;
}) {
  return (
    // ⚠ SYMMETRIC PADDING. The controls are one 36px row and they sit CENTRED
    // in the strip.
    <div className="flex items-center justify-between gap-3 py-3 pr-5">
      {/* ⚠ THE LEFT PAD IS THE LIST COLUMN'S WIDTH, NOT A SPACER, AND IT BECAME
          A REAL CELL ON 2026-08-30. It puts the selector's left edge on the
          record pane's (Samuel, 2026-08-24) — same var the column is sized from
          (`home.module.css › .page`) — and the operator's face needed to live IN
          that column, so the pad is now a cell of exactly that width holding it.
          ⚠ THE TWO ARE ONE GROUP, or `justify-between` would spread three
          children and walk the selector off that edge. */}
      <div className="flex min-w-0 items-center">
        {/* ⚠ THE CELL IS UNCHANGED AND THE CONTROL INSIDE IT IS NOT (2026-09-13).
            `HomeSettingsControl` is a full-width BAR now — same card face as the
            channel rows, reading "{first name}'s Home" (Samuel: the bare face left
            "empty space [that] looks weird"). It is 36px like every other control
            in this strip, so this row's height did not move; the `px-3` is still
            the LIST's own inset, which is what puts the bar's edges on the rows'.
            ⚠ `min-w-0` on the cell, or a long name would push the selector off the
            record pane's left edge — the one alignment this cell exists for. */}
        <div className="flex w-[var(--home-list-w)] min-w-0 shrink-0 items-center px-3">
          <HomeSettingsControl
            identity={identity}
            onWorkspaceChanged={onWorkspaceChanged}
          />
        </div>
        {/* The selector REPLACES the page title. ⚠ PLAIN PILLS, semibold, 36px
            (`lg`) since 2026-09-08 — Samuel: "individual pills … unselected grayed
            out … text should be bolded"; not a track any more. */}
        <SegmentedControl<HomeTab>
          options={HOME_TABS}
          value={tab}
          onChange={onTabChange}
          variant="plain"
          size="lg"
          weight="semibold"
        />
      </div>
      <div className="flex items-center gap-2.5">
        <HomeSearch query={query} onQueryChange={onQueryChange} />
        {/* ⚠ ONE PRIMARY ACTION, AND IT IS "New channel" (Samuel, 2026-08-25).
            The mint popover was here as an interim while links were still
            page-level; it now lives on the channel it binds to
            (`person-info-tab.tsx`), because that is the thing it acts on. Do not
            put a second black pill back here.
            ⚠ THE FACE IS `PAGE_ACTION_BTN` (2026-09-09) — this button's own
            class list, extracted so the four /home section-create buttons could
            wear the SAME string rather than a copy of it. */}
        <button
          type="button"
          onClick={onNewChannel}
          className={PAGE_ACTION_BTN}
        >
          New channel
        </button>
      </div>
    </div>
  );
}
