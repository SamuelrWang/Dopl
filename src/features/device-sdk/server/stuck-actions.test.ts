import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./connect/store", () => ({ connectStore: {} }));
vi.mock("./glasses/sdk-glasses-port", () => ({ supabaseLensActions: {} }));
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => ({}) }));

const { stuckPatch } = await import("./stuck-actions");

describe("a stuck action's end", () => {
  const base = { kind: "glasses" as const, at: "2026-10-31T00:00:00.000Z" };

  it("fails when no device took it, whether the message lapsed or was never queued", () => {
    for (const lensStatus of ["expired", "pending", null]) {
      const patch = stuckPatch({ ...base, capability: "present.notify", lensStatus });
      expect(patch.status).toBe("failed");
      expect(patch.error?.code).toBe("device_offline");
    }
  });

  it("finishes a notice the device did take: the status write lost a race or failed", () => {
    expect(stuckPatch({ ...base, capability: "present.notify", lensStatus: "delivered" })).toMatchObject({ status: "done", delivered_at: base.at, settled_at: base.at });
  });

  it("leaves an ask open at delivered: only its answer finishes it", () => {
    expect(stuckPatch({ ...base, capability: "ask.choice", lensStatus: "delivered" })).toEqual({ status: "delivered", delivered_at: base.at });
  });
});
