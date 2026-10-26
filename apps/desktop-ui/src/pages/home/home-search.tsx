import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { SearchPopup } from "@/features/search/components/search-popup";
import { apiSearchFetcher } from "@/features/search/search-client";
import type { SearchItem } from "@/features/search/contracts";

const SEARCH_PILL =
  "white-card raise-pill flex h-9 w-[260px] cursor-text items-center gap-2 rounded-full px-3.5 text-text-muted";

/**
 * /home's search: an always-open pill whose results arrive in a popup; typing never narrows the
 * channel list. The query is the page's state. The popup is the pill's SIBLING so its containing
 * block is the header's positioned action group (`home-frame.tsx › HomeHeaderRow`), which makes
 * `left-0 right-0` pill-left to Profile-right; render this inside that group. Escape clears and
 * blurs, here for a closed popup and in the popup (on the window) for an open one.
 */
export function HomeSearch({
  query,
  onQueryChange,
  onNavigate,
  userId,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  /** Open what a result row names; on /home that is a selection plus a face, never a route. */
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

  return (
    <>
      <label className={SEARCH_PILL}>
        <Search size={14} strokeWidth={2} aria-hidden="true" />
        <input
          id="home-search-field"
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-small text-text-primary outline-none placeholder:text-text-muted"
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
      </label>
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
        fetcher={apiSearchFetcher}
        className="left-0 w-auto"
      />
    </>
  );
}
