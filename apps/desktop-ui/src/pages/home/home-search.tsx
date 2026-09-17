import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { SearchPopup } from "@/features/search/components/search-popup";
import { apiSearchFetcher } from "@/features/search/search-client";
import type { SearchItem } from "@/features/search/contracts";

/**
 * Home's search — the landing nav's pill at app scale (kit: `.search-expand*`),
 * **ALWAYS OPEN** (Samuel, 2026-09-13), and **THE SEARCH POPUP'S HOST SINCE
 * 2026-09-17**.
 *
 * 🔒 **TYPING NO LONGER NARROWS THE CHANNEL LIST (Samuel, 2026-09-17:** *"right
 * now, during search, it just filters by channel name, and it like removes
 * channel on the left sidebar. that doesnt make sense, it should be a pop up
 * like this."*). The page's `visibleRows` narrowing and the list's "No matches"
 * line are DELETED, not disarmed; the left column is what it always is and the
 * answer arrives in a card under this pill.
 *
 * ⚠ **THE QUERY IS STILL THE PAGE'S**, though nothing but this pill reads it
 * now: the field is a page control and the page owns its state, the same as the
 * face and the selection. Moving it in here would put one control's state in two
 * places the day anything else wants to read it.
 *
 * ⚠ **THE POPUP IS A CHILD OF `.search-expand`, WHICH IS `position: relative`**
 * — that is what puts the card's right edge on the pill's with a plain
 * `right-0`, rather than on a measurement.
 *
 * ⚠ **ESCAPE CLEARS AND BLURS** — here for a closed popup, and in the popup for
 * an open one (its handler is on the WINDOW, because the caret never leaves this
 * input). Both land on the same `close`.
 *
 * ⚠ **A PAGE CONTROL AT ITS OWN FIXED WIDTH (Samuel, 2026-09-15: "And move the
 * search bar back").** The `[data-fill]` variant is DELETED from both kit
 * copies; put it back only with a caller.
 */
export function HomeSearch({
  query,
  onQueryChange,
  onNavigate,
  userId,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  /** Open the thing a result row names — the PAGE's job (`index.tsx`), because
   *  a /home jump is a selection plus a face, never a route. */
  onNavigate: (item: SearchItem) => void;
  userId?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);

  const close = () => {
    onQueryChange("");
    setFocused(false);
    inputRef.current?.blur();
  };

  // ⚠ ALWAYS EXPANDED, NO GROW ANIMATION (Samuel, 2026-09-13: "remove the
  // expanding animation, just have the bar always be expanded fixed. Instead of
  // it saying Search people, just have it say Search..."). The kit's
  // `.search-expand` keeps its open face at a FIXED 260px; the round toggle is
  // gone — the glyph is decoration and the field is always reachable.
  return (
    <div className="search-expand" data-open="true">
      <div className="auth-btn-3d-light search-expand-shell">
        <span className="search-expand-toggle" aria-hidden="true">
          <Search size={15} strokeWidth={2} />
        </span>
        <input
          id="home-search-field"
          ref={inputRef}
          className="search-expand-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search…"
          aria-label="Search"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            close();
          }}
        />
      </div>
      <SearchPopup
        query={query}
        focused={focused}
        scope="account"
        onNavigate={onNavigate}
        onClose={close}
        onQueryChange={(next) => {
          onQueryChange(next);
          inputRef.current?.focus();
        }}
        userId={userId}
        /* ⚠ **THE REAL ENDPOINT SINCE 2026-09-17**, when `feat/search-api`
           merged — `GET /api/search?scope=account`. It spent one afternoon on
           `search-fixtures.ts › fixtureSearchFetcher` so the card could be
           reviewed before the route existed; that table is TEST AND DEV DATA
           now, and swapping back is the same one import. */
        fetcher={apiSearchFetcher}
      />
    </div>
  );
}
