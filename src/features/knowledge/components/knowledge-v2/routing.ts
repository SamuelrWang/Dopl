/**
 * The two router-shaped dependencies the Knowledge V2 tree used to import
 * from `next/navigation`, expressed as injectable contracts so the same
 * components serve the Next app and the desktop SPA
 * (apps/desktop-ui/CONVENTIONS.md § Sharing code with the web app).
 *
 * `KnowledgeRouting` covers the coarse "leave this page / re-pull what this
 * tree doesn't own" moves. `KnowledgeUrlSync` covers the fine-grained
 * selection↔address-bar sync the controller runs — the web app does it with
 * the raw History API precisely so a base switch does NOT remount the shell,
 * and the SPA needs the same no-remount guarantee against a hash router.
 */

import type { KnowledgeBase } from "../../types";
import { knowledgeBaseSegment } from "../../url";

export interface KnowledgeRouting {
  /**
   * Data this tree renders but does not own is stale — re-pull it. The web
   * app's `ownerNames`/`kbTeams` are RSC props, so it passes
   * `router.refresh()`; the SPA fetches them itself and invalidates those
   * queries instead.
   */
  refreshServerData: () => void;
  /**
   * Navigate to a base's page — `null` means the base-less knowledge root.
   * `push` for a user-initiated move (create), `replace` where the old URL
   * must not survive in history (delete, canonical slug change).
   */
  goToBase: (base: KnowledgeBase | null, mode: "push" | "replace") => void;
}

/** A knowledge URL, reduced to the two things it encodes. */
export interface KnowledgeUrlLocation {
  /** The `{slug}-{publicId}` segment, or null at the knowledge root. */
  baseSegment: string | null;
  entryId: string | null;
}

export interface KnowledgeUrlSync {
  /** The URL string a location maps to, comparable to `current()`. */
  urlFor: (location: KnowledgeUrlLocation) => string;
  /** The URL as it stands right now. */
  current: () => string;
  /** Put `url` in the address bar WITHOUT unmounting this tree. */
  write: (url: string, mode: "push" | "replace") => void;
  /** Parse the current URL back into a location. */
  read: () => KnowledgeUrlLocation;
  /** Fire `handler` on every URL change; returns an unsubscribe. */
  subscribe: (handler: () => void) => () => void;
}

/** The location a selection should put in the address bar. */
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
 * The WEB app's sync: `window.location` + the History API, i.e. exactly what
 * `use-knowledge-v2-controller` did inline before the seam existed. Shallow
 * updates only — no Next navigation, so the app shell never remounts and no
 * server round-trip fires for a selection change.
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
