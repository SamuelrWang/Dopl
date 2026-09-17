"use client";

/**
 * THE SEARCH POPUP — one floating card under the header search field, holding a
 * text search across the whole space, split into sections.
 *
 * Samuel, 2026-09-17 (verbatim): *"right now, during search, it just filters by
 * channel name, and it like removes channel on the left sidebar. that doesnt
 * make sense, it should be a pop up like this."* … *"Let's not do command K, and
 * no toggle. Just have it that when a user searches, the search pop up is
 * separated into sections. So, Channels, messages, knowledge, agent template,
 * etc. It's basically doing a text search across the home space."*
 *
 * ⚠ **ONE COMPONENT, TWO HOSTS.** /home mounts it under its header pill with
 * `scope="account"`; a workspace surface mounts it with `scope="container"` and
 * its own id. The host contract is three props — `{ scope, containerId?,
 * onNavigate }` — and NOTHING about a host leaks in here: this file has no
 * router, no workspace read and no page state. A host that can open its own
 * objects can mount it.
 *
 * ⚠ **THE FIELD IS THE HOST'S PILL.** The reference design draws the search
 * field at the top of the card because the card IS the field's dropdown; here
 * the field is the pill the card hangs from, so there is no input inside it. Two
 * inputs over one query is two places for the caret to be.
 *
 * ⚠ **NO ⌘K AND NO SCOPE TOGGLE** (Samuel, above). The popup has exactly one way
 * in — type into the pill — and its scope is the host's, not a control.
 *
 * ⚠ **DISMISSAL IS SHARED WITH THE HOST**: Escape here calls `onClose`, and the
 * host is what clears the field and drops focus. Outside-pointer dismissal
 * belongs to the host too, because the pill and the card are one control and
 * only the host knows where the pill ends.
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
  /** The host field has focus. ⚠ The popup is open ONLY while it is — see the
   *  `open` note below. */
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
  /** ⚠ MUST BE STABLE — see `use-search.ts`. */
  fetcher: SearchFetcher;
  /** Keys the recents list. Absent = this machine's anonymous list. */
  userId?: string;
  /** ⚠ FIXTURE SEAM (2026-09-17) — see `use-search.ts › useRecentSearches`. */
  seedRecents?: readonly string[];
  className?: string;
}

/** Small white key box — the footer legend and the field's return affordance. */
function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-caption inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-border-default bg-bg-elevated px-1.5 leading-none text-text-secondary">
      {children}
    </span>
  );
}

/** Hairline with the section's name sitting IN it, gaps either side. */
function LabelledRule({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-border-subtle" aria-hidden />
      <span className="text-label uppercase tracking-wide font-semibold text-text-muted">
        {label}
      </span>
      <span className="h-px flex-1 bg-border-subtle" aria-hidden />
    </div>
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
   * ⚠ **THE CURSOR IS A ROW ID, NOT AN INDEX, AND THAT IS WHAT MAKES THE RESET
   * FREE.** A new answer must put the cursor back on the first row — holding an
   * index across result sets points it at a different thing than the one it was
   * on — and doing that with an index costs an effect that calls `setState`
   * synchronously (`react-hooks/set-state-in-effect`). An id that the new list
   * does not contain resolves to the first row by itself, with no effect at all.
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
   * ⚠ **FOCUS IS THE WHOLE DISMISSAL RULE, AND IT IS WHY THERE IS NO
   * OUTSIDE-CLICK LISTENER.** The card suppresses its own `mousedown` default,
   * so pointing at a row, a section or the scrollbar never blurs the field —
   * which leaves exactly one way for focus to leave: the reader looked
   * somewhere else, and that closes the popup. A second window-level pointer
   * test would fight the host's own.
   */
  const open = focused && (searching || showRecents);

  // ⚠ ON THE WINDOW, NOT ON THE CARD. The caret stays in the host's pill the
  // whole time, so a handler bound here would never run.
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

  // Keep the cursor visible when it walks past the card's fold.
  // ⚠ **`?.` ON THE METHOD TOO** — jsdom does not implement `scrollIntoView`, so
  // a bare call turns every mounted test of this card red for a reason that has
  // nothing to do with what it is testing (`message-pane.test.tsx` stubs the
  // prototype instead; this card needs no assertion about the scroll).
  useEffect(() => {
    const row = bodyRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  return (
    <div
      /* `.menu-card` IS the container recipe — white, radius 16, the kit's soft
         wide drop. `!p-0` + `overflow-hidden` because the legend bar runs edge
         to edge and clips to the card's own corners. */
      className={cn(
        "menu-card absolute top-full right-0 z-50 mt-3 !p-0 overflow-hidden",
        "w-[420px] max-w-[calc(100vw-2rem)]",
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
          "max-h-[min(60vh,460px)] overflow-y-auto px-3 py-2.5",
          // ⚠ THE LOADING STATE IS A DIM, NOT A SPINNER AND NOT A CLEAR — the
          // previous answer stays readable underneath it (`use-search.ts`).
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
                className="menu-row flex w-full items-center gap-2.5 px-2 py-1.5 text-left"
              >
                <Clock3 size={14} className="shrink-0 text-text-muted" aria-hidden />
                <span className="text-body truncate text-text-primary">{term}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            {sections.map((group) => (
              <div key={group.kind}>
                <LabelledRule label={GROUP_LABEL[group.kind]} />
                {group.items.map((item) => {
                  const index = items.indexOf(item);
                  return (
                    <SearchResultRow
                      key={`${group.kind}:${item.id}`}
                      item={item}
                      active={index === active}
                      onActivate={() => take(item)}
                      onHover={() => setActiveId(item.id)}
                    />
                  );
                })}
              </div>
            ))}
            {/* ⚠ ONE LINE, AND ONLY WHEN THE ANSWER IS IN. "No results" while a
                request is in flight is a claim the client cannot make yet. */}
            {sections.length === 0 && !loading && (
              <p className="text-caption px-2 py-3 text-text-muted">
                {error ?? "No results"}
              </p>
            )}
          </>
        )}
      </div>

      {/* The legend bar, flush to the card's edges. */}
      <div className="flex h-11 items-center justify-between bg-card-surface-subtle px-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <Keycap>
              <CornerDownLeft size={12} aria-hidden />
            </Keycap>
            <span className="text-caption text-text-secondary">Select</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Keycap>↑</Keycap>
            <Keycap>↓</Keycap>
            <span className="text-caption text-text-secondary">Move</span>
          </span>
        </div>
        <span className="flex items-center gap-1.5">
          <Keycap>Esc</Keycap>
          <span className="text-caption text-text-secondary">Exit</span>
        </span>
      </div>
    </div>
  );
}
