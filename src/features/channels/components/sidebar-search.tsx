"use client";

/**
 * Channels — THE LEFT COLUMN'S SEARCH HEAD: the 52px strip, its toggle, the
 * field and the popup anchored under it.
 *
 * ⚠ **ITS OWN FILE SINCE WAVE 4, ON THE SEAM `sidebar-rows.tsx` ALREADY NAMED**
 * ("a LIST OF SECTIONS and a SET OF ROW FACES … those two change for different
 * reasons"). This is the sharpest slice of it: the strip is a SEARCH SURFACE
 * that happens to sit above a list. It owns three pieces of state (`open`,
 * `query`, `focused`) that no section, row or branch reads, and it changes when
 * SEARCH changes — which it did twice on 2026-09-17, once to delete the filter
 * and once to repoint the popup at the real endpoint. Neither edit was about
 * channels.
 * ⚠ **NOTHING ABOUT THE STRIP CHANGED IN THE SPLIT** — same markup, same state,
 * same props, same class expressions, pinned by suites that were already green.
 *
 * 🔒 **THE FIELD NARROWS NOTHING (Samuel, 2026-09-17:** *"right now, during
 * search, it just filters by channel name, and it like removes channel on the
 * left sidebar. that doesnt make sense, it should be a pop up like this."*). The
 * query is answered in a card under the field by the SAME component /home's
 * header pill hosts, at `scope="container"`. **Do not re-mint a `matches`
 * predicate here** — two answers to one query is the bug the popup replaced.
 */

import { useState } from "react";
import { Search } from "lucide-react";
import { SearchField } from "@/shared/ui/search-field";
import { SearchPopup } from "@/features/search/components/search-popup";
import { apiSearchFetcher } from "@/features/search/search-client";
import type { SearchItem } from "@/features/search/contracts";
import { IconButton } from "./bits";

export function SidebarSearchHeader({
  workspaceId,
  onNavigate,
}: {
  /** THE CONTAINER THE POPUP RUNS IN — `scope="container"` is this id. */
  workspaceId: string;
  onNavigate: (item: SearchItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  return (
    // ⚠ `relative` IS WHAT ANCHORS THE POPUP, exactly as `.search-expand`'s own
    // `position: relative` anchors /home's — the card is a child of the field's
    // row and lands on its edges with a plain `left-0 right-0`.
    <div className="relative flex h-[52px] shrink-0 items-center gap-2 px-3">
      {open ? (
        <SearchField
          value={query}
          onChange={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
          /* ⚠ **NOT "Filter channels" ANY MORE** — it filters nothing; it
              searches the workspace. */
          placeholder="Search"
          size="sm"
          className="min-w-0 flex-1"
        />
      ) : (
        <span className="flex-1" />
      )}
      <IconButton
        icon={Search}
        label="Search"
        active={open}
        onClick={() => {
          setOpen((was) => !was);
          setQuery("");
        }}
      />
      {open && (
        <SearchPopup
          query={query}
          focused={focused}
          scope="container"
          containerId={workspaceId}
          onNavigate={onNavigate}
          onClose={() => {
            setQuery("");
            setFocused(false);
          }}
          onQueryChange={setQuery}
          /* ⚠ **THE REAL ENDPOINT SINCE 2026-09-17**, when `feat/search-api`
             merged — `GET /api/search?scope=container&container=<id>`, which
             is the ONE thing this host passes that /home's does not. The
             fixture table it opened on is test and dev data now. */
          fetcher={apiSearchFetcher}
          /* ⚠ **THE PIN ONLY — THE WIDTH IS THE CARD'S OWN SINCE 2026-09-17**
             (`search-popup.tsx › SEARCH_CARD_W`, 280px). This read
             `!w-[420px]`, which is a second declaration of a width the card
             states for itself; the card came down a step and this copy would
             have kept the old one. The column is 260px and the card is
             slightly wider, so it stays pinned to the column's LEFT edge and
             opens into the page rather than off-screen. */
          className="!right-auto left-3"
        />
      )}
    </div>
  );
}
