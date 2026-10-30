import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS } from "@dopl/device-contracts";
import { CATEGORIES, INTEGRATIONS, integrationsIn } from "./catalog";
import { LOGS, byIntegration, dailyBars, rowsForUser, topErrors, usageOf } from "./logs";

describe("catalog", () => {
  it("keeps the empty category and no simulator entry", () => {
    expect(CATEGORIES.map((c) => c.name)).toEqual(["Glasses", "Desktop", "Phone", "Vehicle", "Home", "Robots"]);
    expect(integrationsIn("robots")).toEqual([]);
    expect(INTEGRATIONS.map((i) => i.id)).not.toContain("simulator");
  });
});

describe("logs", () => {
  it("holds no message content, only the row facts", () => {
    const keys = ["at", "capability", "errorCode", "id", "latencyMs", "modelId", "status", "userId"];
    for (const env of ["live", "test"] as const) {
      for (const row of LOGS[env]) {
        expect(Object.keys(row).sort()).toEqual(keys);
        expect(CAPABILITY_IDS).toContain(row.capability);
      }
    }
  });

  it("has 25 active live users and figures that add up", () => {
    const usage = usageOf("live");
    expect(usage.activeUsers).toBe(25);
    expect(byIntegration("live").reduce((n, row) => n + row.calls, 0)).toBe(usage.calls);
    const failed = usage.calls - usage.delivered;
    expect(topErrors("live").reduce((n, row) => n + row.count, 0)).toBe(failed);
  });

  it("charts 14 days", () => {
    expect(dailyBars("live")).toHaveLength(14);
  });

  it("finds rows only by a full user id", () => {
    expect(rowsForUser("live", "tech_1107").length).toBeGreaterThan(0);
    expect(rowsForUser("live", "tech_1107").every((r) => r.userId === "tech_1107")).toBe(true);
    expect(rowsForUser("live", "tech")).toEqual([]);
    expect(rowsForUser("live", "  ")).toEqual([]);
  });
});
