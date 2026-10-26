"use client";

import { useRef, useState } from "react";
import { Search } from "lucide-react";
import type { SearchItem } from "../contracts";
import type { SearchFetcher } from "../use-search";
import { SearchPopup } from "./search-popup";
import { Keycap } from "./search-popup-rows";

const SEARCH_PILL =
  "white-card raise-pill flex h-9 w-[260px] cursor-text items-center gap-2 rounded-full px-3.5 text-text-muted";

/**
 * /home's header search: an always-open pill whose results arrive in a popup; typing never
 * narrows the channel list. The query is the host's state. The popup is the pill's SIBLING so
 * its containing block is the header's positioned action group (desktop
 * `pages/home/home-frame.tsx › HomeHeaderRow`, the playground's `.uis-top-trail`): its floor is
 * that group, pill-left to Profile-right. Escape (the popup's, on the window) clears and blurs.
 */
export function HeaderSearch({
  query,
  onQueryChange,
  onNavigate,
  fetcher,
  userId,
  seedRecents,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  /** Open what a result row names; on /home that is a selection plus a face, never a route. */
  onNavigate: (item: SearchItem) => void;
  /** Must be stable — see `use-search.ts`. */
  fetcher: SearchFetcher;
  userId?: string;
  seedRecents?: readonly string[];
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
        />
        {focused && <Keycap>Esc</Keycap>}
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
        fetcher={fetcher}
        userId={userId}
        seedRecents={seedRecents}
        className="min-w-full"
      />
    </>
  );
}
