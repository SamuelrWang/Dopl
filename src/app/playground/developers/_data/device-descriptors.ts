/**
 * SERVER SIDE: a device type's capabilities, read from its registry adapter's C3 descriptors
 * (`adapter.describe`). The adapters pull in glasses-platform server code, so only the route pages
 * (server components) and tests import this; the client sections receive the result as props.
 */
import "server-only";
import type { CapabilityDescriptor, Device } from "@dopl/device-contracts";
import { deviceAdapters } from "@/features/device-sdk/adapters/registry";
import { DEMO_NOW } from "./fixtures";
import { ADDABLE_TYPES, deviceType } from "./device-types";

/** The device an adapter describes; the simulator answers per kind, the real adapters per model. */
function probe(kind: Device["kind"], adapter_id: string): Device {
  return {
    id: `probe_${adapter_id}`,
    kind,
    vendor: "dopl",
    model: adapter_id,
    firmware: null,
    adapter_id,
    adapter_version: "0.1.0",
    capabilities: [],
    online: true,
    last_seen_at: DEMO_NOW,
  };
}

export function describeType(id: string): CapabilityDescriptor[] | null {
  const type = deviceType(id);
  const adapter = type?.adapter_id ? deviceAdapters.get(type.adapter_id) : null;
  if (!type || !adapter) return null;
  return adapter.describe(probe(type.kind, adapter.id));
}

/** Every addable type's descriptors, keyed by type id. */
export function describeAll(): Record<string, CapabilityDescriptor[]> {
  return Object.fromEntries(ADDABLE_TYPES.map((t) => [t.id, describeType(t.id) ?? []]));
}
