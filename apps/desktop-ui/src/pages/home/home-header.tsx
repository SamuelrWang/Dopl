import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { BootPayload } from "#/pages/boot/use-boot-state";
import { HomeSettingsControl } from "./home-settings-control";
import { HomeSearch } from "./home-search";
import { HOME_TABS, type HomeTab } from "./home-tabs";
import { PAGE_ACTION_BTN } from "./panel-buttons";

/**
 * /home's HEADER STRIP — the page's one primary action over the channel picker,
 * the four-face selector, search, and the operator's own face.
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
          (`home.module.css › .page`) — and whatever heads that column lives IN
          the cell, not beside it.
          ⚠ THE TWO ARE ONE GROUP, or `justify-between` would spread three
          children and walk the selector off that edge. */}
      <div className="flex min-w-0 items-center">
        {/* ⚠ **THE CELL HOLDS "New channel" SINCE 2026-09-15 (Samuel, live
            review: "ok actually, move the new channel button to be where the
            search bar now is. It will be left aligned basically. And move the
            search bar back").** This cell has now held three things in three
            weeks — a bare avatar, a "{Name}'s Home" bar, the search field for one
            revision — and what it holds is the only thing that has changed: the
            cell, its width, its `px-3` and its `min-w-0` are untouched through all
            of it.
            ⚠ **LEFT-ALIGNED, NOT STRETCHED (Samuel's own word).** The pill hugs
            its label — `PAGE_ACTION_BTN` is `px-[15px]`, not `w-full` — and the
            cell's `flex` lays it out from the leading edge, so the button's LEFT
            edge lands on the channel rows' left edge and its right edge falls
            wherever "New channel" ends. Do not add `w-full`, `justify-center` or
            `justify-between` here: a stretched black pill reads as a banner over
            the column, and a centred one aligns with nothing.
            ⚠ **THE CELL'S ONLY CHILD.** A second control in here is a second
            thing claiming to head the channel picker.
            ⚠ **36px, WHICH IS WHY THE STRIP'S HEIGHT DID NOT MOVE** — `h-9` is
            this row's one control height, the same as the bar's and the field's
            before it.
            ⚠ `min-w-0` on the cell, or its content could push the selector off
            the record pane's left edge — the one alignment this cell exists for.
            ⚠ **ONE PRIMARY ACTION, AND IT IS "New channel" (Samuel, 2026-08-25).
            THAT RULING TRAVELLED WITH THE BUTTON AND IS ABOUT THE PAGE, NOT ABOUT
            THIS CELL.** The mint popover was beside it as an interim while links
            were still page-level; it now lives on the channel it binds to
            (`person-info-tab.tsx`), because that is the thing it acts on. Do not
            put a second black pill in this cell — and note the action group on
            the right now has one (Profile), which is the exception Samuel made,
            not a licence for a third.
            ⚠ THE FACE IS `PAGE_ACTION_BTN` (2026-09-09) — this button's own class
            list, extracted so the four /home section-create buttons could wear
            the SAME string rather than a copy of it. */}
        <div className="flex w-[var(--home-list-w)] min-w-0 shrink-0 items-center px-3">
          <button
            type="button"
            onClick={onNewChannel}
            className={PAGE_ACTION_BTN}
          >
            New channel
          </button>
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
        {/* ⚠ **SEARCH IS BACK IN THIS GROUP (Samuel, 2026-09-15: "And move the
            search bar back").** It headed the list column for one revision; at
            its own fixed width beside the selector it is a PAGE control again,
            which is what it was before and what its kit face is built for — the
            `[data-fill]` variant that revision needed is gone from the kit with
            it, since nothing else ever set the attribute. */}
        <HomeSearch query={query} onQueryChange={onQueryChange} />
        {/* ⚠ **THE OPERATOR'S FACE IS THE LAST THING IN THE ROW, AND IT IS A
            BLACK PILL READING "Profile" SINCE 2026-09-15 (Samuel: "turn the
            profile button to be black, and have it say Profile").** It was a white
            circle for one revision and a bar in the list column before that; what
            has never changed is that it is the ONLY way into settings from this
            page. `HomeSettingsControl` renders it, because the modal and the
            `openHomeSettings` registry are its and a control split from the thing
            it opens is two files to keep in step. */}
        <HomeSettingsControl
          identity={identity}
          onWorkspaceChanged={onWorkspaceChanged}
        />
      </div>
    </div>
  );
}
