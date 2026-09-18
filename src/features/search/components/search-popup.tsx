"use client";

/**
 * The search popup: one floating card under the header search field, holding a
 * text search across the whole space, split into sections.
 *
 * (2026-09-17) Samuel's rulings: a popup rather than sidebar filtering; sections
 * per kind; no Cmd-K and no scope toggle; one step smaller than it first shipped.
 *
 * One component, two hosts. The host contract is `{ scope, containerId?,
 * onNavigate }` and nothing about a host leaks in here — no router, no workspace
 * read, no page state.
 *
 * The field is the host's pill, so there is no input inside the card: two inputs
 * over one query is two places for the caret to be. Dismissal is shared — Escape
 * calls `onClose`, and outside-pointer dismissal belongs to the host, which is
 * the only side that knows where the pill ends.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock3, CornerDownLeft } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  SEARCH_MIN_QUERY_LENGTH,
  type SearchItem,
  type SearchScope,
} from "../contracts";
import { useRecentSearches, useSearch, type SearchFetcher } from "../use-search";
import {
  GROUP_LABEL,
  flatItems,
  moveIndex,
  orderedGroups,
} from "./search-popup-sections";
import { SearchResultRow } from "./search-popup-rows";

export interface SearchPopupProps {
  /** The host field's live value. */
  query: string;
  /** The host field has focus. The popup is open only while it is. */
  focused: boolean;
  scope: SearchScope;
  /** Required when `scope === "container"`. */
  containerId?: string;
  /** Open the thing the row names. The HOST decides what that means. */
  onNavigate: (item: SearchItem) => void;
  /** Escape, or a row taken — the host clears the field and drops focus. */
  onClose: () => void;
  /** A recent query, put back in the field. */
  onQueryChange: (next: string) => void;
  /** Must be stable — see `use-search.ts`. */
  fetcher: SearchFetcher;
  /** Keys the recents list. Absent = this machine's anonymous list. */
  userId?: string;
  /** Fixture seam — see `use-search.ts › useRecentSearches`. */
  seedRecents?: readonly string[];
  className?: string;
}

/** Small white key box — the footer legend and the field's return affordance.
 *  18px (`docs/DESIGN-SYSTEM.md` › Search popup › KEYCAP). */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-micro inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-border-default bg-bg-elevated px-1 leading-none text-text-secondary">
      {children}
    </span>
  );
}

/** Hairline with the section's name sitting IN it, gaps either side. */
function LabelledRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="h-px flex-1 bg-border-subtle" aria-hidden />
      <span className="text-label uppercase tracking-wide font-semibold text-text-muted">
        {label}
      </span>
      <span className="h-px flex-1 bg-border-subtle" aria-hidden />
    </div>
  );
}

/**
 * (2026-09-17) The card is the pill's width plus its own padding, nothing wider.
 * The kit's open pill is 260px and the body carries `px-2.5` a side, so 280px
 * puts the rows on the pill's own edges.
 */
export const SEARCH_CARD_W = "w-[280px]";

/**
 * (2026-09-17) Each section is five rows tall and scrolls itself. A one-line row
 * is 20px of tile inside `py-1`, so five are 160px; taller rows scroll, which is
 * the ceiling doing its job.
 *
 * Applied to the LIST, not the section — the heading is a sibling above the
 * scroller so it stays put while its rows move under it.
 */
export const SEARCH_SECTION_MAX_H = "max-h-[160px]";

export function SearchPopup({
  query,
  focused,
  scope,
  containerId,
  onNavigate,
  onClose,
  onQueryChange,
  fetcher,
  userId,
  seedRecents,
  className,
}: SearchPopupProps) {
  const { groups, loading, error } = useSearch({
    query,
    scope,
    containerId,
    fetcher,
  });
  const { recents, remember } = useRecentSearches(userId, seedRecents);
  /**
   * The cursor is a row id, not an index, so the reset is free: an id the new
   * list does not contain resolves to the first row by itself. An index would
   * need an effect calling `setState` synchronously.
   */
  const [activeId, setActiveId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const typed = query.trim();
  const searching = typed.length >= SEARCH_MIN_QUERY_LENGTH;
  const showRecents = !searching && recents.length > 0;

  const sections = useMemo(() => orderedGroups(groups), [groups]);
  const items = useMemo(() => flatItems(groups), [groups]);
  const found = items.findIndex((item) => item.id === activeId);
  const active = found === -1 ? 0 : found;

  const take = useCallback(
    (item: SearchItem) => {
      remember(typed);
      onNavigate(item);
      onClose();
    },
    [remember, typed, onNavigate, onClose]
  );

  /**
   * Focus is the whole dismissal rule, which is why there is no outside-click
   * listener: the card suppresses its own `mousedown` default, so the only way
   * focus leaves is the reader looking elsewhere.
   */
  const open = focused && (searching || showRecents);

  // On the window, not the card: the caret stays in the host's pill, so a
  // handler bound here would never run.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (items.length === 0) return;
        event.preventDefault();
        const next = moveIndex(
          active,
          event.key === "ArrowDown" ? 1 : -1,
          items.length
        );
        setActiveId(items[next].id);
        return;
      }
      if (event.key === "Enter") {
        const item = items[active];
        if (!item) return;
        event.preventDefault();
        take(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, active, take, onClose]);

  // Keep the cursor visible past the card's fold or its own section's:
  // `block: "nearest"` scrolls every scrollable ancestor, so one call serves both.
  // `?.` on the method too — jsdom does not implement `scrollIntoView`, and a
  // bare call would redden every mounted test of this card.
  useEffect(() => {
    const row = bodyRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div
      /* `.menu-card` is the container recipe. `!p-0` + `overflow-hidden` because
         the legend bar runs edge to edge and clips to the card's corners. */
      className={cn(
        "menu-card absolute top-full right-0 z-50 mt-2 !p-0 overflow-hidden",
        SEARCH_CARD_W,
        "max-w-[calc(100vw-2rem)]",
        className
      )}
      data-origin="right"
      data-search-popup=""
      role="listbox"
      aria-label="Search results"
      aria-busy={loading || undefined}
      /* The card is part of the control: a press inside it must not read as a
         blur out of the field before the click lands. */
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        ref={bodyRef}
        className={cn(
          // The card's own ceiling stays under the per-section one: five rows
          // apiece still stacks past the screen once enough sections match.
          "scrollbar-discreet max-h-[min(60vh,380px)] overflow-y-auto px-2.5 py-2",
          // Loading is a dim, not a spinner or a clear: the previous answer stays
          // readable underneath it (`use-search.ts`).
          loading && "opacity-60"
        )}
      >
        {showRecents ? (
          <>
            <LabelledRule label="Recent" />
            {recents.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => onQueryChange(term)}
                className="menu-row flex w-full items-center gap-2 px-1.5 py-1 text-left"
              >
                <Clock3 size={12} className="shrink-0 text-text-muted" aria-hidden />
                <span className="text-small truncate text-text-primary">{term}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            {sections.map((group) => (
              <div key={group.kind}>
                <LabelledRule label={GROUP_LABEL[group.kind]} />
                <div
                  data-search-section={group.kind}
                  className={cn(
                    SEARCH_SECTION_MAX_H,
                    "scrollbar-discreet overflow-y-auto"
                  )}
                >
                  {group.items.map((item) => {
                    const index = items.indexOf(item);
                    return (
                      <SearchResultRow
                        key={`${group.kind}:${item.id}`}
                        item={item}
                        active={index === active}
                        scope={scope}
                        containerId={containerId}
                        onActivate={() => take(item)}
                        onHover={() => setActiveId(item.id)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            {/* Only once the answer is in: "No results" mid-flight is a claim the
                client cannot make yet. */}
            {sections.length === 0 && !loading && (
              <p className="text-caption px-1.5 py-2 text-text-muted">
                {error ?? "No results"}
              </p>
            )}
          </>
        )}
      </div>

      {/* The legend bar, flush to the card's edges. */}
      <div className="flex h-9 items-center justify-between bg-card-surface-subtle px-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1">
            <Keycap>
              <CornerDownLeft size={10} aria-hidden />
            </Keycap>
            <span className="text-micro text-text-secondary">Select</span>
          </span>
          <span className="flex items-center gap-1">
            <Keycap>↑</Keycap>
            <Keycap>↓</Keycap>
            <span className="text-micro text-text-secondary">Move</span>
          </span>
        </div>
        <span className="flex items-center gap-1">
          <Keycap>Esc</Keycap>
          <span className="text-micro text-text-secondary">Exit</span>
        </span>
      </div>
    </div>
  );
}
