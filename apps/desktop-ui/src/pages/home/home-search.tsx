import { useCallback, useEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const collapse = useCallback(
    (returnFocus = false) => {
      setOpen(false);
      onQueryChange("");
      if (returnFocus) toggleRef.current?.focus();
    },
    [onQueryChange]
  );

  /* Focus on grow-start, not animation-end — waiting eats first keystrokes. */
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  return (
    <div className="search-expand" data-open={open}>
      <div className="auth-btn-3d-light search-expand-shell">
        <button
          type="button"
          ref={toggleRef}
          className="search-expand-toggle"
          /* ⚠ NOT "Search people" — that is the INPUT's label, and two nodes
             with one accessible name inside one pill is an ambiguity for a
             screen reader and for every by-label query. */
          aria-label={open ? "Close search" : "Search"}
          aria-expanded={open}
          aria-controls="home-search-field"
          /* ⚠ Suppress the focus shift while open, else the input's blur
             collapses the pill a beat before this click reopens it. */
          onMouseDown={(event) => {
            if (open) event.preventDefault();
          }}
          onClick={() => (open ? collapse(true) : setOpen(true))}
        >
          {/* 15px — `site-nav.tsx`'s `<SearchIcon size={17} />` at the same
              6/7 the pill itself was scaled by. */}
          <Search size={15} strokeWidth={2} />
        </button>
        <input
          id="home-search-field"
          ref={inputRef}
          className="search-expand-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search people"
          aria-label="Search people"
          tabIndex={open ? 0 : -1}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            collapse(true);
          }}
          onBlur={() => {
            if (query.trim() === "") collapse();
          }}
        />
      </div>
    </div>
  );
}
