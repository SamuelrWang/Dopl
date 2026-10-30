/** API keys, webhook endpoints, plan and Connect defaults. */
import type { CapabilityScope, RiskTier } from "@dopl/device-contracts";
import { CAPABILITY_FAMILY, CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import { MEMBERS, minsAgo, type Env } from "./company";

export interface ApiKeyRow {
  id: string;
  name: string;
  kind: "secret" | "publishable";
  env: Env;
  prefix: string;
  /** Publishable keys only: they stay readable, a secret is shown once. */
  token?: string;
  scopes: string[];
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  calls7d: number;
  revoked: boolean;
  revokedAt?: string;
  /** Set by a rotation that leaves the previous secret working for a while. */
  oldSecretEndsAt?: string;
}

const [PRIYA, JONAS, MEI, DARIO] = MEMBERS;

export const SEED_KEYS: ApiKeyRow[] = [
  { id: "key_01", name: "Assist backend", kind: "secret", env: "live", prefix: "sk_live_8fQ2", scopes: ["deliver", "users.read", "devices.read", "devices.act"], createdAt: minsAgo(79200), createdBy: PRIYA.name, lastUsedAt: minsAgo(1), calls7d: 12480, revoked: false },
  { id: "key_02", name: "Dispatch worker", kind: "secret", env: "live", prefix: "sk_live_Ld71", scopes: ["deliver"], createdAt: minsAgo(50400), createdBy: JONAS.name, lastUsedAt: minsAgo(145), calls7d: 3264, revoked: false },
  { id: "key_03", name: "Connect widget", kind: "publishable", env: "live", prefix: "pk_live_R3s9", token: "pk_live_R3s9tVb6mKe2xNw7Yc4HqZ8d", scopes: ["connect"], createdAt: minsAgo(79000), createdBy: PRIYA.name, lastUsedAt: minsAgo(14), calls7d: 842, revoked: false },
  { id: "key_04", name: "Old reporting job", kind: "secret", env: "live", prefix: "sk_live_q0Zk", scopes: ["events.read"], createdAt: minsAgo(120000), createdBy: DARIO.name, lastUsedAt: minsAgo(62000), calls7d: 0, revoked: false },
  { id: "key_05", name: "Local development", kind: "secret", env: "test", prefix: "sk_test_Nw4c", scopes: ["deliver", "users.read", "devices.read", "devices.act", "events.read"], createdAt: minsAgo(82000), createdBy: MEI.name, lastUsedAt: minsAgo(11), calls7d: 1176, revoked: false },
  { id: "key_06", name: "Connect widget", kind: "publishable", env: "test", prefix: "pk_test_Hh20", token: "pk_test_Hh20pRa5sJd9uFk3Lg6TnW2y", scopes: ["connect"], createdAt: minsAgo(82000), createdBy: MEI.name, lastUsedAt: minsAgo(240), calls7d: 63, revoked: false },
  { id: "key_07", name: "Contractor sandbox", kind: "secret", env: "live", prefix: "sk_live_Vm3x", scopes: ["devices.read"], createdAt: minsAgo(150000), createdBy: JONAS.name, lastUsedAt: minsAgo(21000), calls7d: 0, revoked: true, revokedAt: minsAgo(12000) },
];

/** What a secret key can be allowed to do. A publishable key only ever opens Connect. */
export const KEY_SCOPES = [
  { id: "deliver", name: "Send to devices" },
  { id: "devices.act", name: "Control devices" },
  { id: "devices.read", name: "Read devices" },
  { id: "users.read", name: "Read users" },
  { id: "events.read", name: "Read events" },
  { id: "webhooks.write", name: "Manage webhooks" },
] as const;

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
