/**
 * A `LaunchSelectionState` FOR A SUITE THAT IS NOT ABOUT THE BRIDGE — the shared stub for every
 * surface that renders the launch-settings group (2026-09-21, U7/U8).
 *
 * ⚠ **ONE FILE BECAUSE FOUR SUITES NEED THE SAME SHAPE.** The New Agent popup's three suites and
 * the Settings tab's all mount a component that takes this object; a copy in each is how two
 * suites come to drive two different contracts and neither notices when the real one moves.
 * `settings-agent-harness.tsx` sets the same precedent for the tab's own render helper.
 *
 * ⚠ **THE DESCRIPTORS ARE THE REAL ADAPTERS', NEVER HAND-WRITTEN** — every claim a suite makes
 * about a runtime's vocabulary is a claim about what an ADAPTER declares, so a descriptor change
 * on the desktop side has to fail these suites (`lib/runtime-descriptors-harness.ts` argues it).
 * The CATALOGS are hand-built, deliberately: they are a live wire answer, not a declaration, and
 * there is no roster on this machine to read.
 *
 * ⚠ NOT A `*.test.ts` NAME ON PURPOSE — `vitest.config.ts` includes exactly `src/**​/*.test.ts(x)`,
 * so this file is imported and never collected.
 */

import { vi } from "vitest";
import type { ModelCatalog, ModelCatalogs } from "../lib/model-catalog";
import { REAL_DEFAULT_RUNTIME, REAL_DESCRIPTORS } from "../lib/runtime-descriptors-harness";
import type { RuntimeRecord } from "../lib/launch-selection";
import type { LaunchSelectionState } from "./use-launch-selection";

/** A `ready` catalog, in the runtime's own order. ⚠ `isDefault` marks EXACTLY one member. */
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

/**
 * ⚠ **`update` IS A `vi.fn()` BY DEFAULT AND THAT IS THE POINT** — the payload a control produces
 * is the thing most of these suites are actually about, and a stub that swallowed it silently
 * would let a row write the wrong key for a release.
 */
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
    // ⚠ DERIVED FROM `byRuntime` RATHER THAN OVERRIDABLE, so a suite cannot set `record` and
    // `recordFor` to disagree — which is exactly the state "switch away and back" is about.
    record: over.record ?? byRuntime[over.runtime ?? ""] ?? {},
    recordFor: (id: string) => byRuntime[id || defaultRuntime] ?? {},
    catalogFor: (id: string) => catalogs[id || defaultRuntime] ?? null,
  };
}

/**
 * `window.dopl.channels` answering ONE channel launch record, as a current main does: every real
 * adapter, all connected, the channel on `runtime` (`''` = the default adapter).
 */
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
