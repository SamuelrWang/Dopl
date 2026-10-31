/**
 * `google_home` — a Google Home speaker reached over Google Cast, as a C9 `DeviceAdapter`.
 *
 * Cast is LAN-only, so the server cannot reach the speaker: a bridge on the user's own network pulls the
 * device's queue and casts (`dopl-desktop-app/main/google-home/bridge.js`). Transport `local_bridge`.
 * Output only: Cast gives no answer back, so nothing here can ask, and no render is ever confirmed.
 * Speech only for now. A screen (Nest Hub) would need `present.display` and per-model descriptors.
 */

import type { CapabilityDescriptor, Device, DeviceAdapter, DeviceEvent, PairingFlow, PairingSession } from "@dopl/device-contracts";

import { AdapterNotWiredError, descriptor, executeVia, noEvents, seenWithin, type Dispatcher } from "./shared";

export const GOOGLE_HOME_ADAPTER_ID = "google_home";
export const GOOGLE_HOME_ADAPTER_VERSION = "0.1.0";
const SINCE = `${GOOGLE_HOME_ADAPTER_ID}@${GOOGLE_HOME_ADAPTER_VERSION}`;

/** The bridge polls every few seconds; this many quiet seconds means it stopped. */
export const BRIDGE_ONLINE_WINDOW_MS = 60_000;
/** The bridge's `service.js › LIMITS.text`, in characters. Refused above this, never shortened (D3). */
export const GOOGLE_HOME_SPEAK_MAX_CHARS = 500;

const DESCRIPTORS: readonly CapabilityDescriptor[] = [
  descriptor(SINCE, "presence.read", "realtime", { online_window_s: BRIDGE_ONLINE_WINDOW_MS / 1000 }),
  descriptor(SINCE, "present.speak", "interactive", { max_text_bytes: GOOGLE_HOME_SPEAK_MAX_CHARS }),
];

export interface GoogleHomeAdapterDeps {
  now?: () => number;
  dispatch?: Dispatcher;
  pair?: (session: PairingSession) => Promise<PairingFlow>;
  events?: (device: Device) => AsyncIterable<DeviceEvent>;
}

export function createGoogleHomeAdapter(deps: GoogleHomeAdapterDeps = {}): DeviceAdapter {
  const now = deps.now ?? Date.now;
  const describe = () => DESCRIPTORS.map((d) => ({ ...d, limits: { ...d.limits } }));
  return {
    id: GOOGLE_HOME_ADAPTER_ID,
    version: GOOGLE_HOME_ADAPTER_VERSION,
    kinds: ["home_hub"],
    transport: "local_bridge",
    experimental: false,
    describe,
    async pair(session) {
      if (!deps.pair) throw new AdapterNotWiredError(GOOGLE_HOME_ADAPTER_ID, "pair");
      return deps.pair(session);
    },
    execute: (device, capability, args) => executeVia(GOOGLE_HOME_ADAPTER_ID, describe, deps.dispatch, device, capability, args),
    events: (device) => (deps.events ? deps.events(device) : noEvents()),
    async health(device) {
      return {
        online: seenWithin(device.last_seen_at, BRIDGE_ONLINE_WINDOW_MS, now()),
        last_seen: device.last_seen_at,
        firmware: device.firmware,
      };
    },
  };
}
