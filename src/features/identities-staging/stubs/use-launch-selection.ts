"use client";

/**
 * STAGING STUB of `src/features/channels/hooks/use-launch-selection.ts`, for the one call the
 * identity editor makes (`{ kind: "defaults" }`): the registered runtimes and their model
 * catalogs, from `../data.ts`. No Electron bridge.
 */
import type { ModelCatalog, ModelCatalogs } from "@/features/channels/lib/model-catalog";
import type { RuntimeDescriptor } from "@/features/channels/lib/runtime-capability";
import { STAGING_CATALOGS, STAGING_RUNTIMES } from "../data";

export function useLaunchSelection(target: { kind: "defaults" }): {
  catalogFor: (runtime: string) => ModelCatalog | null;
  catalogs: ModelCatalogs;
  runtimes: ReadonlyArray<RuntimeDescriptor>;
} {
  void target;
  return {
    catalogFor: (runtime) => STAGING_CATALOGS[runtime] ?? null,
    catalogs: STAGING_CATALOGS,
    runtimes: STAGING_RUNTIMES,
  };
}
