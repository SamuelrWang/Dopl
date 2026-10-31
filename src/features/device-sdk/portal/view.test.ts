import { describe, expect, it } from "vitest";
import { computeIssues } from "./issues";
import { dailyBars, deviceState, endpointFailing, percentDelta, rowsBetween, totalsOf, type MetricRow, type PortalUser } from "./view";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const row = (day: string, deliveries: number, delivered: number): MetricRow => ({ day, user: "u", device: "d", kind: "glasses", key: null, calls: deliveries, errors: deliveries - delivered, deliveries, delivered, failed: deliveries - delivered, last_delivery: null });

describe("the portal's shared figures", () => {
  it("gives an empty day its own bar and ends on today", () => {
    const bars = dailyBars([row("2026-10-31", 4, 3), row("2026-10-29", 2, 2)], 3, NOW);
    expect(bars.map((b) => b.value)).toEqual([2, 0, 4]);
    expect(bars[1].rate).toBeNull();
    expect(bars[2].rate).toBe(75);
  });

  it("windows are inclusive of both ends, today being 0", () => {
    const rows = [row("2026-10-31", 1, 1), row("2026-10-25", 1, 1), row("2026-10-24", 1, 1)];
    expect(totalsOf(rowsBetween(rows, NOW, 6)).deliveries).toBe(2);
    expect(totalsOf(rowsBetween(rows, NOW, 13, 7)).deliveries).toBe(1);
  });

  it("shows no change when there is nothing to compare with", () => {
    expect(percentDelta(5, 0)).toBeNull();
    expect(percentDelta(5, 10)).toEqual({ text: "50.0%", down: true });
  });

  it("derives a device's state, relink first", () => {
    const base = { connectionStatus: "active", expiresAt: null, online: false, lastSeenAt: null, now: NOW };
    expect(deviceState({ ...base, connectionStatus: "needs_reauth", online: true })).toBe("needs_relink");
    expect(deviceState({ ...base, expiresAt: "2026-10-30T00:00:00Z", online: true })).toBe("needs_relink");
    expect(deviceState({ ...base, online: true })).toBe("online");
    expect(deviceState({ ...base, lastSeenAt: "2026-10-01T00:00:00Z" })).toBe("stale");
    expect(deviceState({ ...base, lastSeenAt: "2026-10-30T00:00:00Z" })).toBe("offline");
  });

  it("calls an endpoint failing on three straight failures, not on one", () => {
    const at = "2026-10-31T11:00:00Z";
    expect(endpointFailing([{ failed: true, at }, { failed: true, at }, { failed: true, at }], NOW)).toBe(true);
    expect(endpointFailing([{ failed: true, at }, { failed: false, at }, { failed: true, at }], NOW)).toBe(false);
  });
});

describe("issues", () => {
  const user = (over: Partial<PortalUser["devices"][number]>): PortalUser => ({
    id: "u1",
    name: "Ada",
    named: true,
    activeDeviceId: null,
    lastDeliveryAt: null,
    lastActiveAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    devices: [{ id: "d1", userId: "u1", name: "G2", modelId: "g2", state: "offline", firmware: null, lastSeenAt: null, pairedAt: "2026-10-01T00:00:00Z", grants: [], deliveries7d: 0, delivered7d: 0, ...over }],
  });

  it("is empty when nothing is wrong", () => {
    expect(computeIssues({ users: [user({})], errors: [], endpoints: [] })).toEqual([]);
  });

  it("groups errors by code, worst first, with a catch-all title for an unknown one", () => {
    const issues = computeIssues({
      users: [user({ state: "stale" })],
      endpoints: [],
      errors: [
        { event_id: "a", ts: "2026-10-30T00:00:00Z", error_code: "device_offline", external_user_id: "u1" },
        { event_id: "b", ts: "2026-10-31T00:00:00Z", error_code: "device_offline", external_user_id: "u2" },
        { event_id: "c", ts: "2026-10-31T00:00:00Z", error_code: "something_new", external_user_id: null },
      ],
    });
    expect(issues[0]).toMatchObject({ id: "error:device_offline", count: 2, latestCallId: "b", firstSeen: "2026-10-30T00:00:00Z", userIds: ["u1", "u2"] });
    expect(issues.find((i) => i.id === "error:something_new")?.title).toBe("something new");
    expect(issues.find((i) => i.kind === "stale_pairing")?.count).toBe(1);
  });
});
