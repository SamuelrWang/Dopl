import "server-only";
import { createHash } from "node:crypto";
import { AdapterNotWiredError } from "../adapters/shared";
import type { AdapterRegistry } from "../adapters/registry";
import { SIMULATOR_ADAPTER_ID } from "../adapters/simulator";
import { ERROR_CODE_INFO, errorDocUrl, type ActionResult, type CapabilityId, type Device, type ErrorBody, type ErrorCode, type RouteDecision } from "../types";
import type { DeviceGrant } from "../delivery/policy";
import type { RouteCandidate } from "../delivery/router";
import type { DevEventAnnotation } from "./with-developer-key";
import type { DeliveryStore, DeviceRow, GrantStore, Scope, StoredAction } from "./delivery-store";
import { SIMULATOR_TEST_GRANT } from "./grant-store";

/** Everything the delivery services touch; production values in `delivery-deps.ts`. */
export interface DeliveryDeps {
  store: DeliveryStore;
  grants: GrantStore;
  adapters: AdapterRegistry;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  rateLimit?: { max: number; windowMs: number };
  /** How often an `ask.*` hold re-reads the action. */
  askPollMs?: number;
}

/** A service answer the route turns into a response, plus what goes on the event row. */
export type ServiceResult =
  | { ok: true; status: number; body: Record<string, unknown>; decision: RouteDecision; event: DevEventAnnotation }
  | { ok: false; code: ErrorCode; message: string; decision: RouteDecision; event: DevEventAnnotation; status?: number; body?: Record<string, unknown> };

export const nowOf = (d: DeliveryDeps) => (d.now ?? Date.now)();
export const sleepOf = (d: DeliveryDeps) => d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

export function errorBodyOf(code: ErrorCode, message: string): ErrorBody {
  const info = ERROR_CODE_INFO[code];
  return { type: info.type, code, message, retryable: info.retryable, doc_url: errorDocUrl(code) };
}

/** Key order–independent JSON, so a replay with reordered fields hashes the same. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const requestHash = (v: unknown): string => createHash("sha256").update(stableStringify(v)).digest("hex");

/** A `devices` row → the C3 `Device` its adapter describes, or null if no adapter serves it in this env. */
export async function toDevice(deps: DeliveryDeps, scope: Scope, row: DeviceRow): Promise<Device | null> {
  const adapter = deps.adapters.get(row.adapter_id);
  if (!adapter || !deps.adapters.list({ env: scope.env, includeExperimental: true }).includes(adapter)) return null;
  const base: Device = {
    id: row.id,
    kind: row.kind,
    vendor: row.vendor,
    model: row.model,
    firmware: row.firmware,
    adapter_id: row.adapter_id,
    adapter_version: row.adapter_version,
    capabilities: [],
    online: false,
    last_seen_at: row.last_seen ? new Date(row.last_seen).toISOString() : null,
  };
  const health = await adapter.health(base);
  return { ...base, capabilities: adapter.describe(base), online: health.online, last_seen_at: base.last_seen_at ?? health.last_seen };
}

/** The end user's grant for a device. Test-mode simulator devices without a row get `SIMULATOR_TEST_GRANT`. */
export async function grantFor(deps: DeliveryDeps, scope: Scope, endUserId: string, device: Device): Promise<DeviceGrant | null> {
  const grant = await deps.grants.load({ ...scope, endUserId, deviceId: device.id });
  if (grant) return grant;
  return scope.env === "test" && device.adapter_id === SIMULATOR_ADAPTER_ID ? SIMULATOR_TEST_GRANT : null;
}

/** Run one capability through the device's adapter. An unwired transport is a `vendor_error`, not a crash. */
export async function execute(deps: DeliveryDeps, device: Device, capability: CapabilityId, args: Record<string, unknown>): Promise<ActionResult> {
  const adapter = deps.adapters.get(device.adapter_id);
  if (!adapter) return { status: "failed", result: null, error: errorBodyOf("vendor_error", `No adapter ${device.adapter_id}.`) };
  try {
    return await adapter.execute(device, capability, args);
  } catch (err) {
    if (err instanceof AdapterNotWiredError) {
      return { status: "failed", result: null, error: errorBodyOf("vendor_error", `Delivery to ${device.adapter_id} devices is not available yet.`) };
    }
    throw err;
  }
}

/** The C8 device fields of an event row. */
export function deviceEventFields(device: Device): DevEventAnnotation {
  return {
    device_id: device.id,
    device_kind: device.kind,
    vendor: device.vendor,
    model: device.model,
    firmware: device.firmware,
    adapter_version: `${device.adapter_id}@${device.adapter_version}`,
  };
}

export function profileEventFields(c: RouteCandidate): DevEventAnnotation {
  return { profile_id: c.profile.id, profile_version: c.profile.version ?? null };
}

/** Idempotency: same key + same request → the stored response; same key + different request → conflict. */
export type IdempotencyCheck = { kind: "fresh" } | { kind: "replay"; action: StoredAction } | { kind: "conflict" };

export async function checkIdempotency(deps: DeliveryDeps, scope: Scope, key: string, hash: string): Promise<IdempotencyCheck> {
  const existing = await deps.store.findActionByKey(scope, key);
  if (!existing) return { kind: "fresh" };
  return existing.request_hash === hash ? { kind: "replay", action: existing } : { kind: "conflict" };
}

export function replayResult(action: StoredAction, event: DevEventAnnotation): ServiceResult {
  const decision = action.route_decision ?? { target: action.device_id ?? "replay", reason: "idempotent replay", candidates: [] };
  const replayDecision = { ...decision, reason: `idempotent replay: ${decision.reason}` };
  if (action.http_status >= 400 && action.error) {
    return { ok: false, code: action.error.code, message: action.error.message, decision: replayDecision, event, status: action.http_status, body: action.response };
  }
  return { ok: true, status: action.http_status, body: action.response, decision: replayDecision, event };
}

export function conflictResult(key: string, decision: RouteDecision, event: DevEventAnnotation): ServiceResult {
  return {
    ok: false,
    code: "idempotency_conflict",
    message: `Idempotency key "${key}" was already used with a different request.`,
    decision,
    event,
  };
}
