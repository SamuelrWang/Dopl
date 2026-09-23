/**
 * The identity editor's Runtime and Model rows: the Model row offers the identity's runtime's live
 * models and nobody else's; with no runtime or no catalog, "Default" plus the stored value as itself.
 */

import { agentModelLabel } from "@/features/channels/lib/agent-models";
import {
  findModel,
  modelOptionsFor,
  type ModelCatalog,
  type ModelCatalogs,
} from "@/features/channels/lib/model-catalog";
import { modelBelongsTo } from "@/features/channels/lib/model-affinity";
import type { RuntimeDescriptor } from "@/features/channels/lib/runtime-capability";

interface RowOption {
  key: string;
  label: string;
}

/** `""` on the draft = no runtime preference; the channel decides at launch. */
const NO_RUNTIME = "";
const NO_RUNTIME_LABEL = "Any";
/** `""` on the draft = no model; the runtime's own default. */
const NO_MODEL = "";

/** Registered runtimes; a stored id this desktop does not register is kept, as itself. */
export function identityRuntimeOptions(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  stored: string
): RowOption[] {
  const options = [
    { key: NO_RUNTIME, label: NO_RUNTIME_LABEL },
    ...runtimes.map((d) => ({ key: d.id, label: d.label })),
  ];
  if (stored && !runtimes.some((d) => d.id === stored)) {
    options.push({ key: stored, label: stored });
  }
  return options;
}

/** `catalogs` only labels a stored value the runtime's own catalog cannot offer; it never selects. */
export function identityModelOptions(
  runtime: string,
  catalog: ModelCatalog | null,
  stored: string,
  catalogs?: ModelCatalogs | null
): RowOption[] {
  const head = { key: NO_MODEL, label: agentModelLabel(NO_MODEL) };
  if (runtime && catalog) {
    return [head, ...modelOptionsFor(catalog, stored).map((o) => ({ key: o.value, label: o.label }))];
  }
  return stored ? [head, { key: stored, label: agentModelLabel(stored, catalogs) }] : [head];
}

/** The option key a stored model selects — an alias resolves to its catalog id. */
export function identityModelKey(catalog: ModelCatalog | null, stored: string): string {
  return findModel(catalog, stored)?.id ?? stored;
}

/**
 * The model a runtime switch keeps: none when the runtime is cleared, none when
 * the new runtime's ready catalog positively lacks it, otherwise unchanged.
 */
export function modelAfterRuntimeChange(
  nextRuntime: string,
  nextCatalog: ModelCatalog | null,
  model: string
): string {
  if (!nextRuntime || !model) return NO_MODEL;
  return modelBelongsTo(nextCatalog, model) === false ? NO_MODEL : model;
}
