/**
 * Router-shaped dependencies as injectable contracts, so the same components
 * serve the Next app and the desktop SPA (apps/desktop-ui/CONVENTIONS.md
 * § Sharing code with the web app).
 *
 * `KnowledgeRouting` = coarse "leave this page / re-pull what this tree doesn't
 * own". `KnowledgeUrlSync` = fine-grained selection↔address-bar sync. ⚠ Both
 * implementations must guarantee a base switch does NOT remount the shell.
 */

import type { KnowledgeBase } from "../../types";
import { knowledgeBaseSegment } from "../../url";

export interface KnowledgeRouting {
  /** Re-pull data this tree renders but does not own. Web app: `ownerNames` /
   *  `kbTeams` are RSC props → `router.refresh()`; SPA invalidates its own
   *  queries. */
  refreshServerData: () => void;
  /** Navigate to a base's page; `null` = base-less knowledge root. `push` for
   *  a user move (create), `replace` where the old URL must not survive in
   *  history (delete, canonical slug change). */
  goToBase: (base: KnowledgeBase | null, mode: "push" | "replace") => void;
}

export interface KnowledgeUrlLocation {
  /** `{slug}-{publicId}`, or null at the knowledge root. */
  baseSegment: string | null;
  entryId: string | null;
}

/**
 * ⚠ IMPLEMENTATIONS MUST BE REFERENTIALLY STABLE for the life of a mounted
 * knowledge view. The controller's write effect depends on this object; an
 * adapter rebuilt on every URL change re-runs that effect with the pre-change
 * selection and writes the stale URL back over the new one. Read the live
 * location through a ref inside `current`/`read` instead.
 */
export interface KnowledgeUrlSync {
  /** Comparable to `current()`. */
  urlFor: (location: KnowledgeUrlLocation) => string;
  current: () => string;
  /** ⚠ Address bar only — must NOT unmount this tree. */
  write: (url: string, mode: "push" | "replace") => void;
  read: () => KnowledgeUrlLocation;
  /** Returns an unsubscribe. */
  subscribe: (handler: () => void) => () => void;
}

export function locationForSelection(
  selection: { kind: "base" | "entry"; base: KnowledgeBase; entry?: { id: string } } | null
): KnowledgeUrlLocation {
  if (!selection) return { baseSegment: null, entryId: null };
  return {
    baseSegment: knowledgeBaseSegment(selection.base),
    entryId: selection.kind === "entry" ? (selection.entry?.id ?? null) : null,
  };
}

/**
 * WEB app sync: `window.location` + History API. ⚠ Shallow updates only — no
 * Next navigation, so the shell never remounts and no server round-trip fires
 * for a selection change.
 */
export function createHistoryUrlSync(workspaceSegment: string): KnowledgeUrlSync {
  const root = `/${workspaceSegment}/knowledge`;
  return {
    urlFor: ({ baseSegment, entryId }) => {
      if (!baseSegment) return root;
      const path = `${root}/${baseSegment}`;
      return entryId ? `${path}?entryId=${entryId}` : path;
    },
    current: () => window.location.pathname + window.location.search,
    write: (url, mode) => {
      if (mode === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    read: () => {
      const parts = window.location.pathname.split("/").filter(Boolean);
      // /{ws}/knowledge/{seg?}
      const baseSegment = parts[1] === "knowledge" ? (parts[2] ?? null) : null;
      return {
        baseSegment,
        entryId: new URLSearchParams(window.location.search).get("entryId"),
      };
    },
    subscribe: (handler) => {
      window.addEventListener("popstate", handler);
      return () => window.removeEventListener("popstate", handler);
    },
  };
}
