/**
 * `connections` row → `DeviceGrant` (fail-closed), and the end-to-end grant decision against it.
 */
import { describe, expect, it } from "vitest";
import { checkGrant } from "../delivery/policy";
import { grantFromRow, SIMULATOR_TEST_GRANT } from "./grant-store";
import { tierGrants } from "./connect/scopes";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const row = (over: Partial<Parameters<typeof grantFromRow>[0]> = {}) => ({
  granted_scopes: ["present.*", "act.set"],
  tier_grants: tierGrants(["present.*", "act.set"]),
  status: "active" as const,
  expires_at: null,
  revoked_at: null,
  ...over,
});

describe("grantFromRow", () => {
  it("maps granted_scopes + tier_grants written by the consent screen", () => {
    const g = grantFromRow(row());
    expect(g.scopes).toEqual([
      { scope: "present.*", maxTier: "T1" },
      { scope: "act.set", maxTier: "T3" },
    ]);
    expect(checkGrant(g, "present.display", NOW)).toEqual({ ok: true });
    expect(checkGrant(g, "act.set", NOW)).toEqual({ ok: true });
    expect(checkGrant(g, "act.lock", NOW)).toMatchObject({ ok: false, code: "grant_missing" });
  });

  it("fail-closed: unknown scopes and tiers are dropped, never widened", () => {
    const g = grantFromRow(row({ granted_scopes: ["present.*", "everything", "act.*"], tier_grants: { "act.*": "T9" } as never }));
    expect(g.scopes.map((s) => s.scope)).toEqual(["present.*", "act.*"]);
    expect(g.scopes[1].maxTier).toBe("T4");
  });

  it("status and expiry carry through", () => {
    expect(checkGrant(grantFromRow(row({ status: "needs_reauth" })), "present.display", NOW)).toMatchObject({ code: "needs_reauth" });
    expect(checkGrant(grantFromRow(row({ expires_at: "2026-10-27T11:00:00Z" })), "present.display", NOW)).toMatchObject({ code: "grant_expired" });
  });

  it("the test-mode simulator grant never reaches T4", () => {
    expect(SIMULATOR_TEST_GRANT.scopes.every((s) => s.maxTier !== "T4")).toBe(true);
    expect(checkGrant(SIMULATOR_TEST_GRANT, "act.lock", NOW)).toMatchObject({ ok: false });
  });
});
