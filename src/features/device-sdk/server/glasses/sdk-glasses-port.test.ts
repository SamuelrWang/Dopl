import { describe, expect, it, vi } from "vitest";

/** `isDoplAppProject` (W1.2 review nit 5): only the internal org's "Dopl App" project, live env. */

const tables = vi.hoisted(() => ({
  dev_projects: [
    { id: "p-app", org_id: "o-internal", name: "Dopl App" },
    { id: "p-named", org_id: "o-customer", name: "Dopl App" },
    { id: "p-other", org_id: "o-internal", name: "Playground" },
  ],
  dev_orgs: [
    { id: "o-internal", internal: true },
    { id: "o-customer", internal: false },
  ],
}));
const reads = vi.hoisted(() => ({ n: 0 }));

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (table: keyof typeof tables) => {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (filters.push([col, v]), q),
        maybeSingle: async () => {
          reads.n++;
          const row = tables[table].find((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
          return { data: row ?? null, error: null };
        },
      };
      return q;
    },
  }),
}));

import { sdkGlassesPort } from "./sdk-glasses-port";

describe("sdkGlassesPort.isDoplAppProject", () => {
  const is = (p: string, env = "live") => sdkGlassesPort.isDoplAppProject!(p, env);

  it("true only for the internal org's Dopl App project, live", async () => {
    expect(await is("p-app")).toBe(true);
    expect(await is("p-app", "test")).toBe(false);
    expect(await is("p-named")).toBe(false);
    expect(await is("p-other")).toBe(false);
    expect(await is("p-missing")).toBe(false);
  });

  it("cached: a second ask about the same project reads nothing", async () => {
    const before = reads.n;
    await is("p-app");
    expect(reads.n).toBe(before);
  });
});
