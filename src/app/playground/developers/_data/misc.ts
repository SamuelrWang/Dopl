/** API keys, webhook endpoints, plan and Connect defaults. */
import type { CapabilityScope, RiskTier } from "@dopl/device-contracts";
import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import { minsAgo, type Env } from "./company";

export interface ApiKeyRow {
  id: string;
  name: string;
  kind: "secret" | "publishable";
  env: Env;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export const SEED_KEYS: ApiKeyRow[] = [
  { id: "key_01", name: "Assist backend", kind: "secret", env: "live", prefix: "sk_live_8fQ2", scopes: ["deliver", "users.read", "devices.read", "devices.act"], createdAt: minsAgo(79200), lastUsedAt: minsAgo(1), revoked: false },
  { id: "key_02", name: "Dispatch worker", kind: "secret", env: "live", prefix: "sk_live_Ld71", scopes: ["deliver"], createdAt: minsAgo(50400), lastUsedAt: minsAgo(145), revoked: false },
  { id: "key_03", name: "Connect widget", kind: "publishable", env: "live", prefix: "pk_live_R3s9", scopes: ["connect"], createdAt: minsAgo(79000), lastUsedAt: minsAgo(14), revoked: false },
  { id: "key_04", name: "Old reporting job", kind: "secret", env: "live", prefix: "sk_live_q0Zk", scopes: ["events.read"], createdAt: minsAgo(120000), lastUsedAt: minsAgo(62000), revoked: false },
  { id: "key_05", name: "Local development", kind: "secret", env: "test", prefix: "sk_test_Nw4c", scopes: ["deliver", "users.read", "devices.read", "devices.act", "events.read"], createdAt: minsAgo(82000), lastUsedAt: minsAgo(11), revoked: false },
  { id: "key_06", name: "Connect widget", kind: "publishable", env: "test", prefix: "pk_test_Hh20", scopes: ["connect"], createdAt: minsAgo(82000), lastUsedAt: minsAgo(240), revoked: false },
];

export const ALL_KEY_SCOPES = ["deliver", "users.read", "devices.read", "devices.act", "events.read", "webhooks.write"] as const;

export interface EndpointRow {
  id: string;
  env: Env;
  url: string;
  description: string;
  events: string[];
  state: "healthy" | "failing" | "paused";
  successRate: number;
  sent7d: number;
  lastAt: string;
}

export const SEED_ENDPOINTS: EndpointRow[] = [
  { id: "wh_prod", env: "live", url: "https://api.larkfield.example/dopl/events", description: "Assist backend", events: ["ask.answered", "action.completed", "action.failed", "connection.created", "connection.needs_reauth"], state: "healthy", successRate: 99.7, sent7d: 1284, lastAt: minsAgo(7) },
  { id: "wh_ops", env: "live", url: "https://ops.larkfield.example/hooks/dopl", description: "Ops dashboard presence", events: ["device.offline", "device.online"], state: "failing", successRate: 61.2, sent7d: 382, lastAt: minsAgo(1) },
  { id: "wh_test", env: "test", url: "https://staging.larkfield.example/dopl/events", description: "Staging", events: ["ask.answered", "action.completed", "action.failed"], state: "healthy", successRate: 100, sent7d: 148, lastAt: minsAgo(11) },
];

export const ALL_WEBHOOK_EVENTS = ["connection.created", "connection.revoked", "connection.needs_reauth", "device.offline", "device.online", "action.completed", "action.failed", "ask.answered", "input.utterance"] as const;

export const PLAN = { name: "Team", deliveriesIncluded: 25000, price: "$249 per month", renewsOn: "Nov 14", seats: 5, seatsIncluded: 10 };

export interface ConnectConfig {
  displayName: string;
  logoUrl: string;
  accent: string;
  allowedIntegrations: string[];
  scopes: CapabilityScope[];
  redirects: string[];
}

export const SEED_CONNECT: ConnectConfig = {
  displayName: "Larkfield Assist",
  logoUrl: "",
  accent: "#232a31",
  allowedIntegrations: ["even_realities", "dopl_desktop"],
  scopes: ["presence.read", "present.*", "ask.choice", "input.*"],
  redirects: ["https://app.larkfield.example/dopl/callback"],
};

/** Connect's scope choices grouped by tier: a family becomes `<family>.*` when it fits one tier. */
export function scopesByTier(): { tier: RiskTier; scopes: CapabilityScope[] }[] {
  const ids = Object.keys(CAPABILITY_RISK_TIER) as CapabilityId[];
  const families = [...new Set(ids.map((id) => CAPABILITY_FAMILY[id]))];
  const out = new Map<RiskTier, CapabilityScope[]>();
  for (const family of families) {
    const members = ids.filter((id) => CAPABILITY_FAMILY[id] === family);
    const tiers = new Set(members.map((id) => CAPABILITY_RISK_TIER[id]));
    if (tiers.size === 1 && members.length > 1) {
      const tier = [...tiers][0];
      out.set(tier, [...(out.get(tier) ?? []), `${family}.*` as CapabilityScope]);
    } else {
      for (const id of members) {
        const tier = CAPABILITY_RISK_TIER[id];
        out.set(tier, [...(out.get(tier) ?? []), id]);
      }
    }
  }
  return (["T0", "T1", "T2", "T3", "T4"] as RiskTier[]).filter((t) => out.has(t)).map((tier) => ({ tier, scopes: out.get(tier)! }));
}
