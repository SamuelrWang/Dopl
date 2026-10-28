/**
 * Helpers every Device SDK adapter shares: descriptor construction (risk tier always the C3 default),
 * the C10 error body, argument checks against a descriptor's limits, and the one execute pipeline
 * (supported? → args valid? → transport port).
 *
 * The frozen contracts live in `@dopl/device-contracts` (SPEC-v1 C3/C9/C10): import, never redefine.
 */

import {
  CAPABILITY_RISK_TIER,
  DisplayBlocksSchema,
  ERROR_CODE_INFO,
  errorDocUrl,
  type ActionResult,
  type CapabilityDescriptor,
  type CapabilityId,
  type CapabilityLimits,
  type Device,
  type DeviceKind,
  type ErrorBody,
  type ErrorCode,
  type LatencyClass,
} from "@dopl/device-contracts";

/** A descriptor at the capability's C3 default tier; `since` is `<adapter_id>@<version>`. */
export function descriptor(
  since: string,
  capability: CapabilityId,
  latency_class: LatencyClass,
  limits: CapabilityLimits = {}
): CapabilityDescriptor {
  return { capability, limits: { ...limits }, latency_class, risk_tier: CAPABILITY_RISK_TIER[capability], since_adapter: since };
}

export function errorBody(code: ErrorCode, message: string, device_kind?: DeviceKind): ErrorBody {
  const info = ERROR_CODE_INFO[code];
  return {
    type: info.type,
    code,
    message,
    ...(device_kind ? { device_kind } : {}),
    retryable: info.retryable,
    doc_url: errorDocUrl(code),
  };
}

export function failed(code: ErrorCode, message: string, device_kind?: DeviceKind): ActionResult {
  return { status: "failed", result: null, error: errorBody(code, message, device_kind) };
}

/**
 * A port the adapter needs was not wired (pairing lands in A4 Connect, delivery in A5). A programming
 * error in the caller, not a device state, so it throws instead of returning a C10 body.
 */
export class AdapterNotWiredError extends Error {
  constructor(adapterId: string, port: string) {
    super(`${adapterId}: the ${port} port is not wired`);
    this.name = "AdapterNotWiredError";
  }
}

/** Sends one validated capability call to the device. Wired by the delivery layer (A5). */
export type Dispatcher = (device: Device, capability: CapabilityId, args: Record<string, unknown>) => Promise<ActionResult>;

/**
 * Checks `args` against the descriptor's limits, for the capabilities whose arg shape the contracts
 * freeze. Returns an error message, or null when the args are acceptable.
 */
export function checkArgs(d: CapabilityDescriptor, args: Record<string, unknown>): string | null {
  if (d.capability === "present.display") {
    const parsed = DisplayBlocksSchema.safeParse(args.blocks);
    if (!parsed.success) return `present.display: blocks invalid (${parsed.error.issues[0]?.message ?? "bad shape"})`;
    const max = d.limits.max_blocks;
    if (typeof max === "number" && parsed.data.length > max) {
      return `present.display: ${parsed.data.length} blocks, this device shows at most ${max}`;
    }
  }
  if (d.capability === "ask.choice") {
    const options = args.options;
    if (!Array.isArray(options) || options.length < 2) return "ask.choice: options needs at least 2 entries";
    const max = d.limits.max_options;
    if (typeof max === "number" && options.length > max) {
      return `ask.choice: ${options.length} options, this device shows at most ${max}`;
    }
  }
  return null;
}

/** The shared execute pipeline: unsupported → C10 `capability_unsupported`, bad args → `invalid_request`. */
export async function executeVia(
  adapterId: string,
  describe: (device: Device) => CapabilityDescriptor[],
  dispatch: Dispatcher | undefined,
  device: Device,
  capability: CapabilityId,
  args: Record<string, unknown>
): Promise<ActionResult> {
  const d = describe(device).find((c) => c.capability === capability);
  if (!d) return failed("capability_unsupported", `${adapterId} does not support ${capability}`, device.kind);
  const bad = checkArgs(d, args);
  if (bad) return failed("invalid_request", bad, device.kind);
  if (!dispatch) throw new AdapterNotWiredError(adapterId, "dispatch");
  return dispatch(device, capability, args);
}

/** Online when `last_seen` is inside `windowMs` of `now`. */
export function seenWithin(lastSeen: string | null, windowMs: number, now: number): boolean {
  return lastSeen !== null && now - Date.parse(lastSeen) <= windowMs;
}

/** An adapter with no event source wired yields nothing. */
export async function* noEvents(): AsyncGenerator<never> {}
