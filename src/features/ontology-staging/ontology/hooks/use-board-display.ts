"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * How the ontology board lays out its objects (Samuel, 2026-10-09):
 * - `canvas`: the lanes of fixed-size cards on the dot grid (the default).
 * - `rows`: each object type is a full-width section, its objects stacked as
 *   full-width rows with their attributes listed inside.
 *
 * A per-device view preference, like the last-opened ontology: one key, read on
 * every board, never synced. `useSyncExternalStore` so the server render and the
 * first client paint agree (`canvas`) and every mounted board follows a change.
 */
export type BoardDisplay = "canvas" | "rows";

const KEY = "dopl-staging:ontology-board-display";
const EVENT = "dopl-staging:ontology-board-display";

/** Where the choice lives when storage refuses it (private mode, quota). */
let unstored: BoardDisplay | null = null;

function read(): BoardDisplay {
  if (unstored) return unstored;
  try {
    return window.localStorage.getItem(KEY) === "rows" ? "rows" : "canvas";
  } catch {
    return "canvas";
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  // Another window of the same app (desktop opens several).
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useBoardDisplay(): [BoardDisplay, (next: BoardDisplay) => void] {
  const display = useSyncExternalStore(subscribe, read, () => "canvas" as const);
  const setDisplay = useCallback((next: BoardDisplay) => {
    try {
      window.localStorage.setItem(KEY, next);
      unstored = null;
    } catch {
      // Storage refused: the choice lasts this session only.
      unstored = next;
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [display, setDisplay];
}
