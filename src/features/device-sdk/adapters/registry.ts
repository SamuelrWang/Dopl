/**
 * The Device SDK adapter registry (SPEC-v1 › C9): every `DeviceAdapter`, keyed by `adapter_id`
 * (`devices.adapter_id`). Generalises `src/features/glasses/platforms/registry.ts › glassesPlatform`
 * beyond glasses; that registry stays the prosumer path's entry point, unchanged.
 *
 * The default registry holds UNWIRED adapters (describe/health work; pair/execute/events need ports
 * wired by A4 Connect and A5 delivery). Build a wired one with {@link createAdapterRegistry}.
 */

import type { DeviceAdapter, DeviceKind, Environment } from "@dopl/device-contracts";

import { createDesktopAdapter } from "./desktop";
import { createEvenG2Adapter } from "./even-g2";
import { createGoogleHomeAdapter } from "./google-home";
import { SIMULATOR_ADAPTER_ID, createSimulatorAdapter } from "./simulator";

export interface ListOptions {
  env: Environment;
  /** D6: reverse-engineered adapters are offered only when asked for. Default false. */
  includeExperimental?: boolean;
}

export interface AdapterRegistry {
  /** The adapter with this id, or null (never a silent fallback: a device names its adapter). */
  get(id: string): DeviceAdapter | null;
  /** The adapters a project may use in `env`: the simulator only in `test`, experimental only on request. */
  list(opts: ListOptions): DeviceAdapter[];
  /** {@link list}, narrowed to adapters that serve `kind`. */
  forKind(kind: DeviceKind, opts: ListOptions): DeviceAdapter[];
}

export function createAdapterRegistry(adapters: DeviceAdapter[]): AdapterRegistry {
  const byId = new Map<string, DeviceAdapter>();
  for (const a of adapters) {
    if (byId.has(a.id)) throw new Error(`duplicate device adapter id: ${a.id}`);
    byId.set(a.id, a);
  }
  const list = ({ env, includeExperimental = false }: ListOptions) =>
    adapters.filter((a) => (a.id !== SIMULATOR_ADAPTER_ID || env === "test") && (includeExperimental || !a.experimental));
  return {
    get: (id) => byId.get(id) ?? null,
    list,
    forKind: (kind, opts) => list(opts).filter((a) => a.kinds.includes(kind)),
  };
}

export const deviceAdapters: AdapterRegistry = createAdapterRegistry([
  createEvenG2Adapter(),
  createDesktopAdapter(),
  createGoogleHomeAdapter(),
  createSimulatorAdapter(),
]);
