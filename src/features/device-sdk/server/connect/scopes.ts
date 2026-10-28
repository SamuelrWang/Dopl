/**
 * Capability SCOPES as the Connect consent screen sees them (C3 + C7). A scope is one capability id
 * or a whole family (`present.*`). Pure: no I/O, safe on the client.
 *
 * A family scope's tier is the HIGHEST default tier of its members (`act.*` holds `act.lock`, so it is
 * T4): the consent screen must never show a scope under a tier lower than something it grants.
 */
import {
  CAPABILITY_FAMILY,
  CAPABILITY_IDS,
  CAPABILITY_RISK_TIER,
  RISK_TIERS,
  RISK_TIER_DEFAULT_POLICY,
  type CapabilityDescriptor,
  type CapabilityId,
  type RiskTier,
} from "../../types";

/** The capability ids a scope covers. `act.*` is family `act` only; `act.motion.*` is its own family. */
export function capabilitiesOfScope(scope: string): CapabilityId[] {
  if (scope.endsWith(".*")) {
    const family = scope.slice(0, -2);
    return CAPABILITY_IDS.filter((c) => CAPABILITY_FAMILY[c] === family);
  }
  return (CAPABILITY_IDS as readonly string[]).includes(scope) ? [scope as CapabilityId] : [];
}

const rank = (t: RiskTier) => RISK_TIERS.indexOf(t);

/** The highest default tier among the scope's capabilities (T0 for an empty scope). */
export function tierOfScope(scope: string): RiskTier {
  return capabilitiesOfScope(scope).reduce<RiskTier>(
    (max, c) => (rank(CAPABILITY_RISK_TIER[c]) > rank(max) ? CAPABILITY_RISK_TIER[c] : max),
    "T0"
  );
}

/** C7: T0/T1 default on; T2+ needs an explicit tick (T2 explicit grant, T3 configurable, T4 confirm every call). */
export function defaultGranted(tier: RiskTier): boolean {
  return RISK_TIER_DEFAULT_POLICY[tier] === "allow";
}

/** True when the device publishes at least one capability the scope covers. */
export function scopeSupported(scope: string, descriptors: readonly CapabilityDescriptor[]): boolean {
  const have = new Set(descriptors.map((d) => d.capability));
  return capabilitiesOfScope(scope).some((c) => have.has(c));
}

/** `{ scope: tier }` for the scopes granted — what `connections.tier_grants` stores. */
export function tierGrants(scopes: readonly string[]): Record<string, RiskTier> {
  return Object.fromEntries(scopes.map((s) => [s, tierOfScope(s)]));
}
