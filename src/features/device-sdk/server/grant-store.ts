import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { CAPABILITY_IDS, RISK_TIERS, type CapabilityScope, type RiskTier } from "../types";
import type { DeviceGrant } from "../delivery/policy";
import { tierOfScope } from "./connect/scopes";
import type { ConnectionRow } from "./connect/store-types";
import type { GrantLookup, GrantStore } from "./delivery-store";

/**
 * C7 END-USER GRANTS, read through the `GrantStore` port (`delivery-store.ts`) from A4's
 * `connections` table (`20261122400000_device_sdk_connect.sql`): the newest NOT-REVOKED connection
 * of (project, env, end user, device). `granted_scopes` + `tier_grants` (`{ scope: tier }`, the
 * highest tier shown on the consent screen) become `DeviceGrant.scopes`; `status`, `expires_at`,
 * `revoked_at` carry through, and `policy.ts › checkGrant` decides.
 *
 * Fail-closed: an unknown scope or tier string is DROPPED, never widened; a scope with no
 * `tier_grants` entry falls back to its own C3 tier (`connect/scopes.ts › tierOfScope`, the value
 * the consent screen writes). A read error throws (a 500), never an implicit grant.
 */

const FAMILY_SCOPE = /^(state|present|ask|capture|input|act|act[.]motion)[.][*]$/;
const isScope = (s: string): s is CapabilityScope => FAMILY_SCOPE.test(s) || (CAPABILITY_IDS as readonly string[]).includes(s);
const isTier = (s: unknown): s is RiskTier => typeof s === "string" && (RISK_TIERS as readonly string[]).includes(s);

type ConnectionGrantRow = Pick<ConnectionRow, "granted_scopes" | "tier_grants" | "status" | "expires_at" | "revoked_at">;

export function grantFromRow(row: ConnectionGrantRow): DeviceGrant {
  const tiers = (row.tier_grants ?? {}) as Record<string, unknown>;
  return {
    scopes: (row.granted_scopes ?? []).filter(isScope).map((scope) => {
      const t = tiers[scope];
      return { scope, maxTier: isTier(t) ? t : tierOfScope(scope) };
    }),
    status: row.status,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

export const supabaseGrantStore: GrantStore = {
  async load(q: GrantLookup) {
    const res = await supabaseAdmin()
      .from("connections")
      .select("granted_scopes, tier_grants, status, expires_at, revoked_at")
      .eq("project_id", q.projectId)
      .eq("env", q.env)
      .eq("end_user_id", q.endUserId)
      .eq("device_id", q.deviceId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (res.error) throw new Error(`connections: ${res.error.message}`);
    return res.data ? grantFromRow(res.data as ConnectionGrantRow) : null;
  },
};

/**
 * TEST MODE ONLY: a `simulator` device in the `test` env with no connection row gets T0–T3 over every
 * non-motion family, so a developer can exercise `deliver` / `actions` end to end without running the
 * Connect widget. 🔒 Never in `live`, never for a real adapter, never T4 (T4 stays deny-by-default).
 */
export const SIMULATOR_TEST_GRANT: DeviceGrant = {
  scopes: (["state.*", "present.*", "ask.*", "capture.*", "input.*", "act.*"] as const).map((scope) => ({ scope, maxTier: "T3" as RiskTier })),
  status: "active",
  expiresAt: null,
  revokedAt: null,
};
