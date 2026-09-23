/**
 * The New Agent dialog's Model row: what it shows, offers and submits. Pure — no React, no bridge.
 */

import {
  catalogReady,
  catalogReason,
  catalogSelection,
  modelLabel,
  modelOptionsFor,
  type ModelCatalog,
  type ModelCatalogs,
} from "../lib/model-catalog";
import {
  modelBelongsTo,
  modelSubmittableForRuntime,
  identityModelMismatch,
  type ModelMismatch,
} from "../lib/model-affinity";
import type { RuntimeDescriptor } from "../lib/runtime-capability";

/** Shown when a launch names no model and the catalog has no default: the platform picks. */
const PLATFORM_DEFAULT_LABEL = "Platform default";

export interface ModelRowInput {
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  catalogs: ModelCatalogs | null | undefined;
  catalog: ModelCatalog | null;
  selected: RuntimeDescriptor | null;
  /** The operator's per-launch pick — `''` until they touch the control. */
  own: string;
  fromIdentity: string;
}

export interface ModelRow {
  /** `''` means "the platform's own pick". */
  shown: string;
  shownLabel: string;
  options: ReadonlyArray<{ key: string; label: string }>;
  /** `false` renders a single-pill fact, not a greyed control. */
  selectable: boolean;
  /** Identity model owned by another runtime; `null` when it is not OR ownership is unknown. */
  mismatch: ModelMismatch | null;
  /** The desktop's own sentence about the roster, or `null`. */
  reason: string | null;
}

/**
 * Main's order — own pick > identity > the catalog's default. An identity model positively owned by
 * ANOTHER ready catalog is dropped and explained (`mismatch`), never translated. An own pick the
 * runtime's catalog lacks is refused `no-model` by main (`session-launch.js › refuseUnknownModel`).
 */
export function modelRowFor(input: ModelRowInput): ModelRow {
  const { catalog, selected, runtimes, catalogs } = input;
  const mismatch = identityModelMismatch(
    runtimes,
    catalogs,
    selected,
    input.fromIdentity
  );
  // Main skips an identity model the READY roster lacks (`launch-default.js › identityModelFor`).
  const usableIdentityModel =
    mismatch || modelBelongsTo(catalog, input.fromIdentity) === false ? "" : input.fromIdentity;
  const usableOwn = modelSubmittableForRuntime(
    runtimes,
    catalogs,
    selected,
    catalog,
    input.own
  )
    ? input.own
    : "";
  const resolved = usableOwn || usableIdentityModel;
  const shown = catalogSelection(catalog, resolved);
  // A pill row whose value matches no option selects nothing, so `''` gets its own pill.
  const options = modelOptionsFor(catalog, shown).map((o) => ({ key: o.value, label: o.label }));
  return {
    shown,
    shownLabel: shown ? modelLabel(catalog, shown) : PLATFORM_DEFAULT_LABEL,
    options: shown ? options : [{ key: "", label: PLATFORM_DEFAULT_LABEL }, ...options],
    selectable: catalogReady(catalog),
    mismatch,
    reason: catalogReason(catalog),
  };
}

/**
 * False only for a pick the selected catalog or another READY catalog positively rejects/owns;
 * genuinely unknown ids survive in the renderer (main may still refuse them `no-model`).
 */
export function ownPickSurvives(
  runtimes: ReadonlyArray<RuntimeDescriptor>,
  catalogs: ModelCatalogs | null | undefined,
  selected: RuntimeDescriptor | null,
  catalog: ModelCatalog | null,
  own: string
): boolean {
  return (
    !own || modelSubmittableForRuntime(runtimes, catalogs, selected, catalog, own)
  );
}
