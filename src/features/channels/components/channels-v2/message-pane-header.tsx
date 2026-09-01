"use client";

/**
 * THE CENTER COLUMN'S HEADER — breadcrumb, bookmark, pop-out slot, info toggle —
 * in both chromes.
 *
 * ⚠ SPLIT OUT OF `message-pane.tsx` ON 2026-09-01, at the 500-line cap, when the
 * transcript's scroll-up paging needed room in that file. Nothing inside changed
 * in the move; every ⚠ note below is that file's. It is called from
 * `message-pane.tsx` and nowhere else — the "one pane, one implementation"
 * argument that file makes is about a second PANE, not a second file.
 */

import type { ReactNode } from "react";
import { Bookmark, ChevronRight, Hash, PanelRight } from "lucide-react";
import { IconButton } from "./bits";

export function PaneHeader({
  channelName,
  threadTitle,
  infoOpen,
  favorited,
  popOut,
  chrome,
  onToggleInfo,
  onToggleFavorite,
  onExitThread,
}: {
  channelName: string;
  threadTitle: string | null;
  infoOpen: boolean;
  favorited: boolean;
  popOut?: ReactNode;
  chrome: "page" | "window";
  onToggleInfo: () => void;
  onToggleFavorite: () => void;
  onExitThread: () => void;
}) {
  // THE POP-OUT WINDOW'S HEADER: the crumb reduced to the thread's own title,
  // and nothing else. Every control the page header carries acts on something
  // this window does not have.
  if (chrome === "window") {
    return (
      <header className="flex h-[56px] shrink-0 items-center gap-1.5 border-b border-border-default px-4">
        <Hash size={14} className="shrink-0 text-text-muted" />
        <h1 className="truncate text-body font-semibold text-text-primary">
          {threadTitle ?? channelName}
        </h1>
      </header>
    );
  }

  return (
    <header className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4">
      <Hash size={14} className="shrink-0 text-text-muted" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
        {threadTitle === null ? (
          <span className="truncate text-body font-semibold text-text-primary">
            {channelName}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onExitThread}
              className="truncate rounded-[7px] px-1 py-0.5 text-body text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              {channelName}
            </button>
            <ChevronRight size={12} className="shrink-0 text-text-disabled" />
            <span className="truncate text-body font-semibold text-text-primary">
              {threadTitle}
            </span>
          </>
        )}
      </nav>
      {/* THE FAVOURITE TOGGLE. Stays with the crumb because it acts on what the
          crumb NAMES; the right-hand cluster acts on the pane.

          ⚠ THE LABEL NAMES THE CHANNEL, matching the knowledge card's wording
          family exactly (`knowledge-v2/home/base-card.tsx`: "Bookmark {name}" /
          "Remove bookmark from {name}") — one save affordance across the app
          means one sentence for it, and a screen-reader user in a thread needs
          the label to say WHICH thing gets bookmarked, since the crumb reads
          two. `aria-pressed` and the fill both come off the same boolean. */}
      <IconButton
        icon={Bookmark}
        label={
          favorited
            ? `Remove bookmark from ${channelName}`
            : `Bookmark ${channelName}`
        }
        size={14}
        className="h-6 w-6"
        active={favorited}
        filled={favorited}
        onClick={onToggleFavorite}
      />
      <span className="flex-1" />
      {/* THREAD VIEW ONLY — it pops out the open thread, and the channel view
          has none. Immediately LEFT of the info toggle, same `IconButton` face
          (Samuel, 2026-08-19); it was beside the crumb until then. */}
      {threadTitle !== null && popOut}
      {/* ⚠ A PANEL GLYPH, NOT AN `Info` (Samuel, 2026-08-24). The control opens
          and closes the column to its right, and `PanelRight` says that; the
          circle-i said "read about this channel", which is one tab of four
          inside it. **The LABEL stays "Channel info"** — three tests address
          this button by that name, and it is still what the column is.
          ⚠ AND IT WEARS NO BUTTON AT ALL (Samuel, 2026-08-25): `bare`, so no
          circle, no fill, no border, resting OR pressed — the glyph's colour is
          the whole affordance. **This replaced a /home-scoped 32px CIRCLE**
          (`pages/home/home.module.css`, keyed on this exact label), which is
          deleted: one control with one face on both surfaces, rather than a
          shared component and a per-page override of it. */}
      <IconButton
        icon={PanelRight}
        label="Channel info"
        bare
        active={infoOpen}
        onClick={onToggleInfo}
      />
    </header>
  );
}
