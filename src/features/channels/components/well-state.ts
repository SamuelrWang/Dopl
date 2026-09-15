"use client";

/**
 * WHICH WELLS A SURFACE HAS, AND WHICH OF THEM ARE OPEN ON THIS DEVICE — **the
 * well set as DATA, with no box and no render.**
 *
 * ⚠ **SPLIT OUT OF `collapse-wells.tsx` ON 2026-09-15, WHEN THAT FILE CROSSED THE
 * 500-LINE CAP** (INVARIANTS §1: a file at the cap is a split, never a comment
 * trim). **The seam is DATA vs BOX** — this module answers "which wells exist and
 * which are open", that one answers "what one well looks like and how it grows" —
 * and it is a real reason-to-change, not a line count: the storage rules below
 * move when a surface gains a well, the geometry there moves when Samuel rules on
 * a shape. Neither has ever moved with the other.
 */

import { useCallback, useState } from "react";

/**
 * ONE WELL IN A CALLER'S SET — its id, the word on its header, and whether a
 * device that has never chosen finds it open.
 *
 * ⚠ **`defaultOpen` IS PART OF THE SET, NOT A CONSTANT IN THIS FILE.** It was
 * `WELLS_DEFAULT`, a hard-coded `{recent: true, …}` map, which is exactly the
 * thing a second well set cannot reuse — /home's defaults are Pinned AND Recent
 * open. ⚠ **ORDER IS THE DATA**: the render maps the caller's array, so there is
 * no second list to keep in step.
 */
export interface WellSpec<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly defaultOpen: boolean;
}

type OpenMap<Id extends string> = Record<Id, boolean>;

function wellDefaults<Id extends string>(
  wells: readonly WellSpec<Id>[]
): OpenMap<Id> {
  const out = {} as OpenMap<Id>;
  for (const well of wells) out[well.id] = well.defaultOpen;
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
  const defaults = wellDefaults(wells);
  if (typeof window === "undefined") return defaults;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return defaults;
  }
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const next = { ...defaults };
    for (const well of wells) {
      const value = parsed?.[well.id];
      if (typeof value === "boolean") next[well.id] = value;
    }
    return next;
  } catch {
    // a corrupt write is the defaults, never a crash
    return defaults;
  }
}

/**
 * WHICH WELLS ARE OPEN — the set's own defaults, then whatever this device last
 * chose under `storageKey`.
 *
 * ⚠ **PER DEVICE, NOT PER ACCOUNT, AND `localStorage` IS THE HONEST STORE FOR
 * THAT.** The Agents tab is an OPERATOR surface over one machine's own session
 * feed (§5), a collapsed well on the Threads tab is a reading posture, not a fact
 * about the channel, and a collapsed **Earlier** on /home's list is a posture over
 * a list the server knows nothing about the shape of — the server stores nothing
 * about any of the three, so a server-side preference would be the only
 * cross-machine claim on the panel.
 * ⚠ **READ IN A LAZY INITIALISER, NOT IN AN EFFECT, AND NO WELL EVER RENDERS ON A
 * SERVER.** `setState` inside an effect body is a cascading render this tree's lint
 * forbids outright (`react-hooks/set-state-in-effect`), so the usual "paint the
 * defaults, then correct them" shape is not available — and it is not needed,
 * because **no consuming surface has any item to file during a server render**:
 * `agents-tab.tsx` returns its desktop-only sentence whenever `sessions === null`
 * (which is what SSR always sees), the Threads tab's list arrives from
 * `hooks/use-channel-threads.ts` (a client fetch, empty until it resolves), and
 * /home's list is the SPA's, which has no server render at all. An empty list
 * renders no well, so there is no `aria-expanded` for a hydration pass to disagree
 * about. The initialiser still guards `typeof window` so the hook is honest on its
 * own.
 * ⚠ The read itself, its `try` and its key filtering are {@link storedWells}.
 */
export function useWells<Id extends string>(
  storageKey: string,
  wells: readonly WellSpec<Id>[]
): {
  isOpen: (id: Id) => boolean;
  toggle: (id: Id) => void;
} {
  const [open, setOpen] = useState<OpenMap<Id>>(() =>
    storedWells(storageKey, wells)
  );

  const toggle = useCallback(
    (id: Id) => {
      setOpen((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // storage unavailable — the choice still holds for this session
        }
        return next;
      });
    },
    [storageKey]
  );

  const isOpen = useCallback((id: Id) => open[id], [open]);
  return { isOpen, toggle };
}
