"use client";

/**
 * Client-side "saved items" store for the Browse page's Saved tab.
 *
 * MVP storage: localStorage keyed off the active user id (anon users
 * share a fallback bucket). Tracks saved entry ids and saved cluster
 * slugs separately.
 *
 * Upgrade path: swap this module for calls against a `user_saved_items`
 * table when we want cross-device persistence. The public API
 * (useSavedIds + toggleSaved) is intentionally compact so the call
 * sites on EntryCard / CommunityCard don't need to change.
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY_PREFIX = "dopl-saved";
// localStorage key used elsewhere in the app to remember the active
// user id so non-canvas surfaces (add-to-canvas, now saved items) can
// find the right bucket. Mirrors `CANVAS_ACTIVE_USER_KEY` usage in
// canvas-store.tsx but we don't import it to keep this module
// dependency-free.
const ACTIVE_USER_KEY = "canvas:active-user";

type ItemKind = "entry" | "cluster";

interface SavedState {
  entries: string[];
  clusters: string[]; // slugs
}

const EMPTY: SavedState = { entries: [], clusters: [] };

// ── Storage layer ────────────────────────────────────────────────────

function storageKey(): string {
  if (typeof window === "undefined") return `${STORAGE_KEY_PREFIX}:anon`;
  const uid = window.localStorage.getItem(ACTIVE_USER_KEY);
  return `${STORAGE_KEY_PREFIX}:${uid || "anon"}`;
}

function read(): SavedState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      clusters: Array.isArray(parsed.clusters) ? parsed.clusters : [],
    };
  } catch {
    return EMPTY;
  }
}

function write(next: SavedState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(next));
  } catch {
    // quota / private mode — silently fail, UI state still updates
  }
  emit();
}

// ── Pub/sub so multiple card instances stay in sync on toggle ────────
//
// Shaped to match the contract React's useSyncExternalStore expects:
// subscribe(callback) returns an unsubscribe, and every toggle calls
// every registered callback.

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit() {
  for (const l of listeners) l();
}

// useSyncExternalStore requires a STABLE snapshot reference across
// calls that didn't change — otherwise it bails with "Maximum update
// depth" warnings. Cache the last read and only produce a new object
// when the underlying localStorage blob actually differs.
let cachedSnapshot: SavedState = EMPTY;
let cachedSerialized: string = JSON.stringify(EMPTY);
function getSnapshot(): SavedState {
  if (typeof window === "undefined") return EMPTY;
  const fresh = read();
  const freshSerialized = JSON.stringify(fresh);
  if (freshSerialized !== cachedSerialized) {
    cachedSnapshot = fresh;
    cachedSerialized = freshSerialized;
  }
  return cachedSnapshot;
}

// Server snapshot is always the empty state — saves live only on the
// client, so server-rendered markup shows the "not saved" visual and
// the first client render reconciles with the real bucket.
function getServerSnapshot(): SavedState {
  return EMPTY;
}

// ── Public API ───────────────────────────────────────────────────────

export function isSaved(kind: ItemKind, id: string): boolean {
  const state = read();
  return kind === "entry"
    ? state.entries.includes(id)
    : state.clusters.includes(id);
}

export function toggleSaved(kind: ItemKind, id: string): boolean {
  const state = read();
  const list = kind === "entry" ? state.entries : state.clusters;
  const already = list.includes(id);
  const nextList = already
    ? list.filter((x) => x !== id)
    : [...list, id];
  const next: SavedState =
    kind === "entry"
      ? { ...state, entries: nextList }
      : { ...state, clusters: nextList };
  write(next);
  return !already;
}

export function getSavedState(): SavedState {
  return read();
}

/**
 * Subscribe a card to saved-state changes. Returns `isSaved` for the
 * given id and a `toggle` function. Re-renders when any card toggles
 * its own state (so e.g. the Saved tab updates if the user unsaves
 * from another tab in the same session).
 */
export function useSavedToggle(kind: ItemKind, id: string | null | undefined): {
  saved: boolean;
  toggle: () => void;
} {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  const saved = id
    ? (kind === "entry" ? snapshot.entries : snapshot.clusters).includes(id)
    : false;

  return {
    saved,
    toggle: () => {
      if (!id) return;
      toggleSaved(kind, id);
    },
  };
}

/**
 * Hook for the Saved tab — returns the full saved list. Re-renders
 * whenever any toggle fires.
 */
export function useSavedList(): SavedState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
