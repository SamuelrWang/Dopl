"use client";

/**
 * THE SEARCH HOOK — debounce, abort, keep-the-last-answer, and the recents list.
 *
 * ⚠ **THE TRANSPORT IS A PROP, NOT AN IMPORT (2026-09-17).** `useSearch` takes a
 * `fetcher`, which is what lets this one hook run over the real endpoint, over a
 * fixture table while the endpoint is still being built, and over a stub in a
 * test — with the BEHAVIOUR (when it fires, what it cancels, what it keeps on
 * screen) identical in all three. Swapping the data source is one import at the
 * host; nothing in this file or in the popup knows which one it got.
 *
 * ⚠ **THE FETCHER MUST BE STABLE** — a module-level `const`, or `useCallback`d
 * by the host. It is an effect dependency, and a fresh function identity every
 * render re-arms the debounce forever.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SEARCH_MIN_QUERY_LENGTH,
  type SearchGroup,
  type SearchResponse,
  type SearchScope,
} from "./contracts";

/** ⚠ 250ms, and it is a TYPING pause, not a network guess. */
export const SEARCH_DEBOUNCE_MS = 250;

export interface SearchRequest {
  /** Already trimmed, and already known to be ≥ `SEARCH_MIN_QUERY_LENGTH`. */
  q: string;
  scope: SearchScope;
  /** Present exactly when `scope === "container"`. */
  containerId?: string;
  signal: AbortSignal;
}

export type SearchFetcher = (req: SearchRequest) => Promise<SearchResponse>;

export interface SearchState {
  groups: SearchGroup[];
  /** A request is in flight. ⚠ `groups` is the PREVIOUS answer while it is. */
  loading: boolean;
  /** Plain message, or `null`. Rendered as one line (minimal copy). */
  error: string | null;
}

const IDLE: SearchState = { groups: [], loading: false, error: null };

/**
 * Run `query` against `fetcher`, 250ms after the typing stops.
 *
 * ⚠ **THE LAST ANSWER STAYS ON SCREEN WHILE THE NEXT ONE LOADS.** Clearing
 * `groups` on every keystroke makes the popup blink through an empty card at
 * typing speed, and the rows an operator is aiming at jump under the cursor.
 * `loading` is the whole signal; the card renders it as a subtle state.
 *
 * ⚠ **EVERY SUPERSEDED REQUEST IS ABORTED**, and a settled-but-aborted response
 * is DROPPED rather than rendered: out-of-order answers are how a popup ends up
 * showing results for a prefix of what the field now says.
 */
export function useSearch({
  query,
  scope,
  containerId,
  fetcher,
}: {
  query: string;
  scope: SearchScope;
  containerId?: string;
  fetcher: SearchFetcher;
}): SearchState {
  const [state, setState] = useState<SearchState>(IDLE);
  const q = query.trim();
  // ⚠ **THE THRESHOLD IS THE SERVER'S OWN** (`contracts.ts`): shorter than this
  // and the route answers an EMPTY 200 by contract, so asking would be a request
  // whose answer is already known.
  const searching = q.length >= SEARCH_MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // ⚠ **THE FLAG IS RAISED WHEN THE REQUEST IS, NOT WHEN THE KEY IS
      // PRESSED** — two reasons, and they agree. (1) A synchronous `setState` in
      // an effect body is a cascading render (`react-hooks/set-state-in-effect`).
      // (2) Through fast typing there is no request in flight during the 250ms
      // pause, so a flag raised on the keystroke would dim the card for a read
      // that had not been asked for yet.
      setState((prev) => ({ ...prev, loading: true, error: null }));
      fetcher({ q, scope, containerId, signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return;
          setState({ groups: res.groups, loading: false, error: null });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          // ⚠ KEEP THE ROWS. A failed refresh is not a reason to throw away the
          // answer the reader is currently looking at.
          setState((prev) => ({
            groups: prev.groups,
            loading: false,
            error: err instanceof Error ? err.message : "Search failed",
          }));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, searching, scope, containerId, fetcher]);

  /**
   * ⚠ **SHORT QUERIES READ `IDLE` RATHER THAN CLEARING THE STATE.** Resetting it
   * in the effect is a synchronous `setState` in an effect body — a cascading
   * render, and what `react-hooks/set-state-in-effect` is for. Derived here, the
   * held answer simply stops being visible, and is still there to stand under the
   * next query's load (the keep-the-last-answer rule above).
   */
  return searching ? state : IDLE;
}

/** Five, per user. Enough to be a shortcut, short enough to stay scannable. */
export const RECENTS_MAX = 5;

const RECENTS_KEY = "dopl.search.recents";

/** ⚠ PER USER — one machine holds more than one account, and a previous
 *  operator's queries are theirs, not this one's. */
function storageKey(userId?: string): string {
  return `${RECENTS_KEY}:${userId ?? "anon"}`;
}

/**
 * ⚠ **EVERY `localStorage` TOUCH IS GUARDED.** It throws outright in a private
 * window and with site data blocked, and it is absent in the SSR pass and in a
 * jsdom test that did not install it. A search box that cannot render because a
 * convenience failed is the worse bug.
 */
export function readRecents(userId?: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string").slice(0, RECENTS_MAX);
  } catch {
    return [];
  }
}

/** Newest first, de-duplicated case-insensitively, capped. Returns the new list
 *  so the caller never re-reads storage to learn what it just wrote. */
export function writeRecent(query: string, userId?: string): string[] {
  const q = query.trim();
  if (!q) return readRecents(userId);
  const rest = readRecents(userId).filter(
    (prev) => prev.toLowerCase() !== q.toLowerCase()
  );
  const next = [q, ...rest].slice(0, RECENTS_MAX);
  try {
    globalThis.localStorage?.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Remembering is a convenience; failing to remember is not an error state.
  }
  return next;
}

/**
 * The recents list and the one way to add to it.
 *
 * ⚠ **A QUERY IS REMEMBERED WHEN IT IS USED, NOT WHEN IT IS TYPED** — the popup
 * calls `remember` on a row activation. Storing every keystroke would fill the
 * list with the prefixes of one search.
 */
export function useRecentSearches(
  userId?: string,
  /** ⚠ **FIXTURE SEAM (2026-09-17)** — shown only while this user has remembered
   *  NOTHING, so a first look at the popup is not an empty card. A real
   *  remembered query replaces it permanently. Drop the argument once the search
   *  endpoint has been live long enough for every operator to have a list. */
  seed?: readonly string[]
): {
  recents: string[];
  remember: (query: string) => void;
} {
  const [recents, setRecents] = useState<string[]>([]);

  // ⚠ After mount, never during render: `localStorage` does not exist in the
  // Next server pass, and a lazy initialiser that reads it would throw there.
  useEffect(() => {
    const stored = readRecents(userId);
    setRecents(stored.length > 0 ? stored : [...(seed ?? [])].slice(0, RECENTS_MAX));
    // `seed` is a module-level constant at every call site; listing it would
    // re-read storage on every render of a caller that inlines the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const remember = useCallback(
    (query: string) => setRecents(writeRecent(query, userId)),
    [userId]
  );

  return useMemo(() => ({ recents, remember }), [recents, remember]);
}
