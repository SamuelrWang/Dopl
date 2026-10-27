/**
 * CONNECT CUSTOMIZATION: what the end user's Connect flow shows (branding, device types, default
 * scopes, redirect URIs), as a draft and a published copy. Pure.
 */
import type { CapabilityFamily, CapabilityId, CapabilityScope, ConnectBranding, RiskTier } from "@dopl/contracts/device-sdk";
import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, RISK_TIERS } from "@dopl/contracts/device-sdk";
import { DEMO_PROJECT } from "./fixtures";

export interface ConnectConfig {
  branding: ConnectBranding;
  /** Device type ids (`./device-types.ts`) the user may pick. */
  allowed_types: string[];
  /** Scopes Connect asks for by default. */
  scopes: CapabilityScope[];
  redirect_uris: string[];
}

export const DEFAULT_CONNECT_CONFIG: ConnectConfig = {
  branding: { ...DEMO_PROJECT.branding },
  allowed_types: ["even_g2", "desktop", "simulator"],
  scopes: ["presence.read", "present.*", "ask.*", "input.*"],
  redirect_uris: ["https://app.acme-agents.com/dopl/callback"],
};

export const configDirty = (draft: ConnectConfig, published: ConnectConfig) => JSON.stringify(draft) !== JSON.stringify(published);

/**
 * The scope choices grouped by risk tier: a family becomes `<family>.*` when every capability in it
 * sits in one tier; otherwise its capabilities are listed one by one under their own tiers.
 */
export function scopesByTier(): Array<{ tier: RiskTier; scopes: CapabilityScope[] }> {
  const ids = Object.keys(CAPABILITY_RISK_TIER) as CapabilityId[];
  const families = [...new Set(ids.map((id) => CAPABILITY_FAMILY[id]))] as CapabilityFamily[];
  const out = new Map<RiskTier, CapabilityScope[]>(RISK_TIERS.map((t) => [t, []]));
  for (const f of families) {
    const members = ids.filter((id) => CAPABILITY_FAMILY[id] === f);
    const tiers = new Set(members.map((id) => CAPABILITY_RISK_TIER[id]));
    if (tiers.size === 1 && members.length > 1) out.get([...tiers][0])!.push(`${f}.*` as CapabilityScope);
    else for (const id of members) out.get(CAPABILITY_RISK_TIER[id])!.push(id);
  }
  return RISK_TIERS.map((tier) => ({ tier, scopes: out.get(tier)! })).filter((g) => g.scopes.length > 0);
}

export function tierOfScope(scope: CapabilityScope): RiskTier {
  if (!scope.endsWith(".*")) return CAPABILITY_RISK_TIER[scope as CapabilityId];
  const family = scope.slice(0, -2);
  const ids = (Object.keys(CAPABILITY_RISK_TIER) as CapabilityId[]).filter((id) => CAPABILITY_FAMILY[id] === family);
  return RISK_TIERS.find((t) => ids.some((id) => CAPABILITY_RISK_TIER[id] === t)) ?? "T0";
}
