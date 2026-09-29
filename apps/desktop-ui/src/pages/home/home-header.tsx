import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { SearchItem } from "@/features/search/contracts";
import type { BootPayload } from "#/pages/boot/use-boot-state";
import { HomeSettingsControl } from "./home-settings-control";
import { HomeSearch } from "./home-search";
import { HOME_TABS, type HomeTab } from "./home-tabs";
import { PAGE_ACTION_BTN } from "./panel-buttons";

/**
 * /home's HEADER STRIP — the page's one primary action over the channel picker,
 * the four-face selector, search, and the operator's Profile pill.
 *
 * ⚠ ITS OWN FILE SINCE 2026-09-09 — `index.tsx` sits AT the 500-line cap
 * (`eslint.config.mjs › max-lines`, an error over `apps/*​/src/**`). This is
 * markup with one reason to change: what the strip HOLDS. No state lives here;
 * every value is still the page's.
 */
export function HomeHeader({
  identity,
  onWorkspaceChanged,
  tab,
  onTabChange,
  query,
  onQueryChange,
  onSearchNavigate,
  onNewChannel,
}: {
  identity: BootPayload;
  onWorkspaceChanged: () => void;
  tab: HomeTab;
  onTabChange: (next: HomeTab) => void;
  query: string;
  onQueryChange: (next: string) => void;
  /** A search-popup row was taken — the page opens what it names. */
  onSearchNavigate: (item: SearchItem) => void;
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
            search bar back").**
            ⚠ **LEFT-ALIGNED, NOT STRETCHED (Samuel's own word)** — the pill hugs
            its label (`PAGE_ACTION_BTN` is `px-[15px]`), so its LEFT edge lands on
            the channel rows'. **No `w-full`, `justify-center` or
            `justify-between`**: a stretched black pill reads as a banner over the
            column and a centred one aligns with nothing.
            ⚠ **THE CELL'S ONLY CHILD** — a second control here is a second thing
            claiming to head the channel picker.
            ⚠ `h-9` is this row's one control height, which is why the strip's
            height did not move; `min-w-0` or the content pushes the selector off
            the record pane's left edge, the one alignment this cell exists for.
            ⚠ **ONE PRIMARY ACTION, AND IT IS "New channel" (Samuel, 2026-08-25)**
            — about the PAGE, not this cell. The action group on the right has the
            one exception he made (Profile); a third is not licensed.
            ⚠ THE FACE IS `PAGE_ACTION_BTN` (2026-09-09), by reference. */}
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
      {/* ⚠ `relative` IS THE SEARCH POPUP'S ANCHOR (2026-09-29, Samuel: flush
          with the search bar on the left, with Profile on the right). The card
          is `left-0 right-0` of THIS box, which is exactly pill-left to
          Profile-right because those are its first and last children — so the
          group takes no padding, and nothing may be added before the pill or
          after Profile without moving the card's edges with it. */}
      <div className="relative flex items-center gap-2.5">
        {/* ⚠ **SEARCH IS BACK IN THIS GROUP (Samuel, 2026-09-15: "And move the
            search bar back")** — a PAGE control at its own fixed width, which is
            what its kit face is built for. The `[data-fill]` variant the one
            revision in the list column needed left the kit with it. */}
        {/* ⚠ **AND IT HOSTS THE SEARCH POPUP SINCE 2026-09-17** — since
            2026-09-29 the card hangs off THIS group, not the pill's own slot,
            so it spans the pill and Profile by construction. */}
        <HomeSearch
          query={query}
          onQueryChange={onQueryChange}
          onNavigate={onSearchNavigate}
          userId={identity.userId}
        />
        {/* ⚠ **THE OPERATOR'S CONTROL IS LAST IN THE ROW, A BLACK PILL READING
            "Profile" SINCE 2026-09-15 (Samuel: "turn the profile button to be
            black, and have it say Profile")** — and it is the ONLY way into
            settings from this page. `HomeSettingsControl` renders it: the modal
            and the `openHomeSettings` registry are its, and a control split from
            the thing it opens is two files to keep in step. */}
        <HomeSettingsControl
          identity={identity}
          onWorkspaceChanged={onWorkspaceChanged}
        />
      </div>
    </div>
  );
}
