/**
 * PROFILE RESOLVER (C5) — which context profile applies to a device. Pure.
 *
 * Precedence, first hit wins:
 *   1. an explicit `profile` id the caller named (project profiles only),
 *   2. the PROJECT'S OVERRIDE: its active profiles that match the device, most specific first,
 *   3. a DOPL MODEL DEFAULT (`DOPL_MODEL_PROFILES`, e.g. `even_g2-default`),
 *   4. the PER-KIND FALLBACK (`DOPL_KIND_PROFILES`), which always exists.
 *
 * A project profile is how a developer customizes routing output (e.g. a system prompt appended
 * for AR glasses). Its `match` keys must ALL hold; specificity = how many keys it names.
 */
import { CAPABILITY_FAMILY, type CapabilityId, type CapabilityScope, type ContextProfile, type DeviceKind, type Posture } from "../types";
import { DOPL_KIND_PROFILES, DOPL_MODEL_PROFILES } from "./default-profiles";

export interface ProfileSubject {
  kind: DeviceKind;
  model: string;
  posture: Posture;
}

export type ProfileSource = "requested" | "project" | "dopl_model" | "dopl_kind";

export interface ResolvedProfile {
  profile: ContextProfile;
  source: ProfileSource;
}

export function profileMatches(profile: ContextProfile, s: ProfileSubject): boolean {
  const m = profile.match;
  return (
    (m.kind === undefined || m.kind === s.kind) &&
    (m.model === undefined || m.model === s.model) &&
    (m.posture === undefined || m.posture === s.posture)
  );
}

const specificity = (p: ContextProfile) =>
  (p.match.model !== undefined ? 4 : 0) + (p.match.kind !== undefined ? 2 : 0) + (p.match.posture !== undefined ? 1 : 0);

/** Most specific match; ties go to the higher version, then the earlier entry (stable). */
function best(profiles: readonly ContextProfile[], s: ProfileSubject): ContextProfile | null {
  let out: ContextProfile | null = null;
  for (const p of profiles) {
    if (!profileMatches(p, s)) continue;
    if (!out || specificity(p) > specificity(out) || (specificity(p) === specificity(out) && (p.version ?? 0) > (out.version ?? 0))) {
      out = p;
    }
  }
  return out;
}

export class UnknownProfileError extends Error {
  constructor(id: string) {
    super(`No active context profile with id "${id}" in this project and environment.`);
    this.name = "UnknownProfileError";
  }
}

export function resolveProfile(
  subject: ProfileSubject,
  projectProfiles: readonly ContextProfile[],
  requestedId?: string
): ResolvedProfile {
  if (requestedId !== undefined) {
    const named = projectProfiles.filter((p) => p.id === requestedId);
    const pick = named.reduce<ContextProfile | null>((a, p) => (!a || (p.version ?? 0) > (a.version ?? 0) ? p : a), null);
    if (!pick) throw new UnknownProfileError(requestedId);
    return { profile: pick, source: "requested" };
  }
  const project = best(projectProfiles, subject);
  if (project) return { profile: project, source: "project" };
  const model = best(DOPL_MODEL_PROFILES, subject);
  if (model) return { profile: model, source: "dopl_model" };
  return { profile: DOPL_KIND_PROFILES[subject.kind], source: "dopl_kind" };
}

/** Does a C3 scope (`present.display`, `present.*`, `act.motion.*`) cover this capability? */
export function scopeCovers(scope: CapabilityScope, capability: CapabilityId): boolean {
  if (scope === capability) return true;
  return scope.endsWith(".*") && CAPABILITY_FAMILY[capability] === scope.slice(0, -2);
}

export const scopesCover = (scopes: readonly CapabilityScope[], capability: CapabilityId): boolean =>
  scopes.some((s) => scopeCovers(s, capability));

/** Posture inferred from the active device's kind (no posture signal exists yet). */
export function postureOf(kind: DeviceKind | null): Posture {
  switch (kind) {
    case "glasses":
    case "watch":
      return "glanceable";
    case "desktop":
      return "seated";
    case "vehicle":
      return "driving";
    case "home_hub":
      return "hands_free";
    default:
      return "unknown";
  }
}
