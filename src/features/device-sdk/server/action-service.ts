import "server-only";
import { ASK_HOLD_MAX_S, ERROR_CODE_INFO, type Action, type ActionResult, type CapabilityId, type DeviceActionRequest, type RouteDecision } from "../types";
import { isAsk } from "../delivery/intents";
import { checkRateLimit, DEFAULT_RATE_LIMIT, evaluatePolicy } from "../delivery/policy";
import { postureOf, resolveProfile, scopesCover } from "../delivery/resolve-profile";
import {
  checkIdempotency,
  conflictResult,
  deviceEventFields,
  execute,
  grantFor,
  nowOf,
  replayResult,
  requestHash,
  sleepOf,
  toDevice,
  type DeliveryDeps,
  type ServiceResult,
} from "./delivery-common";
import type { Scope, StoredAction } from "./delivery-store";
import type { DevEventAnnotation } from "./with-developer-key";

/**
 * `POST /v1/devices/{id}/actions/{capability}` and `GET /v1/actions/{id}` (C4 device level).
 *
 * Explicit device, so routing is trivial (`reason: "explicit device"`) but the decision is still
 * logged. Order: idempotency → rate limit → device (this project + env) → online → capability on the
 * device AND allowed by its profile → policy (grant, tier; T4 deny / `needs_confirmation`) → claim the
 * key → adapter → `ask.*` hold → store.
 *
 * 🔒 ASK HOLD (`holdForAnswer`): an `ask.*` the device has not answered yet is held for up to
 * `ASK_HOLD_MAX_S` (200s, the `glasses_ask` cap) by re-reading the `dev_actions` row the device's
 * answer lands on. The glasses MCP hold (`display/server/service.ts › hold`) is NOT reused: it is keyed
 * to a Dopl ACCOUNT's lens queue and channel stamps, and SDK end users have no Dopl account (D1).
 * Past the hold the response says `delivered`/`queued` and the caller polls `GET /v1/actions/{id}`.
 * `Prefer: respond-async` (`delivery-routes.ts › prefersRespondAsync`) skips the hold: the 202 comes
 * back at once and no function is held for the wearer.
 */

const DEFAULT_ASK_POLL_MS = 1000;

/** Re-read the action until it settles or `capS` passes; null if it never settled. */
export async function holdForAnswer(deps: DeliveryDeps, scope: Scope, actionId: string, capS: number = ASK_HOLD_MAX_S): Promise<StoredAction | null> {
  const sleep = sleepOf(deps);
  const deadline = nowOf(deps) + Math.min(capS, ASK_HOLD_MAX_S) * 1000;
  while (nowOf(deps) < deadline) {
    await sleep(deps.askPollMs ?? DEFAULT_ASK_POLL_MS);
    const cur = await deps.store.getAction(scope, actionId);
    if (!cur) return null;
    if (cur.status === "done" || cur.status === "failed") return cur;
  }
  return null;
}

/**
 * Hold an `ask.*` for its answer, then the status to store. A device moves the action while it is
 * held (`glasses/lens-actions.ts`: queued → delivered when its inbox takes the ask, done on the
 * answer), so an unsettled hold re-reads the row instead of writing back the adapter's first status:
 * an answer that landed after the last poll is kept, and `delivered` never regresses to `queued`.
 */
export async function holdAndSettle(deps: DeliveryDeps, scope: Scope, actionId: string, res: ActionResult): Promise<ActionResult> {
  const held = await holdForAnswer(deps, scope, actionId);
  const cur = held ?? (await deps.store.getAction(scope, actionId));
  if (!cur) return res;
  if (cur.status === "done" || cur.status === "failed") return { status: cur.status, result: cur.result, error: cur.error };
  if (cur.status === "delivered" && res.status === "queued") return { ...res, status: "delivered" };
  return res;
}

export function toAction(a: StoredAction): Action {
  return {
    action_id: a.id,
    device_id: a.device_id ?? "",
    capability: a.capability as CapabilityId,
    status: a.status,
    result: a.result,
    error: a.error,
    created_at: new Date(a.created_at).toISOString(),
    updated_at: new Date(a.updated_at).toISOString(),
  };
}

export async function getAction(deps: DeliveryDeps, scope: Scope, id: string): Promise<ServiceResult> {
  const a = await deps.store.getAction(scope, id);
  const decision: RouteDecision = a?.route_decision ?? { target: id, reason: "action lookup", candidates: [] };
  if (!a) return { ok: false, code: "not_found", message: `No action ${id} in this project.`, decision, event: {} };
  const externalUserId = a.end_user_id ? await deps.store.externalUserId(scope, a.end_user_id) : null;
  return {
    ok: true,
    status: 200,
    body: toAction(a) as unknown as Record<string, unknown>,
    decision: { ...decision, reason: `poll: ${decision.reason}` },
    event: {
      external_user_id: externalUserId,
      device_id: a.device_id,
      capability: (a.capability as CapabilityId | null) ?? null,
    },
  };
}

/**
 * `GET /v1/devices/{id}` (C3) — one live device of this project + env, as its adapter describes it
 * (capability descriptors; `online` from the adapter's health over `last_seen`). Another project's,
 * another env's, a revoked or a prosumer (no project) device is `not_found` — never a hint it exists.
 */
export async function getDevice(deps: DeliveryDeps, scope: Scope, deviceId: string): Promise<ServiceResult> {
  const decision: RouteDecision = { target: deviceId, reason: "device lookup", candidates: [] };
  const row = await deps.store.getDevice(scope, deviceId);
  const device = row ? await toDevice(deps, scope, row) : null;
  if (!row || !device) {
    return { ok: false, code: "not_found", message: `No device ${deviceId} in this project.`, decision, event: { device_id: deviceId } };
  }
  const externalUserId = await deps.store.externalUserId(scope, row.end_user_id);
  return {
    ok: true,
    status: 200,
    body: device as unknown as Record<string, unknown>,
    decision,
    event: { ...deviceEventFields(device), external_user_id: externalUserId },
  };
}

export async function deviceAction(
  deps: DeliveryDeps,
  scope: Scope,
  deviceId: string,
  capability: CapabilityId,
  req: DeviceActionRequest,
  /** `hold: false` (`Prefer: respond-async`): an `ask.*` returns at once, unanswered; no 200s hold. */
  opts: { hold?: boolean } = {}
): Promise<ServiceResult> {
  const decision: RouteDecision = { target: deviceId, reason: "explicit device", candidates: [deviceId] };
  const event: DevEventAnnotation = { device_id: deviceId, capability };
  const hash = requestHash({ route: "action", device_id: deviceId, capability, body: req });
  const fail = (code: Parameters<typeof refusal>[0], message: string, ev: DevEventAnnotation = event): ServiceResult => refusal(code, message, decision, ev);

  const idem = await checkIdempotency(deps, scope, req.idempotency_key, hash);
  if (idem.kind === "replay") return replayResult(idem.action, event);
  if (idem.kind === "conflict") return conflictResult(req.idempotency_key, decision, event);

  const limit = deps.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rate = checkRateLimit(await deps.store.countActionsSince(scope, new Date(nowOf(deps) - limit.windowMs).toISOString()), limit);
  if (!rate.ok) return fail(rate.code, rate.message);

  const row = await deps.store.getDevice(scope, deviceId);
  const device = row ? await toDevice(deps, scope, row) : null;
  if (!row || !device) return fail("not_found", `No device ${deviceId} in this project.`);
  const [externalUserId, profiles, grant] = await Promise.all([
    deps.store.externalUserId(scope, row.end_user_id),
    deps.store.listProfiles(scope),
    grantFor(deps, scope, row.end_user_id, device),
  ]);
  const { profile } = resolveProfile({ kind: device.kind, model: device.model, posture: postureOf(device.kind) }, profiles);
  const ev = {
    ...event,
    ...deviceEventFields(device),
    external_user_id: externalUserId,
    profile_id: profile.id,
    profile_version: profile.version ?? null,
  };

  if (!device.online) return fail("device_offline", `Device ${deviceId} is offline.`, ev);
  if (!device.capabilities.some((d) => d.capability === capability)) {
    return fail("capability_unsupported", `Device ${deviceId} (${device.adapter_id}) does not support ${capability}.`, ev);
  }
  if (!scopesCover(profile.allowed_capabilities, capability)) {
    return fail("capability_unsupported", `Profile "${profile.id}" does not allow ${capability} on this device.`, ev);
  }
  const now = nowOf(deps);
  const policy = evaluatePolicy({ capability, grant, profile, now });
  if (!policy.ok) return fail(policy.code, policy.message, ev);
  const confirmation = { required: policy.confirmation.required, result: null };
  const evDone = { ...ev, risk_tier: policy.tier, confirmation };

  const claim = await deps.store.insertAction({
    project_id: scope.projectId,
    env: scope.env,
    end_user_id: row.end_user_id,
    device_id: device.id,
    source: "action",
    capability,
    intent: null,
    status: policy.confirmation.required ? "needs_confirmation" : "queued",
    idempotency_key: req.idempotency_key,
    request_hash: hash,
    http_status: 202,
    response: {},
    result: null,
    error: null,
    route_decision: decision,
  });
  if (!claim.inserted) {
    return claim.existing.request_hash === hash ? replayResult(claim.existing, event) : conflictResult(req.idempotency_key, decision, event);
  }
  const id = claim.action.id;
  const accept = async (status: StoredAction["status"], result: Record<string, unknown> | null) => {
    const response = { action_id: id, status };
    await deps.store.updateAction(scope, id, { status, result, response, http_status: 202 });
    return { ok: true as const, status: 202, body: response, decision, event: evDone };
  };
  if (policy.confirmation.required) return accept("needs_confirmation", null);

  const started = nowOf(deps);
  let res = await execute(deps, device, capability, req.args);
  const latency = { device_delivery: Math.max(0, nowOf(deps) - started) };
  if (res.status === "failed" && res.error) {
    const status = ERROR_CODE_INFO[res.error.code].status;
    await deps.store.updateAction(scope, id, { status: "failed", error: res.error, response: { error: res.error }, http_status: status });
    return { ok: false, code: res.error.code, message: res.error.message, decision, event: { ...evDone, latency_ms: latency } };
  }
  await deps.store.updateAction(scope, id, { status: res.status, result: res.result });
  if (opts.hold !== false && isAsk(capability) && (res.status === "queued" || res.status === "delivered")) res = await holdAndSettle(deps, scope, id, res);
  const out = await accept(res.status, res.result);
  return { ...out, event: { ...out.event, latency_ms: latency } };
}

function refusal(code: ServiceResultCode, message: string, decision: RouteDecision, event: DevEventAnnotation): ServiceResult {
  return { ok: false, code, message, decision, event };
}
type ServiceResultCode = Extract<ServiceResult, { ok: false }>["code"];
