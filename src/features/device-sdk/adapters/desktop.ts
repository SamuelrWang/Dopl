/**
 * `desktop` — a computer running the Dopl desktop app, as a C9 `DeviceAdapter`.
 *
 * Presence and notifications only (A3 scope). Presence uses the prosumer window
 * (`devices/server/devices-service.ts › COMPUTER_ONLINE_WINDOW_MS`), which the desktop's heartbeat
 * cadence is tested against, so the SDK and Settings > Devices agree on "online".
 *
 * Transport (C9): Dopl's own app on the machine → `on_device_runtime`; not experimental (D6).
 */

import type { CapabilityDescriptor, Device, DeviceAdapter, DeviceEvent, PairingFlow, PairingSession } from "@dopl/device-contracts";

import { COMPUTER_ONLINE_WINDOW_MS } from "@/features/devices/server/devices-service";

import { AdapterNotWiredError, descriptor, executeVia, noEvents, seenWithin, type Dispatcher } from "./shared";

export const DESKTOP_ADAPTER_ID = "desktop";
/** ⚠ The backfill in `20261122200000_device_sdk_devices.sql` writes this literal; a test holds them equal. */
export const DESKTOP_ADAPTER_VERSION = "0.1.0";
const SINCE = `${DESKTOP_ADAPTER_ID}@${DESKTOP_ADAPTER_VERSION}`;

const DESCRIPTORS: readonly CapabilityDescriptor[] = [
  descriptor(SINCE, "presence.read", "realtime", { online_window_s: COMPUTER_ONLINE_WINDOW_MS / 1000 }),
  descriptor(SINCE, "present.notify", "interactive"),
];

export interface DesktopAdapterDeps {
  now?: () => number;
  dispatch?: Dispatcher;
  pair?: (session: PairingSession) => Promise<PairingFlow>;
  events?: (device: Device) => AsyncIterable<DeviceEvent>;
}

export function createDesktopAdapter(deps: DesktopAdapterDeps = {}): DeviceAdapter {
  const now = deps.now ?? Date.now;
  const describe = () => DESCRIPTORS.map((d) => ({ ...d, limits: { ...d.limits } }));
  return {
    id: DESKTOP_ADAPTER_ID,
    version: DESKTOP_ADAPTER_VERSION,
    kinds: ["desktop"],
    transport: "on_device_runtime",
    experimental: false,
    describe,
    async pair(session) {
      if (!deps.pair) throw new AdapterNotWiredError(DESKTOP_ADAPTER_ID, "pair");
      return deps.pair(session);
    },
    execute: (device, capability, args) => executeVia(DESKTOP_ADAPTER_ID, describe, deps.dispatch, device, capability, args),
    events: (device) => (deps.events ? deps.events(device) : noEvents()),
    async health(device) {
      return {
        online: seenWithin(device.last_seen_at, COMPUTER_ONLINE_WINDOW_MS, now()),
        last_seen: device.last_seen_at,
        firmware: device.firmware,
      };
    },
  };
}
