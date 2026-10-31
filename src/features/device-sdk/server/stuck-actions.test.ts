import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./connect/store", () => ({ connectStore: {} }));
vi.mock("./glasses/sdk-glasses-port", () => ({ supabaseLensActions: {} }));
const admin = vi.fn(() => ({}));
const emitActionSettled = vi.fn();
vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => admin() }));
vi.mock("./webhooks/action-events", () => ({ emitActionSettled: (...a: unknown[]) => emitActionSettled(...a) }));

const { stuckPatch, sweepStuckActions } = await import("./stuck-actions");

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

describe("sweepStuckActions", () => {
  it("🔒 a never-queued action fails with action.failed too, and the write stays conditional on queued", async () => {
    const ops: Array<[string, ...unknown[]]> = [];
    const row = { id: "a1", device_id: "d1", capability: "present.notify", result: null, response: { status: "queued" }, devices: { kind: "glasses" } };
    const settled = { ...row, status: "failed" };
    const chain: Record<string, unknown> = {};
    let updating = false;
    for (const op of ["select", "eq", "lt", "order", "in", "update"]) {
      chain[op] = (...args: unknown[]) => {
        ops.push([op, ...args]);
        if (op === "update") updating = true;
        return chain;
      };
    }
    chain.limit = async () => ({ data: [row], error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: updating ? [settled] : [], error: null });
    admin.mockReturnValue({ from: () => chain });

    expect(await sweepStuckActions(new Date("2026-10-31T00:00:00.000Z"))).toBe(1);
    expect(ops).toContainEqual(["lt", "created_at", "2026-10-30T23:45:00.000Z"]);
    expect(ops.filter((o) => o[0] === "eq" && o[1] === "status" && o[2] === "queued").length).toBe(2);
    expect(emitActionSettled).toHaveBeenCalledWith(expect.anything(), [settled]);
  });
});
