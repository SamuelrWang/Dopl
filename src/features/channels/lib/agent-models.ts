/**
 * Model labels for glance and picker surfaces. Pickers read one runtime's catalog
 * (`model-catalog.ts`); this only names ids, from the live catalogs the caller holds.
 *
 * ⚠ NO MODEL ID LIVES IN THIS TREE (2026-10-08, SDK resilience #3). The roster is the runtime's and
 * moves without Dopl shipping, so a typed lineup could only go stale (it did: 4.8/4.7/4.6). With no
 * catalog naming an id, it renders through `prettifyModelId` — the id itself, reformatted by a rule that
 * knows no vendor and no model — never blank and never a name the build guessed (INVARIANTS §11).
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

// A version part: one or two digits (`5`, `05`). A longer run (`20251001`) is a date or build and stays whole.
const VERSION_PART = /^\d{1,2}$/;

/**
 * The ONE offline rendering of a model id: separators become spaces, adjacent short number parts join
 * with dots, each word gains a capital, and a trailing `[…]` variant is kept verbatim. It reformats what
 * the runtime sent; it adds and drops nothing (`claude-opus-5-5[1m]` → `Claude Opus 5.5 [1m]`,
 * `gpt-6-sol` → `Gpt 6 Sol`). An id it cannot split renders as itself.
 */
export function prettifyModelId(id: string): string {
  const raw = id.trim();
  const m = /^(.*?)(\[[^\]]*\])?$/.exec(raw);
  const stem = m?.[1] ?? raw;
  const variant = m?.[2] ?? "";
  const parts = stem.split(/[-_\s/]+/).filter(Boolean);
  if (!parts.length) return raw;
  const words: string[] = [];
  for (const p of parts) {
    const prev = words[words.length - 1];
    if (VERSION_PART.test(p) && prev !== undefined && /^\d{1,2}(\.\d{1,2})*$/.test(prev)) {
      words[words.length - 1] = `${prev}.${p}`;
    } else {
      words.push(p.charAt(0).toUpperCase() + p.slice(1));
    }
  }
  return variant ? `${words.join(" ")} ${variant}` : words.join(" ");
}

/** The full label for a picker surface. Unset reads "Default"; an id no catalog names reads prettified. */
export function agentModelLabel(
  id: string | null | undefined,
  catalogs?: ModelCatalogs | null
): string {
  const trimmed = typeof id === "string" ? id.trim() : "";
  if (!trimmed) return "Default";
  return liveEntry(catalogs, trimmed)?.label || prettifyModelId(trimmed);
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
  return live?.short || live?.label || prettifyModelId(trimmed);
}

/** A bridge reply's model as an id, or `null` for unset. Unknown ids are kept (the roster moves). */
export function normalizeAgentModel(raw: unknown): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || null;
}
