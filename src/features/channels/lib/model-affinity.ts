/**
 * Which runtime a model id belongs to: a model a reported runtime's READY catalog offers belongs to
 * it. "Cannot tell" (catalog absent/loading/stale/unavailable) is its own answer, never "foreign".
 * ⚠ A descriptor's open pick pattern is not a membership check (Codex's matches `claude-*`).
 */

import {
  catalogFor,
  catalogReady,
  findModel,
  type ModelCatalog,
  type ModelCatalogs,
} from "./model-catalog";
import type { RuntimeDescriptor } from "./runtime-capability";

/** Does this runtime offer this model? `null` = cannot say. ⚠ Only a `ready` catalog may answer `false`. */
export function modelBelongsTo(
  catalog: ModelCatalog | null | undefined,
  modelId: string | null | undefined
): boolean | null {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id) return null;
  if (!catalogReady(catalog) || !catalog) return null;
  // A declared alias (a legacy stored id) is membership too.
  return findModel(catalog, id) !== null;
}

/** The first runtime (registry order) whose ready catalog offers the id, or `null`. */
function runtimeForModel(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  catalogs: ModelCatalogs | null | undefined,
  modelId: string | null | undefined
): RuntimeDescriptor | null {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id) return null;
  for (const d of runtimes) {
    if (modelBelongsTo(catalogFor(catalogs, d.id), id) === true) return d;
  }
  return null;
}

/**
 * May this model be submitted on the selected runtime? The selected catalog's answer wins; when it
 * cannot tell, another ready catalog that owns the id refuses it (the runtime-switch race). A
 * genuinely unknown id passes.
 */
export function modelSubmittableForRuntime(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  catalogs: ModelCatalogs | null | undefined,
  selected: RuntimeDescriptor | null | undefined,
  selectedCatalog: ModelCatalog | null | undefined,
  modelId: string | null | undefined
): boolean {
  const membership = modelBelongsTo(selectedCatalog, modelId);
  if (membership === true) return true;
  if (membership === false) return false;
  const owner = runtimeForModel(runtimes, catalogs, modelId);
  return !owner || !selected || owner.id === selected.id;
}

/** What a mismatch is, once one is found. */
export interface ModelMismatch {
  owner: RuntimeDescriptor;
  modelId: string;
  /** One line, in both platforms' own labels. */
  sentence: string;
}

/**
 * An identity model owned by a runtime other than the selected one, or `null`. The sentence states
 * the fact and its consequence (INVARIANTS §5).
 */
export function identityModelMismatch(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  catalogs: ModelCatalogs | null | undefined,
  selected: RuntimeDescriptor | null | undefined,
  modelId: string | null | undefined
): ModelMismatch | null {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  if (!id || !selected) return null;
  const owner = runtimeForModel(runtimes, catalogs, id);
  if (!owner || owner.id === selected.id) return null;
  return {
    owner,
    modelId: id,
    sentence: `${id} is a ${owner.label} model, so it is not used on ${selected.label}.`,
  };
}
