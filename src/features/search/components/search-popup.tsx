"use client";

/**
 * The search popup: one floating card under the host's search field, holding a text search
 * across the whole space, split into sections.
 *
 * One component, two hosts. The host contract is `{ scope, containerId?, onNavigate }` and
 * nothing about a host leaks in here — no router, no workspace read, no page state.
 *
 * The field is the host's, so there is no input inside the card: two inputs over one query is
 * two places for the caret to be. Dismissal is shared — Escape calls `onClose`, and the card
 * is open exactly while the field has focus.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CornerDownLeft, Search, SearchX } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { QUIET_HEADING_TEXT } from "@/shared/ui/section-heading";
import {
  SEARCH_MIN_QUERY_LENGTH,
  type SearchItem,
  type SearchScope,
} from "../contracts";
import { highlightPattern, highlightTerms } from "../highlight";
import { useRecentSearches, useSearch, type SearchFetcher } from "../use-search";
import {
  GROUP_LABEL,
  flatItems,
  moveIndex,
  orderedGroups,
} from "./search-popup-sections";
import { Keycap, RecentRow, SearchResultRow } from "./search-popup-rows";

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

/**
 * The card's width belongs to the field it hangs from, never to its content (Samuel,
 * 2026-10-26: "only change the way stuff looks inside not the dimensions of it"). The DEFAULT
 * is the sidebar field's 260px pill plus the body's padding; /home's header passes
 * `left-0 w-auto` to span its action group, pill-left to Profile-right (`header-search.tsx`).
 */
export const SEARCH_CARD_W = "w-[280px] max-w-[calc(100vw-2rem)]";

/**
 * Each section is about five rows tall and scrolls itself. Applied to the LIST, not the
 * section — the heading is a sibling above the scroller so it stays put while its rows move.
 */
export const SEARCH_SECTION_MAX_H = "max-h-[160px]";

/** Rows on hairlines; the row's hover face floats between them. */
const ROW_LIST = "divide-y divide-border-subtle [&>*]:py-0.5";

/** Sticky inside the card's own scroll, so a long answer keeps its section named. */
function SectionHeading({ label }: { label: string }) {
  return (
    <div className={cn("sticky top-0 z-10 bg-bg-overlay px-2 pt-2.5 pb-1", QUIET_HEADING_TEXT)}>
      {label}
    </div>
  );
}

function Hint({ keys, label }: { keys: ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1">
      {keys}
      <span className="text-caption text-text-muted">{label}</span>
    </span>
  );
}

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
   * The cursor is a row id, not an index, so the reset is free: an id the new list does not
   * contain resolves to the first row by itself.
   */
  const [activeId, setActiveId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const typed = query.trim();
  const searching = typed.length >= SEARCH_MIN_QUERY_LENGTH;

  const sections = useMemo(() => orderedGroups(groups), [groups]);
  const items = useMemo(() => flatItems(groups), [groups]);
  const pattern = useMemo(() => highlightPattern(highlightTerms(typed)), [typed]);
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

  // On the window, not the card: the caret stays in the host's field, so a handler bound
  // here would never run.
  useEffect(() => {
    if (!focused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (items.length === 0) return;
        event.preventDefault();
        const next = moveIndex(active, event.key === "ArrowDown" ? 1 : -1, items.length);
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
  }, [focused, items, active, take, onClose]);

  // `block: "nearest"` scrolls every scrollable ancestor, so one call keeps the cursor inside
  // both its section and the card. `?.` on the method too: jsdom has no `scrollIntoView`.
  useEffect(() => {
    const row = bodyRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  if (!focused) return null;

  return (
    <div
      className={cn(
        "white-card absolute top-full right-0 z-50 mt-2 overflow-hidden shadow-[var(--shadow-card-lift)]",
        SEARCH_CARD_W,
        className
      )}
      data-search-popup=""
      role="listbox"
      aria-label="Search results"
      aria-busy={loading || undefined}
      /* The card is part of the control: a press inside it must not read as a blur out of
         the field before the click lands. */
      onMouseDown={(event) => event.preventDefault()}
    >
      <div
        ref={bodyRef}
        className="scrollbar-discreet max-h-[min(60vh,380px)] overflow-y-auto px-1.5 pb-1.5"
      >
        {!searching ? (
          recents.length > 0 ? (
            <>
              <SectionHeading label="Recent" />
              <div className={ROW_LIST}>
                {recents.map((term) => (
                  <div key={term}>
                    <RecentRow term={term} onTake={() => onQueryChange(term)} />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState icon={Search} title="Type to search" className="py-6" />
          )
        ) : (
          <>
            {sections.map((group) => (
              <Fragment key={group.kind}>
                <SectionHeading label={GROUP_LABEL[group.kind]} />
                <div
                  data-search-section={group.kind}
                  className={cn(SEARCH_SECTION_MAX_H, "scrollbar-discreet overflow-y-auto", ROW_LIST)}
                >
                  {group.items.map((item) => {
                    const index = items.indexOf(item);
                    return (
                      <div key={`${group.kind}:${item.id}`}>
                        <SearchResultRow
                          item={item}
                          active={index === active}
                          pattern={pattern}
                          scope={scope}
                          containerId={containerId}
                          onActivate={() => take(item)}
                          onHover={() => setActiveId(item.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              </Fragment>
            ))}
            {/* From the keystroke until THIS query's answer lands; `use-search.ts` never hands
                back another query's rows in the meantime. */}
            {loading && (
              <p className="text-caption px-2 py-2.5 text-text-muted" data-search-loading="">
                Loading results
              </p>
            )}
            {/* Only once the answer is in: "No results" mid-flight is a claim the client
                cannot make yet. */}
            {sections.length === 0 && !loading && (
              <EmptyState
                icon={error ? CircleAlert : SearchX}
                title={error ?? "No results"}
                className="py-6"
              />
            )}
          </>
        )}
      </div>

      <div className="flex h-8 items-center gap-3 border-t border-border-subtle px-3">
        <Hint
          keys={
            <Keycap>
              <CornerDownLeft size={10} aria-hidden />
            </Keycap>
          }
          label="Open"
        />
        <Hint
          keys={
            <>
              <Keycap>↑</Keycap>
              <Keycap>↓</Keycap>
            </>
          }
          label="Move"
        />
      </div>
    </div>
  );
}
