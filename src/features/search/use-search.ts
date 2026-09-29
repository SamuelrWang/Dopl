"use client";

/**
 * The search hook: debounce, abort, keep-the-last-answer, and the recents list.
 *
 * The transport is a prop, not an import, so the same behaviour runs over the
 * real endpoint, a fixture table and a test stub.
 *
 * The fetcher must be STABLE — a module-level const or `useCallback`d. It is an
 * effect dependency, and a fresh identity each render re-arms the debounce
 * forever.
 */

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  SEARCH_MIN_QUERY_LENGTH,
  type SearchGroup,
  type SearchResponse,
  type SearchScope,
} from "./contracts";

/** 250ms — a typing pause, not a network guess. */
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
  /** The answer to the CURRENT query, or `[]` while it is not in yet. */
  groups: SearchGroup[];
  /** The current query has no answer yet — debouncing or in flight. */
  loading: boolean;
  /** Plain message, or `null`. Rendered as one line (minimal copy). */
  error: string | null;
}

const IDLE: SearchState = { groups: [], loading: false, error: null };

/** What the hook stores: an answer, and WHICH request it answers. */
interface Answer {
  key: string;
  groups: SearchGroup[];
  error: string | null;
}

/** One string per distinct request, so an answer is never shown for another. */
function requestKey(q: string, scope: SearchScope, containerId?: string): string {
  return `${scope}\u0000${containerId ?? ""}\u0000${q}`;
}

/**
 * Run `query` against `fetcher`, 250ms after the typing stops.
 *
 * ⚠ **(2026-09-29, Samuel: "when a search is happening, right now it shows
 * nothing, show … something that says loading results")** — `loading` is true
 * from the KEYSTROKE until this query's own answer lands (the debounce counts),
 * and `groups` is only ever the answer to the query in the field. The previous
 * answer is NOT held under the next load any more: rows for `ca` under a field
 * reading `can't` are rows for a question nobody is asking.
 *
 * Every superseded request is aborted, and a settled-but-aborted response is
 * dropped: out-of-order answers show results for a prefix of what the field says.
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
  const [answer, setAnswer] = useState<Answer | null>(null);
  const q = query.trim();
  const key = requestKey(q, scope, containerId);
  // The server's own threshold (`contracts.ts`): shorter answers an empty 200 by
  // contract, so asking would be a request whose answer is already known.
  const searching = q.length >= SEARCH_MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetcher({ q, scope, containerId, signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return;
          setAnswer({ key, groups: res.groups, error: null });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setAnswer({ key, groups: [], error: userFacingMessage(err) });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, q, searching, scope, containerId, fetcher]);

  /**
   * DERIVED, never reset in the effect (a synchronous `setState` there
   * cascades): an answer whose key is not the field's is simply not shown, and
   * the gap reads as `loading`.
   */
  if (!searching) return IDLE;
  if (answer === null || answer.key !== key) {
    return { groups: [], loading: true, error: null };
  }
  return { groups: answer.groups, loading: false, error: answer.error };
}

/** Five, per user. Enough to be a shortcut, short enough to stay scannable. */
export const RECENTS_MAX = 5;

const RECENTS_KEY = "dopl.search.recents";

/** Per user: one machine holds more than one account, and a previous operator's
 *  queries are theirs. */
function storageKey(userId?: string): string {
  return `${RECENTS_KEY}:${userId ?? "anon"}`;
}

/**
 * Every `localStorage` touch is guarded: it throws in a private window and with
 * site data blocked, and is absent in the SSR pass and in jsdom.
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
 * The recents list and the one way to add to it. A query is remembered when it is
 * USED, not typed — storing keystrokes would fill the list with one search's
 * prefixes.
 */
export function useRecentSearches(
  userId?: string,
  /** Fixture seam: shown only while this user has remembered nothing, so a first
   *  look is not an empty card. A real remembered query replaces it permanently. */
  seed?: readonly string[]
): {
  recents: string[];
  remember: (query: string) => void;
} {
  const [recents, setRecents] = useState<string[]>([]);

  // After mount, never during render: `localStorage` does not exist in the Next
  // server pass, and a lazy initialiser reading it would throw there.
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
