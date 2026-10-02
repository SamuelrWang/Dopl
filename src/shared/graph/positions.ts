import type { GraphLayout } from "./types";

/**
 * ⚠ Merge-except-empty, defined once for the ontology repository. Empty patch
 * = reset signal → REPLACES with `{}`. Any other patch SHALLOW-MERGES per
 * node id: the `layout` column is one blob, so a partial write must fold in
 * untouched nodes here or two tabs dragging different cards clobber.
 */
export function mergeStoredLayout(
  current: GraphLayout | null | undefined,
  patch: GraphLayout
): GraphLayout {
  if (Object.keys(patch).length === 0) return {};
  return { ...(current ?? {}), ...patch };
}
