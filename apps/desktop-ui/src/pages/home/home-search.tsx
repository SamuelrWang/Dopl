import { useRef } from "react";
import { Search } from "lucide-react";

/**
 * Home's search — the landing nav's pill at app scale (kit: `.search-expand*`),
 * **ALWAYS OPEN** (Samuel, 2026-09-13).
 *
 * ⚠ **THE COLLAPSE IS GONE FROM THIS COMPONENT, NOT FROM THE KIT.** There is no
 * `open` state, no toggle button and no grow animation here; `.search-expand`
 * still has a 36px closed face, which the landing banner's chrome renders
 * (`marketing/…/banner-demo/demo-home-chrome.tsx`). Pinned by `home-search.test.ts`.
 *
 * ⚠ THE QUERY IS THE PAGE'S, not this component's. The page filters the
 * relationship rows AND resolves the record pane's selection from the same
 * filtered set — a query private to the search box would let the pane keep a
 * row the list had already dropped.
 *
 * ⚠ **ESCAPE CLEARS AND BLURS; NOTHING ELSE CLEARS.** With no collapse there is
 * no state a stale query could hide behind, so the old blur-clears-an-empty-field
 * rule went with the toggle — clicking away now keeps what was typed, which is
 * what a permanently visible field should do.
 */
export function HomeSearch({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (next: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

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
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onQueryChange("");
            inputRef.current?.blur();
          }}
        />
      </div>
    </div>
  );
}
