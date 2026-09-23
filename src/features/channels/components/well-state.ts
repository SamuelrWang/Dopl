"use client";

/**
 * WHICH WELLS A SURFACE HAS, AND WHICH OF THEM ARE OPEN ON THIS DEVICE — **the
 * well set as DATA, with no box and no render.**
 *
 * ⚠ **SPLIT OUT OF `collapse-wells.tsx` ON 2026-09-15 — the seam is DATA vs BOX.**
 * This module answers "which wells exist and which are open"; that one answers
 * "what one well looks like and how it grows". A real reason-to-change, not a line
 * count: the storage rules below move when a surface gains a well, the geometry
 * there moves when Samuel rules on a shape.
 */

import { useCallback, useState } from "react";

/**
 * ONE WELL IN A CALLER'S SET — its id, the word on its header, and whether a
 * device that has never chosen finds it open.
 *
 * ⚠ **`defaultOpen` IS PART OF THE SET, NOT A CONSTANT IN THIS FILE** — a
 * hard-coded map is exactly what a second well set cannot reuse (/home opens two).
 * ⚠ **ORDER IS THE DATA**: the render maps the caller's array, so there is no
 * second list to keep in step.
 */
export interface WellSpec<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly defaultOpen: boolean;
}

type OpenMap<Id extends string> = Record<Id, boolean>;

/** The set's defaults, overlaid with a stored choice's booleans for KNOWN wells only — an unknown
 *  key (a later build's well) or a non-boolean (a corrupt write) is ignored. */
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

/**
 * THIS DEVICE'S LAST CHOICE FOR ONE SURFACE'S KEY, OR THE SET'S OWN DEFAULTS.
 *
 * ⚠ **THE KEY IS THE CALLER'S, AND NO TWO SURFACES SHARE ONE** —
 * `dopl.agents.wells`, `dopl.threads.wells`, `dopl.home.channels.wells`.
 * Collapsing **Earlier** on the Agents tab is not a statement about the Threads
 * tab or about /home's list, and one key would make it one.
 * ⚠ **AN UNKNOWN KEY IN THE STORED OBJECT IS IGNORED, NOT TRUSTED** — a further
 * well in a later build must not be able to arrive pre-collapsed from a stale
 * write, and a non-boolean value is a corrupt one.
 * ⚠ **EVERY ACCESS IS IN A `try`** and every failure is the defaults: storage
 * throws outright in a locked-down browser, and a collapsible section is not worth
 * a blank panel.
 */
function storedWells<Id extends string>(
  storageKey: string,
  wells: readonly WellSpec<Id>[]
): OpenMap<Id> {
  if (typeof window === "undefined") return mergeOpen(wells, null);
  try {
    const raw = window.localStorage.getItem(storageKey);
    return mergeOpen(wells, raw ? (JSON.parse(raw) as Partial<Record<string, unknown>>) : null);
  } catch {
    // storage refused or a corrupt write — the defaults, never a crash
    return mergeOpen(wells, null);
  }
}

/**
 * WHICH WELLS ARE OPEN — the set's own defaults, then whatever this device last
 * chose under `storageKey`.
 *
 * ⚠ **PER DEVICE, NOT PER ACCOUNT, AND `localStorage` IS THE HONEST STORE FOR
 * THAT** — a collapsed well is a reading posture, not a fact about the channel or
 * the list, and the server stores nothing about any of the four surfaces.
 * ⚠ **READ IN A LAZY INITIALISER, NOT IN AN EFFECT.** `setState` in an effect body
 * is a cascading render this tree's lint forbids
 * (`react-hooks/set-state-in-effect`), so "paint the defaults, then correct them"
 * is not available. The initialiser guards `typeof window` so the hook is honest
 * on its own.
 * 🔒 ⚠ **ONE SURFACE DOES RENDER WELLS ON A SERVER, AND THIS BLOCK CLAIMED NONE DID
 * UNTIL 2026-09-17.** The landing page's hero demo
 * (`marketing/components/banner-demo/demo-home-chrome.tsx`) is a client component
 * Next renders statically, it files items at step 0 and it passes `showEmpty`, so
 * three `aria-expanded` attributes really do come off the server. **What keeps
 * hydration honest there is the KEY, not the absence of a render**: that scene
 * passes a demo-scoped key nothing ever writes, so the client initialiser reads
 * `null` and lands on the same defaults the server used. ⚠ **A SERVER-RENDERED
 * SURFACE PASSING A KEY THE OPERATOR CAN WRITE WOULD MISMATCH, and this hook
 * cannot fix that** — it would need the defaults on the first client paint and the
 * stored value after it.
 * ⚠ The read itself, its `try` and its key filtering are {@link storedWells}.
 */
/**
 * 🔒 **THE CHANNEL PICKER FORGETS ITS COLLAPSES WHEN THE APP RESTARTS** (Samuel,
 * 2026-09-20: *"if a user closes the recent, pinned, or whatever dropdowns, have
 * it so that it resets to being open when they open and reopen the app or if the
 * app gets hard reloaded … Not when they change the page"*).
 *
 * ⚠ **THAT LIFETIME IS NEITHER `localStorage` NOR COMPONENT STATE, WHICH IS WHY
 * IT IS A MODULE MAP.** `localStorage` outlives a restart, which is the thing he
 * does not want; `useState` alone dies when the list UNMOUNTS, which is every
 * page change — the thing he explicitly does want kept. A module-scope map lives
 * exactly as long as the JS context: it survives navigation and it is gone on a
 * hard reload, on a quit and on a relaunch.
 * ⚠ **`sessionStorage` WAS THE OBVIOUS ALTERNATIVE AND IT IS WRONG HERE.** It
 * SURVIVES a reload, so the reset would never fire on the half of the ruling that
 * names one.
 * ⚠ **KEYED BY THE SAME `storageKey`**, so a surface cannot accidentally read
 * another's memory, and the one-key-per-surface rule above covers both stores.
 */
const sessionWells = new Map<string, Record<string, boolean>>();

/**
 * **DROP EVERY REMEMBERED SESSION CHOICE — what a relaunch does, on demand.**
 *
 * ⚠ **IT EXISTS FOR TESTS AND IT IS NOT A BACK DOOR.** A module map lives as long
 * as the JS context, which in the product is exactly one app run and in a test
 * FILE is every case in it — so a suite that collapses a well in one case would
 * otherwise start the next one collapsed, which is a shared-state bug wearing a
 * feature's clothes. A runner has no other way to get a fresh context.
 * ⚠ **NOTHING IN THE APP MAY CALL IT.** Resetting mid-run is precisely the
 * surprise the ruling forbids for a page change.
 */
export function resetSessionWells(): void {
  sessionWells.clear();
}

/** Which store a surface's choice lives in — see {@link sessionWells}. */
export type WellStore = "device" | "session";

export function useWells<Id extends string>(
  storageKey: string,
  wells: readonly WellSpec<Id>[],
  /** ⚠ `"device"` IS THE DEFAULT so every existing caller is byte-for-byte
   *  unchanged; only the channel picker asks for `"session"`. */
  store: WellStore = "device"
): {
  isOpen: (id: Id) => boolean;
  toggle: (id: Id) => void;
} {
  const [open, setOpen] = useState<OpenMap<Id>>(() =>
    store === "session"
      ? // The module map, never localStorage; empty (first render after a relaunch) ⇒ defaults.
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
        // storage unavailable — the choice still holds for this session
      }
    },
    [open, storageKey, store]
  );

  const isOpen = useCallback((id: Id) => open[id], [open]);
  return { isOpen, toggle };
}
