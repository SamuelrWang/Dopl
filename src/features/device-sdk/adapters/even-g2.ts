/**
 * `even_g2` — Even Realities G2 glasses, as a C9 `DeviceAdapter`.
 *
 * Wraps the existing glasses platform (`src/features/glasses/platforms/even-g2/`) without changing
 * it: the prosumer path keeps reaching the G2 through `platforms/registry.ts › glassesPlatform`. The
 * descriptors are DERIVED from that platform's own constants (`even-g2/display.ts ›
 * PRESENT_DISPLAY_LIMITS`, `core/validation.ts › GLASSES_LIMITS`), so the SDK and the compiler
 * cannot drift apart.
 *
 * Transport (C9): the Dopl plugin runs inside Even Hub, Even's official plugin runtime, so
 * `on_device_runtime` and — D6 — NOT experimental.
 */

import { ASK_HOLD_MAX_S, type CapabilityDescriptor, type DeviceAdapter, type PairingFlow, type PairingSession, type DeviceEvent, type Device } from "@dopl/contracts/device-sdk";

import { isOnline } from "@/features/glasses/core/devices/service";
import { GLASSES_LIMITS } from "@/features/glasses/core/validation";
import { PRESENT_DISPLAY_LIMITS } from "@/features/glasses/platforms/even-g2/display";
import { EVEN_G2_INFO } from "@/features/glasses/platforms/even-g2/info";

import { AdapterNotWiredError, descriptor, executeVia, noEvents, type Dispatcher } from "./shared";

/** ⚠ The backfill in `20261122200000_device_sdk_devices.sql` writes this literal; a test holds them equal. */
export const EVEN_G2_ADAPTER_VERSION = "0.1.0";
const SINCE = `${EVEN_G2_INFO.id}@${EVEN_G2_ADAPTER_VERSION}`;
const L = GLASSES_LIMITS;

/** What the G2 can do today through the Dopl plugin (glasses MCP: status, notify, show/render, ask; voice; taps). */
const DESCRIPTORS: readonly CapabilityDescriptor[] = [
  descriptor(SINCE, "presence.read", "realtime"),
  descriptor(SINCE, "present.notify", "interactive", {
    title_bytes: L.title,
    body_bytes: L.body,
    line_bytes: L.line,
    max_lines: L.lines.max,
    charset: PRESENT_DISPLAY_LIMITS.charset,
  }),
  descriptor(SINCE, "present.display", "interactive", PRESENT_DISPLAY_LIMITS),
  descriptor(SINCE, "ask.choice", "interactive", {
    question_bytes: L.question,
    option_bytes: L.option,
    min_options: L.options.min,
    max_options: L.options.max,
    hold_s: ASK_HOLD_MAX_S,
  }),
  descriptor(SINCE, "input.utterance", "realtime"),
  descriptor(SINCE, "input.tap", "realtime"),
];

export interface EvenG2AdapterDeps {
  now?: () => number;
  /** Delivery to the plugin (A5). */
  dispatch?: Dispatcher;
  /** Code pairing inside a Connect session (A4). */
  pair?: (session: PairingSession) => Promise<PairingFlow>;
  /** Voice and tap input from the plugin. */
  events?: (device: Device) => AsyncIterable<DeviceEvent>;
}

export function createEvenG2Adapter(deps: EvenG2AdapterDeps = {}): DeviceAdapter {
  const now = deps.now ?? Date.now;
  const describe = () => DESCRIPTORS.map((d) => ({ ...d, limits: { ...d.limits } }));
  return {
    id: EVEN_G2_INFO.id,
    version: EVEN_G2_ADAPTER_VERSION,
    kinds: ["glasses"],
    transport: "on_device_runtime",
    experimental: false,
    describe,
    async pair(session) {
      if (!deps.pair) throw new AdapterNotWiredError(EVEN_G2_INFO.id, "pair");
      return deps.pair(session);
    },
    execute: (device, capability, args) => executeVia(EVEN_G2_INFO.id, describe, deps.dispatch, device, capability, args),
    events: (device) => (deps.events ? deps.events(device) : noEvents()),
    async health(device) {
      return {
        // The same window the prosumer device list uses (`glasses/core/devices/service.ts › isOnline`).
        online: isOnline({ last_seen: device.last_seen_at }, now()),
        last_seen: device.last_seen_at,
        firmware: device.firmware,
      };
    },
  };
}
