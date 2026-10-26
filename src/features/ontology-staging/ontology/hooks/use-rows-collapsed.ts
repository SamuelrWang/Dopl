"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Which lanes and object rows are folded shut in the Rows display, per
 * ontology, on this device (Samuel, 2026-10-09). Same shape as
 * `use-board-display.ts`: localStorage, read through `useSyncExternalStore`.
 *
 * Key `dopl:ontology-rows-collapsed:<ontologyId>` → JSON array of COLLAPSED
 * object ids. Lanes are objects too (columns), so one id list serves both.
 * Absent = expanded: expanded is the default and costs no storage.
 *
 * Each write drops ids the caller says are no longer on the board, so deleted
 * objects do not pile up.
 */
const PREFIX = "dopl-staging:ontology-rows-collapsed:";
const EVENT = "dopl-staging:ontology-rows-collapsed";
const EMPTY: ReadonlySet<string> = new Set();

/** Parsed snapshots by raw string: `useSyncExternalStore` needs a stable value. */
const cache = new Map<string, { raw: string | null; set: ReadonlySet<string> }>();
/** Fallback when storage refuses a write. */
const unstored = new Map<string, ReadonlySet<string>>();

function read(ontologyId: string): ReadonlySet<string> {
  const fallback = unstored.get(ontologyId);
  if (fallback) return fallback;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFIX + ontologyId);
  } catch {
    return EMPTY;
  }
  const hit = cache.get(ontologyId);
  if (hit && hit.raw === raw) return hit.set;
  let set: ReadonlySet<string> = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      set = new Set(parsed.filter((v): v is string => typeof v === "string"));
    }
  } catch {
    // Corrupt entry: treat as nothing collapsed; the next write replaces it.
  }
  cache.set(ontologyId, { raw, set });
  return set;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useRowsCollapsed(
  ontologyId: string,
  /** Is this id still on the board? Ids that fail are pruned on write. */
  exists: (id: string) => boolean
): { collapsed: ReadonlySet<string>; toggle: (id: string) => void } {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => read(ontologyId),
    () => EMPTY
  );
  const toggle = useCallback(
    (id: string) => {
      const next = new Set([...read(ontologyId)].filter(exists));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        if (next.size === 0) window.localStorage.removeItem(PREFIX + ontologyId);
        else window.localStorage.setItem(PREFIX + ontologyId, JSON.stringify([...next]));
        unstored.delete(ontologyId);
      } catch {
        unstored.set(ontologyId, next);
      }
      window.dispatchEvent(new Event(EVENT));
    },
    [ontologyId, exists]
  );
  return { collapsed, toggle };
}
