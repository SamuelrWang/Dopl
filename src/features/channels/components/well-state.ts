"use client";

/** Which wells a surface has and which are open, per device or per app run; the box is `collapse-wells.tsx`. */

import { useCallback, useState } from "react";

/** One well in a caller's set; array order is render order. */
export interface WellSpec<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly defaultOpen: boolean;
}

type OpenMap<Id extends string> = Record<Id, boolean>;

/** The set's defaults, overlaid with stored booleans for KNOWN wells only — an unknown key or a
 *  non-boolean value is ignored. */
function mergeOpen<Id extends string>(
  wells: readonly WellSpec<Id>[],
  stored: Partial<Record<string, unknown>> | null | undefined
): OpenMap<Id> {
  const out = {} as OpenMap<Id>;
  for (const well of wells) {
    const value = stored?.[well.id];
    out[well.id] = typeof value === "boolean" ? value : well.defaultOpen;
  }
  return out;
}

/** This device's stored choice under `storageKey`, or the defaults. Every storage access is in a `try`. */
function storedWells<Id extends string>(
  storageKey: string,
  wells: readonly WellSpec<Id>[]
): OpenMap<Id> {
  if (typeof window === "undefined") return mergeOpen(wells, null);
  try {
    const raw = window.localStorage.getItem(storageKey);
    return mergeOpen(wells, raw ? (JSON.parse(raw) as Partial<Record<string, unknown>>) : null);
  } catch {
    // storage refused or a corrupt write ⇒ the defaults
    return mergeOpen(wells, null);
  }
}

/** `store="session"`: a module map, never localStorage — survives navigation, gone on reload/relaunch. */
const sessionWells = new Map<string, Record<string, boolean>>();

/** Tests only (a fresh session store per case); nothing in the app may call it. */
export function resetSessionWells(): void {
  sessionWells.clear();
}

/** Which store a surface's choice lives in — see {@link sessionWells}. */
export type WellStore = "device" | "session";

/**
 * Which wells are open: the set's defaults, then the last choice stored under `storageKey` (one key per surface).
 * Read in a lazy initialiser, not an effect (`react-hooks/set-state-in-effect`). A server-rendered surface must
 * pass a key nothing writes (the landing demo does), or hydration mismatches.
 */
export function useWells<Id extends string>(
  storageKey: string,
  wells: readonly WellSpec<Id>[],
  store: WellStore = "device"
): {
  isOpen: (id: Id) => boolean;
  toggle: (id: Id) => void;
} {
  const [open, setOpen] = useState<OpenMap<Id>>(() =>
    store === "session"
      ? // empty after a reload/relaunch ⇒ the defaults
        mergeOpen(wells, sessionWells.get(storageKey))
      : storedWells(storageKey, wells)
  );

  // The write sits outside the state updater: an updater must stay pure (React may re-run it).
  const toggle = useCallback(
    (id: Id) => {
      const next = { ...open, [id]: !open[id] };
      setOpen(next);
      if (store === "session") {
        sessionWells.set(storageKey, next);
        return;
      }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // storage unavailable — the choice still holds in state
      }
    },
    [open, storageKey, store]
  );

  const isOpen = useCallback((id: Id) => open[id], [open]);
  return { isOpen, toggle };
}
