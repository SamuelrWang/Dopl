/**
 * Model labels for glance and picker surfaces. Pickers read one runtime's catalog
 * (`model-catalog.ts`); this only names ids, preferring the live catalogs the caller holds.
 * An id nobody names renders as itself, never blank (INVARIANTS §11).
 */

import { findModel, type CatalogModel, type ModelCatalogs } from "./model-catalog";

/** Labelling is not selecting: any runtime's catalog may name an id here. */
function liveEntry(catalogs: ModelCatalogs | null | undefined, id: string): CatalogModel | null {
  for (const c of Object.values(catalogs ?? {})) {
    const hit = findModel(c, id);
    if (hit) return hit;
  }
  return null;
}

/** "No model pick" on the wire: no field at all, never a `"default"` id. */
export const AGENT_MODEL_DEFAULT = "" as const;

/**
 * Claude's display names, used when no catalog names the id. `short` is the chip word.
 * ⚠ `dopl-desktop-app/test/runtime-model-catalog.test.mjs` source-reads this table against
 * `main/runtime/claude/models.js › LABELS`.
 */
export const AGENT_MODELS: ReadonlyArray<{
  id: string;
  label: string;
  short: string;
}> = [
  { id: "claude-fable-5", label: "Fable 5", short: "Fable" },
  { id: "claude-opus-5", label: "Opus 5", short: "Opus" },
  { id: "claude-sonnet-5", label: "Sonnet 5", short: "Sonnet" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", short: "Haiku" },
];

/** The full label for a picker surface. Unset reads "Default"; an unknown id reads as itself. */
export function agentModelLabel(
  id: string | null | undefined,
  catalogs?: ModelCatalogs | null
): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (!trimmed) return "Default";
  return (
    liveEntry(catalogs, trimmed)?.label ||
    (AGENT_MODELS.find((m) => m.id === trimmed)?.label ?? trimmed)
  );
}

/**
 * The chip word for a glance surface. `null` = render no chip: a card states what an agent
 * runs, and "Default" there would claim knowledge the build does not have.
 */
export function agentModelShortLabel(
  id: string | null | undefined,
  catalogs?: ModelCatalogs | null
): string | null {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (!trimmed) return null;
  const live = liveEntry(catalogs, trimmed);
  return live?.short || live?.label || (AGENT_MODELS.find((m) => m.id === trimmed)?.short ?? trimmed);
}

/** A bridge reply's model as an id, or `null` for unset. Unknown ids are kept (the roster moves). */
export function normalizeAgentModel(raw: unknown): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || null;
}
