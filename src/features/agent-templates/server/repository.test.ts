/**
 * `updateTemplateRow`'s QUERY SHAPE, pinned by recording what it asks the
 * database for.
 *
 * ⚠ THE EMPTY PATCH IS THE WHOLE POINT OF THIS FILE (F-340). A KB-only patch —
 * `dopl_agent(op="update", knowledge_bases=[…])` — names none of the six scalar
 * columns, so the update body was `{}`, PostgREST cannot emit `UPDATE … SET`
 * with no assignments, and the raw driver error thrown here had no arm in
 * `http-mapping.ts`: agents got a bare INTERNAL_ERROR 500 for an entirely valid
 * request, deterministically, anywhere. The old docblock asserted "the service
 * never calls with one" and the service called with one on every junction-only
 * patch, which is exactly why the assertion had to become a test.
 *
 * The service now skips the round trip (`service-writes.test.ts`), so this file
 * is what keeps the REPOSITORY total on its own — the guard has no production
 * caller left to notice if it regresses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { updateTemplateRow } from "./repository";

const WS = "cccccccc-3333-4333-8333-333333333333";
const ID = "dddddddd-4444-4444-8444-444444444444";

interface Recorded {
  tables: string[];
  select: string;
  /** Every `.update()` body handed to PostgREST, in order. */
  updates: Array<Record<string, unknown>>;
  filters: Array<[string, unknown]>;
  single: number;
}

let rec: Recorded;

const ROW = {
  id: ID,
  workspace_id: WS,
  name: "Orchestrator",
  description: null,
  instructions: "Do the thing.",
  model: null,
  fields: [{ key: "role", value: "lead" }],
  visibility: "private",
  created_by: "user-owner",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

function primeSupabase() {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    from: (t: string) => {
      rec.tables.push(t);
      return builder;
    },
    select: (cols: string) => {
      rec.select = cols;
      return builder;
    },
    update: (body: Record<string, unknown>) => {
      rec.updates.push(body);
      return builder;
    },
    eq: (col: string, val: unknown) => {
      rec.filters.push([col, val]);
      return builder;
    },
    single: () => {
      rec.single += 1;
      return Promise.resolve({ data: ROW, error: null });
    },
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  rec = { tables: [], select: "", updates: [], filters: [], single: 0 };
  primeSupabase();
});

describe("updateTemplateRow — the empty patch is a READ, not a write", () => {
  it("issues NO update for a patch that names no scalar column, and still returns the row", async () => {
    const result = await updateTemplateRow(WS, ID, {});

    // The bug: this used to be `[{}]` and PostgREST 500'd on it.
    expect(rec.updates).toEqual([]);
    expect(rec.tables).toEqual(["agent_templates"]);
    expect(rec.select).toContain("id");
    expect(rec.single).toBe(1);
    // Total on the contract: callers still get the row back, not a throw.
    expect(result.id).toBe(ID);
    expect(result.name).toBe("Orchestrator");
    expect(result.workspaceId).toBe(WS);
  });

  it("an all-`undefined` patch is the same empty patch — that IS how a KB-only patch arrives", async () => {
    await expect(
      updateTemplateRow(WS, ID, {
        name: undefined,
        description: undefined,
        instructions: undefined,
        model: undefined,
        fields: undefined,
        visibility: undefined,
      })
    ).resolves.toBeTruthy();
    expect(rec.updates).toEqual([]);
  });

  it("stays workspace-scoped on the read path — the fence does not lapse when the write does", async () => {
    await updateTemplateRow(WS, ID, {});
    expect(rec.filters).toEqual([
      ["workspace_id", WS],
      ["id", ID],
    ]);
  });
});

describe("updateTemplateRow — a real patch still writes", () => {
  it("sends only the named columns, and never `updated_at` (the trigger owns it)", async () => {
    await updateTemplateRow(WS, ID, { name: "Renamed", model: null });

    expect(rec.updates).toEqual([{ name: "Renamed", model: null }]);
    expect(rec.updates[0]).not.toHaveProperty("updated_at");
    expect(rec.filters).toEqual([
      ["workspace_id", WS],
      ["id", ID],
    ]);
  });

  it("`null` clears a column and is NOT confused with `undefined`", async () => {
    await updateTemplateRow(WS, ID, { description: null });
    expect(rec.updates).toEqual([{ description: null }]);
  });
});
