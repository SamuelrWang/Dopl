import { definePersistedState, isStoredId } from "@/shared/lib/persisted-ui-state";
import { HOME_DEFAULT_TAB, HOME_TABS, type HomeTab } from "./home-tabs";

/**
 * /home's "where was I": the face (tab) and the selected row, per device, per
 * user, account-wide (/home has no workspace). Restored by `./index.tsx` so
 * leaving /home, reloading or restarting lands on the face the operator left
 * (Samuel, 2026-10-08: "remember which page I was on").
 *
 * Storage rules (scoping, versioning, never-an-error) are
 * `shared/lib/persisted-ui-state.ts`. A remembered row that no longer exists is
 * swept by the page once its rows have loaded.
 */
export interface HomeMemory {
  tab: HomeTab;
  /** `home-rows.ts` row id, or null for "none chosen". */
  rowId: string | null;
}

export const HOME_MEMORY_EMPTY: HomeMemory = { tab: HOME_DEFAULT_TAB, rowId: null };

const TAB_KEYS: ReadonlySet<string> = new Set(HOME_TABS.map((t) => t.key));

export function parseHomeMemory(raw: unknown): HomeMemory | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  return {
    // A tab a later build removed reads as the default, not as a blank pane.
    tab: typeof v.tab === "string" && TAB_KEYS.has(v.tab) ? (v.tab as HomeTab) : HOME_DEFAULT_TAB,
    rowId: isStoredId(v.rowId) ? v.rowId : null,
  };
}

export const homeMemory = definePersistedState<HomeMemory>({
  name: "home.lastFace",
  version: 1,
  fallback: HOME_MEMORY_EMPTY,
  // Version 0 never existed for this key: nothing pre-envelope to migrate.
  decode: (raw, fromVersion) => (fromVersion === 0 ? null : parseHomeMemory(raw)),
  isEmpty: (m) => m.tab === HOME_DEFAULT_TAB && m.rowId === null,
});

export const homeScope = (userId: string | undefined) => ({ userId, workspaceId: null });
