import { describe, expect, it } from "vitest";
import { canManageKeys, logCursor, parseLogCursor } from "./scope";

const EVT = "44444444-4444-4444-8444-444444444444";

describe("log cursor", () => {
  it("keeps a microsecond / offset ts exactly (no Date round-trip)", () => {
    for (const ts of ["2026-10-28T10:00:00.123456+00:00", "2026-10-28T10:00:00.123456Z", "2026-10-28T10:00:00Z"]) {
      const c = logCursor({ ts, event_id: EVT });
      expect(parseLogCursor(c)).toEqual({ ts, eventId: EVT });
    }
  });

  it("refuses a ts with more than 6 fraction digits or no zone", () => {
    for (const ts of ["2026-10-28T10:00:00.1234567Z", "2026-10-28T10:00:00", "2026-10-28 10:00:00Z"]) {
      expect(parseLogCursor(`${ts}~${EVT}`)).toBeNull();
    }
  });
});

describe("canManageKeys", () => {
  it("is owner or admin only", () => {
    expect(canManageKeys("owner")).toBe(true);
    expect(canManageKeys("admin")).toBe(true);
    expect(canManageKeys("developer")).toBe(false);
  });
});
