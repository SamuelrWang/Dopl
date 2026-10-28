import "server-only";
import { ERROR_CODE_INFO, type DeliverContent, type DeliverRequest, type Device, type DeviceContext, type RouteDecision } from "../types";
import { enforce, limitsFor, truncateContent } from "../delivery/enforce";
import { argsFor, capabilitiesFor, isAsk } from "../delivery/intents";
import { checkRateLimit, DEFAULT_RATE_LIMIT, evaluatePolicy } from "../delivery/policy";
import { postureOf, resolveProfile, UnknownProfileError } from "../delivery/resolve-profile";
import { activeDevice, route, type RouteCandidate, type RoutedDevice } from "../delivery/router";
import {
  checkIdempotency,
  conflictResult,
  deviceEventFields,
  errorBodyOf,
  execute,
  grantFor,
  nowOf,
  profileEventFields,
  replayResult,
  requestHash,
  toDevice,
  type DeliveryDeps,
  type ServiceResult,
} from "./delivery-common";
import { holdAndSettle } from "./action-service";
import type { Scope } from "./delivery-store";

/**
 * `GET /v1/users/{id}/context` and `POST /v1/users/{id}/deliver` (C4 intent level, C5).
 *
 * deliver: idempotency → rate limit → end user → candidates (device + grant + resolved profile) →
 * route (C5 1–4) → policy (C7 tier/confirmation) → enforce (D3: truncate / send_to / callback,
 * NEVER a rewrite) → claim the idempotency key → execute through the adapter → `ask.*` hold → store.
 */

async function candidatesFor(deps: DeliveryDeps, scope: Scope, endUserId: string, requestedProfile?: string): Promise<RouteCandidate[]> {
  const [rows, profiles] = await Promise.all([deps.store.listDevices(scope, endUserId), deps.store.listProfiles(scope)]);
  const devices = (await Promise.all(rows.map((r) => toDevice(deps, scope, r)))).filter((d): d is Device => d !== null);
  const active = devices.filter((d) => d.online).sort((a, b) => Date.parse(b.last_seen_at ?? "0") - Date.parse(a.last_seen_at ?? "0"))[0];
  const posture = postureOf(active?.kind ?? null);
  return Promise.all(
    devices.map(async (device) => ({
      device,
      grant: await grantFor(deps, scope, endUserId, device),
      profile: resolveProfile({ kind: device.kind, model: device.model, posture }, profiles, requestedProfile).profile,
    }))
  );
}

export async function getContext(deps: DeliveryDeps, scope: Scope, externalUserId: string): Promise<ServiceResult> {
  const decision: RouteDecision = { target: "auto", reason: "context lookup", candidates: [] };
  const event = { external_user_id: externalUserId };
  const user = await deps.store.findEndUser(scope, externalUserId);
  if (!user) return { ok: false, code: "not_found", message: `No end user ${externalUserId} in this project.`, decision, event };
  const candidates = await candidatesFor(deps, scope, user.id);
  const active = activeDevice(candidates);
  const body: DeviceContext = {
    active_device: active
      ? {
          id: active.device.id,
          kind: active.device.kind,
          model: active.device.model,
          last_seen_s: Math.max(0, Math.round((nowOf(deps) - Date.parse(active.device.last_seen_at ?? new Date(nowOf(deps)).toISOString())) / 1000)),
        }
      : null,
    posture: postureOf(active?.device.kind ?? null),
    available: candidates
      .filter((c) => c.device.online)
      .map((c) => ({ kind: c.device.kind, id: c.device.id, capabilities: c.device.capabilities.map((d) => d.capability) })),
    profile: active ? { id: active.profile.id, prompt_append: active.profile.prompt_append, output: active.profile.output } : null,
    // No device-originated input is stored for SDK users yet (C8 `input.utterance` lands later).
    source_of_last_message: null,
  };
  return {
    ok: true,
    status: 200,
    body: body as unknown as Record<string, unknown>,
    decision: {
      target: "auto",
      reason: active ? `context: active device ${active.device.kind}` : "context: no online device",
      candidates: candidates.map((c) => c.device.id),
    },
    event: { ...event, ...(active ? { ...deviceEventFields(active.device), ...profileEventFields(active) } : {}) },
  };
}

/** Fit content to one device under its own profile; a second-hop overflow only ever truncates. */
function fitFor(r: RoutedDevice, content: DeliverContent, allowSendTo: boolean) {
  const descriptor = r.candidate.device.capabilities.find((d) => d.capability === r.capability) ?? null;
  const limits = limitsFor(r.candidate.profile, descriptor);
  const out = enforce(content, r.candidate.profile, limits);
  if (out.kind === "send_to" && !allowSendTo) return { kind: "truncated" as const, content: truncateContent(content, limits), limits, measured: out.measured };
  return out;
}

export async function deliver(
  deps: DeliveryDeps,
  scope: Scope,
  externalUserId: string,
  req: DeliverRequest
): Promise<ServiceResult> {
  const target = req.target ?? "auto";
  const hash = requestHash({ route: "deliver", external_user_id: externalUserId, body: req });
  const event = { external_user_id: externalUserId, intent: req.intent };
  const pre: RouteDecision = { target, reason: "not routed", candidates: [] };

  const idem = await checkIdempotency(deps, scope, req.idempotency_key, hash);
  if (idem.kind === "replay") return replayResult(idem.action, event);
  if (idem.kind === "conflict") return conflictResult(req.idempotency_key, pre, event);

  const limit = deps.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rate = checkRateLimit(await deps.store.countActionsSince(scope, new Date(nowOf(deps) - limit.windowMs).toISOString()), limit);
  if (!rate.ok) return { ok: false, code: rate.code, message: rate.message, decision: { ...pre, reason: "rate limited" }, event };

  const user = await deps.store.findEndUser(scope, externalUserId);
  if (!user) return { ok: false, code: "not_found", message: `No end user ${externalUserId} in this project.`, decision: pre, event };

  let candidates: RouteCandidate[];
  try {
    candidates = await candidatesFor(deps, scope, user.id, req.profile);
  } catch (err) {
    if (err instanceof UnknownProfileError) return { ok: false, code: "invalid_request", message: err.message, decision: pre, event };
    throw err;
  }
  const now = nowOf(deps);
  const capabilities = capabilitiesFor(req.intent, req.content);
  const routed = route({ target, capabilities, urgency: req.urgency, candidates, lastSourceKind: null, now });
  if (!routed.ok) return { ok: false, code: routed.code, message: routed.message, decision: routed.decision, event };

  let primary = routed.chosen[0];
  let decision = routed.decision;
  const policy = evaluatePolicy({ capability: primary.capability, grant: primary.candidate.grant, profile: primary.candidate.profile, now });
  const baseEvent = () => ({
    ...event,
    ...deviceEventFields(primary.candidate.device),
    ...profileEventFields(primary.candidate),
    capability: primary.capability,
    route_decision: decision,
  });
  if (!policy.ok) return { ok: false, code: policy.code, message: policy.message, decision, event: baseEvent() };

  // D3 enforcement: truncate, send_to another device (content unchanged), or hand back (callback).
  let content = req.content;
  let fit = fitFor(primary, content, true);
  if (fit.kind === "send_to") {
    const to = fit.to;
    const hop = route({ target: to, capabilities, urgency: "normal", candidates, lastSourceKind: null, now });
    if (hop.ok && hop.chosen[0].candidate.device.id !== primary.candidate.device.id) {
      primary = hop.chosen[0];
      decision = { ...decision, reason: `${decision.reason}; overflow → send_to ${to}` };
      fit = fitFor(primary, content, false);
    } else {
      fit = fitFor(primary, content, false);
      decision = { ...decision, reason: `${decision.reason}; overflow send_to ${to} unavailable → truncate` };
    }
  }
  if (fit.kind === "truncated") {
    content = fit.content;
    decision = { ...decision, reason: `${decision.reason}; truncated to profile limits` };
  }

  const routedTo = { device_id: primary.candidate.device.id, kind: primary.candidate.device.kind, reason: decision.reason };
  const claim = await deps.store.insertAction({
    project_id: scope.projectId,
    env: scope.env,
    end_user_id: user.id,
    device_id: primary.candidate.device.id,
    source: "deliver",
    capability: primary.capability,
    intent: req.intent,
    status: "queued",
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
  const action = claim.action;
  const confirmation = { required: policy.confirmation.required, result: null };
  const ev = () => ({ ...baseEvent(), risk_tier: policy.tier, confirmation });

  const finish = async (status: typeof action.status, result: Record<string, unknown> | null, error: ReturnType<typeof errorBodyOf> | null, extra: Record<string, unknown> = {}) => {
    const response = { delivery_id: action.id, routed_to: routedTo, status, ...extra };
    await deps.store.updateAction(scope, action.id, { status, result, error, response, http_status: 202 });
    return { ok: true as const, status: 202, body: response, decision, event: ev() };
  };

  if (fit.kind === "callback") {
    return finish("failed", null, errorBodyOf("invalid_request", "Content exceeds the profile's limits (overflow: callback)."), {
      overflow_callback: { profile_id: primary.candidate.profile.id, limits: fit.limits, measured: fit.measured },
    });
  }
  if (policy.confirmation.required) return finish("needs_confirmation", null, null);

  const started = nowOf(deps);
  const results = await Promise.all(
    routed.chosen.length > 1 && primary === routed.chosen[0]
      ? routed.chosen.map((r, i) => execute(deps, r.candidate.device, r.capability, argsFor(r.capability, i === 0 ? content : truncatedFor(r, req.content))))
      : [execute(deps, primary.candidate.device, primary.capability, argsFor(primary.capability, content))]
  );
  let [res] = results;
  const delivery = Math.max(0, nowOf(deps) - started);
  if (res.status === "failed" && res.error) {
    const response = { error: res.error };
    const info = res.error;
    await deps.store.updateAction(scope, action.id, { status: "failed", error: info, response, http_status: ERROR_CODE_INFO[info.code].status });
    return { ok: false, code: info.code, message: info.message, decision, event: { ...ev(), latency_ms: { device_delivery: delivery } } };
  }
  await deps.store.updateAction(scope, action.id, { status: res.status, result: res.result });
  if (isAsk(primary.capability) && (res.status === "queued" || res.status === "delivered")) res = await holdAndSettle(deps, scope, action.id, res);
  const fanout = results.length > 1 ? { fanout: routed.chosen.map((r, i) => ({ device_id: r.candidate.device.id, status: results[i].status })) } : {};
  const done = await finish(res.status, { ...(res.result ?? {}), ...fanout, ...(fit.kind === "truncated" ? { truncated: true } : {}) }, res.error);
  return { ...done, event: { ...done.event, latency_ms: { device_delivery: delivery } } };
}

/** A fan-out extra: its own limits, always truncated (never a second overflow hop). */
function truncatedFor(r: RoutedDevice, content: DeliverContent): DeliverContent {
  const f = fitFor(r, content, false);
  return f.kind === "fits" || f.kind === "truncated" ? f.content : content;
}
