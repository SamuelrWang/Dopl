/**
 * `simulator` — a simulated device of every kind, for test mode (SPEC-v1 › C10 "Test mode").
 *
 * Deterministic: no I/O, no randomness. A device whose id is a C10 magic id
 * (`@dopl/contracts/device-sdk › TEST_MAGIC_DEVICE_IDS`), exactly or as `<magic>_<suffix>`, forces
 * that failure on every `execute`; `sim_device_offline` is also offline in `health`. Every other
 * call that passes the capability and argument checks completes `done` with a simulated result.
 *
 * The registry offers it in the `test` environment only (`registry.ts › createAdapterRegistry`), and
 * `server/delivery-common.ts › toDevice` refuses it outside `test` again, so test data never touches
 * live. Connect-created devices have uuid ids, so the delivery layer also applies the magic ids by
 * the end user's `external_user_id` (`server/test-mode.ts`).
 *
 * `ask.*` answers are deterministic: `ask.choice` picks the first option, `ask.confirm` confirms,
 * `ask.text` replies "simulated reply".
 */

import {
  DEVICE_KINDS,
  TEST_MAGIC_DEVICE_IDS,
  type ActionResult,
  type CapabilityDescriptor,
  type CapabilityId,
  type Device,
  type DeviceAdapter,
  type DeviceEvent,
  type DeviceKind,
  type ErrorCode,
} from "@dopl/contracts/device-sdk";

import { descriptor, executeVia, failed, noEvents } from "./shared";

export const SIMULATOR_ADAPTER_ID = "simulator";
export const SIMULATOR_ADAPTER_VERSION = "0.1.0";
const SINCE = `${SIMULATOR_ADAPTER_ID}@${SIMULATOR_ADAPTER_VERSION}`;
const PAIRING_TTL_MS = 10 * 60 * 1000;

/** A plausible capability set per kind; enough to exercise routing and policy for each. */
const KIND_CAPABILITIES: Record<DeviceKind, CapabilityId[]> = {
  glasses: ["presence.read", "present.notify", "present.display", "present.speak", "ask.choice", "ask.confirm", "ask.text", "capture.photo", "capture.audio", "input.utterance", "input.tap"],
  phone: ["state.read", "presence.read", "present.notify", "present.display", "present.speak", "present.haptic", "ask.choice", "ask.confirm", "ask.text", "capture.photo", "capture.audio", "capture.video_stream", "input.utterance", "input.tap"],
  desktop: ["presence.read", "present.notify", "present.display", "ask.choice", "ask.confirm", "ask.text", "capture.screen", "input.utterance"],
  watch: ["presence.read", "telemetry.read", "present.notify", "present.haptic", "ask.choice", "ask.confirm", "input.tap", "input.button"],
  home_hub: ["state.read", "presence.read", "present.display", "present.speak", "ask.confirm", "input.utterance", "act.media"],
  home_device: ["state.read", "telemetry.read", "act.set", "act.lock"],
  vehicle: ["state.read", "telemetry.read", "present.notify", "present.speak", "act.navigate", "act.lock", "act.motion.vehicle"],
  robot: ["state.read", "telemetry.read", "capture.photo", "capture.video_stream", "act.motion.move", "act.motion.gripper"],
};

type Limits = Record<string, number | string>;

/**
 * Per-kind limits for the capabilities whose args the pipeline checks or whose text it fits (A6).
 * Modelled on a typical device of the kind (the glasses row matches the Even G2 lens), so a test
 * against a simulated watch truncates and caps options the way a real watch would.
 */
const display = (width_px: number, height_px: number, max_blocks: number, max_text_bytes: number, charset: string, color: string): Limits => ({
  width_px,
  height_px,
  max_blocks,
  max_text_bytes,
  charset,
  color,
});
const KIND_LIMITS: Record<DeviceKind, Partial<Record<CapabilityId, Limits>>> = {
  glasses: {
    "present.display": display(576, 248, 12, 960, "ascii+box", "mono"),
    "present.notify": { title_bytes: 64, body_bytes: 480, max_lines: 5 },
    "ask.choice": { min_options: 2, max_options: 4, hold_s: 200 },
  },
  phone: {
    "present.display": display(1170, 2532, 48, 8000, "utf-8", "rgb"),
    "present.notify": { title_bytes: 128, body_bytes: 2000 },
    "ask.choice": { min_options: 2, max_options: 12, hold_s: 200 },
  },
  desktop: {
    "present.display": display(1440, 900, 64, 16000, "utf-8", "rgb"),
    "present.notify": { title_bytes: 128, body_bytes: 2000 },
    "ask.choice": { min_options: 2, max_options: 12, hold_s: 200 },
  },
  watch: {
    "present.notify": { title_bytes: 40, body_bytes: 240, max_lines: 4 },
    "ask.choice": { min_options: 2, max_options: 4, hold_s: 200 },
  },
  home_hub: {
    "present.display": display(1024, 600, 16, 2000, "utf-8", "rgb"),
  },
  home_device: {},
  vehicle: {
    "present.notify": { title_bytes: 64, body_bytes: 200, max_lines: 2 },
  },
  robot: {},
};

const latencyOf = (c: CapabilityId) =>
  c.startsWith("input.") || c === "presence.read" || c === "capture.video_stream" ? "realtime" : "interactive";

function describeKind(kind: DeviceKind): CapabilityDescriptor[] {
  return KIND_CAPABILITIES[kind].map((c) => descriptor(SINCE, c, latencyOf(c), KIND_LIMITS[kind][c]));
}

/** The C10 failure a magic device id forces, or null for an ordinary simulated device. */
export function magicFailure(deviceId: string): ErrorCode | null {
  for (const [magic, code] of Object.entries(TEST_MAGIC_DEVICE_IDS)) {
    if (deviceId === magic || deviceId.startsWith(`${magic}_`)) return code;
  }
  return null;
}

function simulatedResult(capability: CapabilityId, args: Record<string, unknown>): Record<string, unknown> {
  if (capability === "ask.choice") {
    const first = Array.isArray(args.options) ? (args.options[0] as { label?: unknown } | undefined) : undefined;
    return { simulated: true, index: 0, label: typeof first?.label === "string" ? first.label : null };
  }
  if (capability === "ask.confirm") return { simulated: true, confirmed: true };
  if (capability === "ask.text") return { simulated: true, text: "simulated reply" };
  return { simulated: true };
}

export interface SimulatorAdapterDeps {
  now?: () => number;
  /** Scripted input/telemetry per device; none by default. */
  events?: (device: Device) => AsyncIterable<DeviceEvent>;
}

export function createSimulatorAdapter(deps: SimulatorAdapterDeps = {}): DeviceAdapter {
  const now = deps.now ?? Date.now;
  const describe = (device: Device) => describeKind(device.kind);
  const dispatch = async (_d: Device, capability: CapabilityId, args: Record<string, unknown>): Promise<ActionResult> => ({
    status: "done",
    result: simulatedResult(capability, args),
    error: null,
  });
  return {
    id: SIMULATOR_ADAPTER_ID,
    version: SIMULATOR_ADAPTER_VERSION,
    kinds: [...DEVICE_KINDS],
    transport: "local_bridge",
    experimental: false,
    describe,
    async pair() {
      return { method: "code", code: "SIM234", expires_at: new Date(now() + PAIRING_TTL_MS).toISOString() };
    },
    async execute(device, capability, args) {
      const forced = magicFailure(device.id);
      if (forced) return failed(forced, `simulated ${forced} (magic device id ${device.id})`, device.kind);
      return executeVia(SIMULATOR_ADAPTER_ID, describe, dispatch, device, capability, args);
    },
    events: (device) => (deps.events ? deps.events(device) : noEvents()),
    async health(device) {
      const offline = magicFailure(device.id) === "device_offline";
      return {
        online: !offline,
        last_seen: offline ? device.last_seen_at : new Date(now()).toISOString(),
        firmware: device.firmware,
      };
    },
  };
}
