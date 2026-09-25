/**
 * Test harness (not collected: not a `*.test.ts` name): a `LaunchSelectionState` stub for suites
 * that render the launch-settings group. Descriptors are the real adapters'
 * (`runtime-descriptors-harness.ts`); catalogs are hand-built wire answers.
 */

import { vi } from "vitest";
import { CATALOG_VERSION, type ModelCatalog, type ModelCatalogs } from "../lib/model-catalog";
import { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS, REAL_PERMISSION_LEVELS } from "../lib/runtime-descriptors-harness";
import type { PermissionLevel, PermissionLevels } from "../lib/launch-selection";
import type { LaunchSelectionState } from "./use-launch-selection";

export interface CatalogModelInput {
  id: string;
  /** Omitted = the id; `null` = a model the runtime does not name. */
  label?: string | null;
  /** Omitted = the label. */
  short?: string | null;
  isDefault?: boolean;
  hidden?: boolean;
  aliases?: string[];
  efforts?: string[];
  /** Omitted = the first effort. */
  effortDefault?: string;
}

/** A `ready` catalog in the runtime's own order; `isDefault` marks one member. */
export function catalog(
  runtime: string,
  models: ReadonlyArray<CatalogModelInput>,
  over: Partial<ModelCatalog> = {}
): ModelCatalog {
  return {
    runtime,
    source: "live",
    status: "ready",
    reason: "",
    models: models.map((m) => {
      const label = m.label === undefined ? m.id : m.label;
      return {
        id: m.id,
        label,
        short: m.short === undefined ? label : m.short,
        isDefault: m.isDefault === true,
        hidden: m.hidden === true,
        aliases: m.aliases ?? [],
        dimensions: (m.efforts
          ? {
              reasoningEffort: {
                options: m.efforts.map((v) => ({ value: v, label: v, description: null })),
                default: m.effortDefault ?? m.efforts[0] ?? null,
              },
            }
          : {}) as ModelCatalog["models"][number]["dimensions"],
      };
    }),
    defaultId: models.find((m) => m.isDefault)?.id ?? null,
    dimensions: models.some((m) => m.efforts) ? ["reasoningEffort"] : [],
    truncated: false,
    ...over,
  };
}

/** {@link catalog} as the desktop sends it (`main/runtime/model-catalog.js › makeCatalog`): with the
 *  per-catalog `version` and `key` the web normaliser ignores. */
export function wireCatalog(
  runtime: string,
  models: ReadonlyArray<CatalogModelInput>,
  over: Partial<ModelCatalog> = {}
) {
  return { version: CATALOG_VERSION, key: null, ...catalog(runtime, models, over) };
}

export interface SelectionStubInput extends Partial<Omit<LaunchSelectionState, "levelFor" | "settingFor" | "catalogFor">> {
  /** A runtime's own level where it differs from `level` (a migrated override). */
  byRuntime?: Record<string, PermissionLevel>;
  /** Omitted = main's real reading of each level. */
  permissionLevels?: PermissionLevels;
  catalogs?: ModelCatalogs;
}

/** `update` is a `vi.fn()` so suites can assert the payload a control writes. */
export function launchSelectionStub(over: SelectionStubInput = {}): LaunchSelectionState {
  const { byRuntime = {}, permissionLevels = REAL_PERMISSION_LEVELS, ...rest } = over;
  const level = over.level ?? "ask";
  const catalogs = over.catalogs ?? ({} as ModelCatalogs);
  const defaultRuntime = over.defaultRuntime ?? "";
  return {
    bridge: { read: async () => null, write: async () => ({ ok: true }) },
    runtimeSupported: false,
    runtimes: [],
    connected: [],
    connectedKnown: false,
    defaultRuntime,
    runtime: "",
    descriptor: null,
    messages: "ask",
    level,
    review: [],
    rejected: [],
    agentChain: false,
    busy: false,
    update: vi.fn().mockResolvedValue(undefined),
    ...rest,
    catalogs,
    // Both derive from `byRuntime` so they cannot disagree.
    levelFor: (id: string) => byRuntime[id || defaultRuntime] ?? level,
    settingFor: (id: string) => permissionLevels[id || defaultRuntime]?.[byRuntime[id || defaultRuntime] ?? level] ?? null,
    catalogFor: (id: string) => catalogs[id || defaultRuntime] ?? null,
  };
}

/** `window.dopl.channels` answering one channel record: every real adapter, all connected. */
export function channelRecordBridge(over: { runtime?: string; catalogs?: ModelCatalogs } = {}) {
  return {
    getLaunchPosture: vi.fn().mockResolvedValue({
      runtimes: REAL_DESCRIPTORS,
      defaultRuntime: REAL_DEFAULT_RUNTIME,
      connected: REAL_DESCRIPTORS.map((d) => d.id),
      catalogVersion: 1,
      catalogs: over.catalogs ?? {},
      permissionLevels: REAL_PERMISSION_LEVELS,
      selection: { v: 3, runtime: over.runtime ?? "", messages: "ask", level: "ask", byRuntime: {} },
    }),
    setLaunchPosture: vi.fn().mockResolvedValue({ ok: true }),
  };
}
