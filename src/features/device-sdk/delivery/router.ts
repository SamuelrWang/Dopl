/**
 * ROUTER (C5 routing policy, steps 1–4). Pure: the caller loads devices, grants and profiles.
 *
 *   0. TARGET   — `auto` keeps every device; a device kind keeps that kind; anything else is a device id.
 *   1. FILTER   — presence (online now), capability (the device has one the intent accepts AND its
 *                 profile allows it), grant (`policy.ts › checkGrant`).
 *   2. RANK     — the kind the user's last message came from, then most recently seen, then the
 *                 fallback chain (`FALLBACK_KIND_ORDER`).
 *   3. URGENCY  — `high` fans out to every eligible device; `normal` takes the top one; `low` waits for
 *                 the ACTIVE device (the most recently seen online one) and is refused if it can't take it.
 *   4. DECISION — `{ target, reason, candidates, considered }`, which the caller logs on the event row
 *                 (C8). `considered` is every candidate's verdict; past calls cannot be backfilled.
 *
 * A refusal names the furthest step that emptied the set: no device online → `device_offline`,
 * none capable → `capability_unsupported`, none granted → the grant's own code.
 */
import { DEVICE_KINDS, type CapabilityId, type ConsideredDevice, type ContextProfile, type Device, type DeviceKind, type ErrorCode, type RouteDecision, type Urgency } from "../types";
import { checkGrant, type DeviceGrant } from "./policy";
import { scopesCover } from "./resolve-profile";

export interface RouteCandidate {
  device: Device;
  grant: DeviceGrant | null;
  profile: ContextProfile;
}

export interface RouteInput {
  target: string;
  capabilities: readonly CapabilityId[];
  urgency: Urgency;
  candidates: readonly RouteCandidate[];
  lastSourceKind: DeviceKind | null;
  now: number;
}

export interface RoutedDevice {
  candidate: RouteCandidate;
  capability: CapabilityId;
}

export type RouteResult =
  | { ok: true; chosen: RoutedDevice[]; decision: RouteDecision }
  | { ok: false; code: ErrorCode; message: string; decision: RouteDecision };

/** The fallback chain after source and recency: screens people carry first. */
export const FALLBACK_KIND_ORDER: readonly DeviceKind[] = ["phone", "glasses", "watch", "desktop", "home_hub", "vehicle", "home_device", "robot"];

const isKind = (t: string): t is DeviceKind => (DEVICE_KINDS as readonly string[]).includes(t);
const seen = (d: Device) => (d.last_seen_at ? Date.parse(d.last_seen_at) : 0);

/** The capability this device would use for the intent, or null. */
export function capabilityOn(c: RouteCandidate, wanted: readonly CapabilityId[]): CapabilityId | null {
  const has = new Set(c.device.capabilities.map((d) => d.capability));
  return wanted.find((cap) => has.has(cap) && scopesCover(c.profile.allowed_capabilities, cap)) ?? null;
}

/** The active device: the most recently seen online one. */
export function activeDevice(candidates: readonly RouteCandidate[]): RouteCandidate | null {
  return candidates.filter((c) => c.device.online).reduce<RouteCandidate | null>((a, c) => (!a || seen(c.device) > seen(a.device) ? c : a), null);
}

/** Each candidate's verdict at the first filter it failed, or `eligible`. A pure read of the router's own filters. */
function considerAll(input: RouteInput, targetedIds: ReadonlySet<string>, chosen: readonly RoutedDevice[], why: string): ConsideredDevice[] {
  const chosenIds = new Set(chosen.map((r) => r.candidate.device.id));
  return input.candidates.map((c) => {
    const base = { device_id: c.device.id, kind: c.device.kind };
    if (!targetedIds.has(c.device.id)) return { ...base, verdict: "skipped", reason: "not the requested target" };
    if (!c.device.online) return { ...base, verdict: "skipped", reason: "offline" };
    const capability = capabilityOn(c, input.capabilities);
    if (!capability) return { ...base, verdict: "skipped", reason: `does not support ${input.capabilities.join(" or ")} under its profile` };
    const grant = checkGrant(c.grant, capability, input.now);
    if (!grant.ok) return { ...base, verdict: "skipped", reason: grant.message };
    if (chosenIds.has(c.device.id)) return { ...base, verdict: "chosen", reason: why };
    return { ...base, verdict: "eligible", reason: "ranked lower" };
  });
}

export function route(input: RouteInput): RouteResult {
  const { target, urgency } = input;
  const ids = input.candidates.map((c) => c.device.id);
  let targetedIds: ReadonlySet<string> = new Set<string>();
  const decide = (reason: string, chosen: readonly RoutedDevice[] = []): RouteDecision => ({
    target,
    reason,
    candidates: ids,
    considered: considerAll(input, targetedIds, chosen, reason),
  });
  const fail = (code: ErrorCode, message: string): RouteResult => ({ ok: false, code, message, decision: decide(message) });

  // 0. Target.
  const targeted =
    target === "auto"
      ? input.candidates
      : isKind(target)
        ? input.candidates.filter((c) => c.device.kind === target)
        : input.candidates.filter((c) => c.device.id === target);
  targetedIds = new Set(targeted.map((c) => c.device.id));
  if (targeted.length === 0) {
    if (target !== "auto" && !isKind(target)) return fail("not_found", `No device ${target} for this user.`);
    return fail("device_offline", target === "auto" ? "The user has no connected devices." : `The user has no ${target} connected.`);
  }

  // 1. Presence → capability → grant.
  const online = targeted.filter((c) => c.device.online);
  if (online.length === 0) return fail("device_offline", "No target device is online.");
  const capable = online.map((c) => ({ candidate: c, capability: capabilityOn(c, input.capabilities) })).filter(
    (r): r is RoutedDevice => r.capability !== null
  );
  if (capable.length === 0) {
    return fail("capability_unsupported", `No online device supports ${input.capabilities.join(" or ")} under its profile.`);
  }
  let grantFailure: { code: ErrorCode; message: string } | null = null;
  const eligible = capable.filter((r) => {
    const g = checkGrant(r.candidate.grant, r.capability, input.now);
    if (!g.ok && !grantFailure) grantFailure = { code: g.code, message: g.message };
    return g.ok;
  });
  if (eligible.length === 0) {
    const g = grantFailure as { code: ErrorCode; message: string } | null;
    return fail(g?.code ?? "grant_missing", g?.message ?? "No grant covers this delivery.");
  }

  // 2. Rank.
  const fromSource = (r: RoutedDevice) => (input.lastSourceKind !== null && r.candidate.device.kind === input.lastSourceKind ? 1 : 0);
  const chain = (r: RoutedDevice) => FALLBACK_KIND_ORDER.indexOf(r.candidate.device.kind);
  const ranked = [...eligible].sort(
    (a, b) => fromSource(b) - fromSource(a) || seen(b.candidate.device) - seen(a.candidate.device) || chain(a) - chain(b)
  );
  const top = ranked[0];
  const why =
    target !== "auto" && !isKind(target)
      ? "explicit device target"
      : fromSource(top)
        ? `the user's last message came from ${top.candidate.device.kind}`
        : ranked.length > 1 && seen(top.candidate.device) > seen(ranked[1].candidate.device)
          ? "most recently active eligible device"
          : "fallback chain";
  const scope = isKind(target) ? `kind ${target}: ` : "";

  // 3. Urgency.
  if (urgency === "high" && ranked.length > 1) {
    return { ok: true, chosen: ranked, decision: decide(`${scope}high urgency: fan-out to ${ranked.length} devices; primary by ${why}`, ranked) };
  }
  if (urgency === "low") {
    const active = activeDevice(targeted);
    if (!active || active.device.id !== top.candidate.device.id) {
      const pick = ranked.find((r) => r.candidate.device.id === active?.device.id);
      if (!pick) return fail("device_offline", "Low urgency waits for the active device, which cannot take this delivery now.");
      return { ok: true, chosen: [pick], decision: decide(`${scope}low urgency: the active device`, [pick]) };
    }
    return { ok: true, chosen: [top], decision: decide(`${scope}low urgency: the active device`, [top]) };
  }
  return { ok: true, chosen: [top], decision: decide(`${scope}${why}`, [top]) };
}
