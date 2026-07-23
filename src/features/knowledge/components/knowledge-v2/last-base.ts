/**
 * Per-workspace "last opened knowledge base" persistence.
 *
 * Scoped by workspace id (a base id saved in workspace A must never be
 * consulted in workspace B — mirrors the tour feature's per-workspace
 * resume key in `features/tour/constants.ts`). Storage failures (private
 * mode, disabled storage, SSR) degrade to "no preference" rather than
 * throwing.
 */

const KB_LAST_PREFIX = "dopl:kb-last";

/** localStorage key holding the last-opened base id for a workspace. */
export function kbLastBaseKey(workspaceId: string): string {
  return `${KB_LAST_PREFIX}:${workspaceId}`;
}

export function readLastBaseId(workspaceId: string): string | null {
  try {
    return window.localStorage.getItem(kbLastBaseKey(workspaceId));
  } catch {
    return null;
  }
}

export function writeLastBaseId(workspaceId: string, baseId: string): void {
  try {
    window.localStorage.setItem(kbLastBaseKey(workspaceId), baseId);
  } catch {
    // Storage unavailable (private mode / quota / SSR) — non-fatal.
  }
}
