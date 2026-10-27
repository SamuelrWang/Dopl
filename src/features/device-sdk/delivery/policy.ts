/**
 * POLICY ENGINE, light C7 — runs on every call, independent of any model. Pure: no I/O, no clock
 * of its own (the caller passes `now`), no model calls.
 *
 * Checks, in order:
 *   1. GRANT  — present, not revoked, not expired, its scopes cover the capability, its tiers allow the
 *               capability's risk tier (C2/C7 end-user grants).
 *   2. TIER   — the profile's confirmation rule for that tier. 🔒 T4 is DENIED BY DEFAULT and can never
 *               be `none`: with a confirmation mode configured it is `needs_confirmation` on EVERY call.
 *               T3 is allowed unless the profile asks for confirmation or denies it.
 *   3. RATE   — a simple per-project, per-env window (`checkRateLimit`), checked once per request.
 */
import { CAPABILITY_RISK_TIER, RISK_TIERS, type CapabilityId, type CapabilityScope, type ConfirmationMode, type ContextProfile, type ErrorCode, type RiskTier } from "../types";
import { scopeCovers } from "./resolve-profile";

/**
 * An end user's grant for one device: a `connections` row (A4) in the policy engine's terms.
 * Each granted scope carries the HIGHEST tier the user agreed to under it (`connections.tier_grants`,
 * `{ scope: tier }`), so a capability is covered when a scope includes it AND its tier is at or
 * below that scope's granted tier.
 */
export interface DeviceGrant {
  scopes: Array<{ scope: CapabilityScope; maxTier: RiskTier }>;
  status: "active" | "needs_reauth" | "revoked";
  /** ISO 8601 or null (no expiry). */
  expiresAt: string | null;
  revokedAt: string | null;
}

export type PolicyDenied = { ok: false; code: ErrorCode; message: string };
export type GrantCheck = { ok: true } | PolicyDenied;

const rank = (t: RiskTier) => RISK_TIERS.indexOf(t);

export function checkGrant(grant: DeviceGrant | null, capability: CapabilityId, now: number): GrantCheck {
  if (!grant || grant.revokedAt !== null || grant.status === "revoked") {
    return { ok: false, code: "grant_missing", message: `The end user has not granted access to this device.` };
  }
  if (grant.status === "needs_reauth") {
    return { ok: false, code: "needs_reauth", message: `The end user must reconnect this device before it can be used.` };
  }
  if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= now) {
    return { ok: false, code: "grant_expired", message: `The end user's grant for this device expired at ${grant.expiresAt}.` };
  }
  const tier = CAPABILITY_RISK_TIER[capability];
  const covering = grant.scopes.filter((s) => scopeCovers(s.scope, capability));
  if (covering.length === 0) {
    return { ok: false, code: "grant_missing", message: `The end user's grant does not cover ${capability}.` };
  }
  if (!covering.some((s) => rank(tier) <= rank(s.maxTier))) {
    return { ok: false, code: "grant_missing", message: `The end user's grant does not allow ${tier} actions (${capability}).` };
  }
  return { ok: true };
}

export interface PolicyAllowed {
  ok: true;
  tier: RiskTier;
  /** C8 `confirmation`; `needsConfirmation` → the action is stored `needs_confirmation`, not executed. */
  confirmation: { required: boolean; mode: ConfirmationMode | null };
}

/** Which confirmation mode applies to a tier under a profile, with the C7 defaults. */
export function confirmationModeFor(tier: RiskTier, profile: ContextProfile): ConfirmationMode | null {
  const configured = profile.confirmation?.[tier];
  if (tier === "T4") return configured && configured !== "none" ? configured : "deny";
  if (tier === "T3") return configured ?? null;
  return configured && configured !== "none" ? configured : null;
}

export function evaluatePolicy(input: {
  capability: CapabilityId;
  grant: DeviceGrant | null;
  profile: ContextProfile;
  now: number;
}): PolicyAllowed | PolicyDenied {
  const g = checkGrant(input.grant, input.capability, input.now);
  if (!g.ok) return g;
  const tier = CAPABILITY_RISK_TIER[input.capability];
  const mode = confirmationModeFor(tier, input.profile);
  if (mode === "deny") {
    return {
      ok: false,
      code: "confirmation_denied",
      message:
        tier === "T4"
          ? `${input.capability} is a T4 (safety-critical) capability: denied unless the project's profile configures confirmation on every call.`
          : `${input.capability} is denied for ${tier} by profile "${input.profile.id}".`,
    };
  }
  const required = mode === "on_device" || mode === "trusted_surface";
  return { ok: true, tier, confirmation: { required, mode: required ? mode : null } };
}

/** Default per-project, per-env request budget (actions + deliveries) per window. */
export const DEFAULT_RATE_LIMIT = { max: 600, windowMs: 60_000 } as const;

export function checkRateLimit(recentCount: number, limit: { max: number; windowMs: number } = DEFAULT_RATE_LIMIT): GrantCheck {
  if (recentCount >= limit.max) {
    return {
      ok: false,
      code: "rate_limited",
      message: `This project sent ${recentCount} actions in the last ${limit.windowMs / 1000}s (limit ${limit.max}). Retry shortly.`,
    };
  }
  return { ok: true };
}
