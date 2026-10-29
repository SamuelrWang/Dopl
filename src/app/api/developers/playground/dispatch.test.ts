import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("@/features/device-sdk/server/fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

import { PLAYGROUND_OPS } from "@/features/device-sdk/portal/playground-ops";
import { PLAYGROUND_DISPATCH } from "./dispatch";

describe("playground dispatch", () => {
  it("has exactly one handler per playground operation", () => {
    expect(Object.keys(PLAYGROUND_DISPATCH).sort()).toEqual(PLAYGROUND_OPS.map((o) => o.id).sort());
    for (const d of Object.values(PLAYGROUND_DISPATCH)) expect(typeof d.handler).toBe("function");
  });

  it("maps every op's path params onto non-empty route segments", () => {
    for (const op of PLAYGROUND_OPS) {
      const values = Object.fromEntries(op.pathParams.map((p) => [p.name, `v_${p.name}`]));
      const segments = PLAYGROUND_DISPATCH[op.id].segments(values);
      expect(Object.values(segments).sort(), op.id).toEqual(Object.values(values).sort());
    }
  });
});
