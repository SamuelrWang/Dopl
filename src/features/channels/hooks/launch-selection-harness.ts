/**
 * Test harness (not collected: not a `*.test.ts` name): a `LaunchSelectionState` stub for suites
 * that render the launch-settings group. Descriptors are the real adapters'
 * (`runtime-descriptors-harness.ts`); catalogs are hand-built wire answers.
 */

import { vi } from "vitest";
import type { ModelCatalog, ModelCatalogs } from "../lib/model-catalog";
import { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } from "../lib/runtime-descriptors-harness";
import type { RuntimeRecord } from "../lib/launch-selection";
import type { LaunchSelectionState } from "./use-launch-selection";

/** A `ready` catalog in the runtime's own order; `isDefault` marks one member. */
export function catalog(
  runtime: string,
  models: ReadonlyArray<{ id: string; label?: string; isDefault?: boolean; efforts?: string[] }>,
  over: Partial<ModelCatalog> = {}
): ModelCatalog {
  return {
    runtime,
    source: "live",
    status: "ready",
    reason: "",
    models: models.map((m) => ({
      id: m.id,
      label: m.label ?? m.id,
      short: m.label ?? m.id,
      isDefault: m.isDefault === true,
      hidden: false,
      aliases: [],
      dimensions: (m.efforts
        ? {
            reasoningEffort: {
              options: m.efforts.map((v) => ({ value: v, label: v, description: null })),
              default: m.efforts[0] ?? null,
            },
          }
        : {}) as ModelCatalog["models"][number]["dimensions"],
    })),
    defaultId: models.find((m) => m.isDefault)?.id ?? null,
    dimensions: models.some((m) => m.efforts) ? ["reasoningEffort"] : [],
    truncated: false,
    ...over,
  };
}

export interface SelectionStubInput extends Partial<Omit<LaunchSelectionState, "recordFor" | "catalogFor">> {
  /** `{ <runtimeId>: { tools?, native? } }` — what each runtime remembers. */
  byRuntime?: Record<string, RuntimeRecord>;
  catalogs?: ModelCatalogs;
}

/** `update` is a `vi.fn()` so suites can assert the payload a control writes. */
export function launchSelectionStub(over: SelectionStubInput = {}): LaunchSelectionState {
  const byRuntime = over.byRuntime ?? {};
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
    review: [],
    rejected: [],
    agentChain: false,
    busy: false,
    update: vi.fn().mockResolvedValue(undefined),
    ...over,
    catalogs,
    // Derived from `byRuntime` so `record` and `recordFor` cannot disagree.
    record: over.record ?? byRuntime[over.runtime ?? ""] ?? {},
    recordFor: (id: string) => byRuntime[id || defaultRuntime] ?? {},
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
      selection: { v: 2, runtime: over.runtime ?? "", messages: "ask", byRuntime: {} },
    }),
    setLaunchPosture: vi.fn().mockResolvedValue({ ok: true }),
  };
}
