import { useRef } from "react";
import { Search } from "lucide-react";

/**
 * Home's people search — the landing nav's collapsing pill, at app scale
 * (kit: `.search-expand*`). Collapsed it is a round icon button; clicking it
 * grows the pill leftward and focuses the field.
 *
 * ⚠ THE QUERY IS THE PAGE'S, not this component's. The page filters the
 * relationship rows AND resolves the record pane's selection from the same
 * filtered set — a query private to the search box would let the pane keep a
 * row the list had already dropped.
 *
 * ⚠ Collapsing CLEARS the query, so a collapsed pill never hides an active
 * filter. Escape always collapses; blur only collapses an empty field, or
 * clicking away mid-search would throw the search away.
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
