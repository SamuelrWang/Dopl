/**
 * `updateIdentityRow`'s query shape, recorded. An empty patch must be a read: PostgREST cannot emit
 * `UPDATE … SET` with no assignments (F-404). The service never sends one (`service-writes-junction.test.ts`),
 * so this keeps the repository total on its own.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { updateIdentityRow } from "./repository";

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

/** Mutable so a case can play the concurrent writer. */
let liveUpdatedAt = "2026-09-01T00:00:00Z";

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
    // Honours the `updated_at` filter like Postgres (zero rows → `null`): the only way to tell a CAS from a check-then-act.
    maybeSingle: () => {
      rec.single += 1;
      const expected = rec.filters.find(([c]) => c === "updated_at")?.[1];
      const matched = expected === undefined || expected === liveUpdatedAt;
      return Promise.resolve({
        data: matched ? { ...ROW, updated_at: liveUpdatedAt } : null,
        error: null,
      });
    },
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  rec = { tables: [], select: "", updates: [], filters: [], single: 0 };
  liveUpdatedAt = "2026-09-01T00:00:00Z";
  primeSupabase();
});

describe("updateIdentityRow — the empty patch is a READ, not a write", () => {
  it("issues NO update for a patch that names no scalar column, and still returns the row", async () => {
    const result = await updateIdentityRow(WS, ID, {});

    expect(rec.updates).toEqual([]);
    expect(rec.tables).toEqual(["agent_identities"]);
    expect(rec.select).toContain("id");
    expect(rec.single).toBe(1);
    expect(result.id).toBe(ID);
    expect(result.name).toBe("Orchestrator");
    expect(result.workspaceId).toBe(WS);
  });

  it("an all-`undefined` patch is the same empty patch — that IS how a KB-only patch arrives", async () => {
    await expect(
      updateIdentityRow(WS, ID, {
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
    await updateIdentityRow(WS, ID, {});
    expect(rec.filters).toEqual([
      ["workspace_id", WS],
      ["id", ID],
    ]);
  });
});

describe("updateIdentityRow — a real patch still writes", () => {
  it("sends only the named columns, and never `updated_at` (the trigger owns it)", async () => {
    await updateIdentityRow(WS, ID, { name: "Renamed", model: null });

    expect(rec.updates).toEqual([{ name: "Renamed", model: null }]);
    expect(rec.updates[0]).not.toHaveProperty("updated_at");
    expect(rec.filters).toEqual([
      ["workspace_id", WS],
      ["id", ID],
    ]);
  });

  it("`null` clears a column and is NOT confused with `undefined`", async () => {
    await updateIdentityRow(WS, ID, { description: null });
    expect(rec.updates).toEqual([{ description: null }]);
  });

  it("writes the runtime column, and selects it back", async () => {
    await updateIdentityRow(WS, ID, { runtime: "codex" });
    expect(rec.updates).toEqual([{ runtime: "codex" }]);
    expect(rec.select).toMatch(/\bruntime\b/);
  });
});

/** The compare-and-swap (F-747): a service-level `existing.updatedAt !== expected` would fail the race case. */
describe("updateIdentityRow — the `expected_version` precondition", () => {
  it("puts the version in the WHERE clause, not in the update body", async () => {
    await updateIdentityRow(WS, ID, { name: "Renamed" }, "2026-09-01T00:00:00Z");

    expect(rec.updates).toEqual([{ name: "Renamed" }]);
    expect(rec.filters).toEqual([
      ["workspace_id", WS],
      ["id", ID],
      ["updated_at", "2026-09-01T00:00:00Z"],
    ]);
  });

  it("answers `null` — never a throw — when the row moved under the caller", async () => {
    const lost = await updateIdentityRow(
      WS,
      ID,
      { name: "Renamed" },
      "2026-08-30T00:00:00Z"
    );
    expect(lost).toBeNull();
  });

  it("THE RACE: two writers hold one version and exactly one lands", async () => {
    const version = "2026-09-01T00:00:00Z";

    const first = await updateIdentityRow(WS, ID, { name: "A" }, version);
    expect(first).not.toBeNull();
    liveUpdatedAt = "2026-09-01T00:00:05Z";

    // Writer B read the same version before A committed.
    const second = await updateIdentityRow(WS, ID, { name: "B" }, version);
    expect(second).toBeNull();
  });

  it("fences the EMPTY patch too — a junction-only write still honours a version", async () => {
    liveUpdatedAt = "2026-09-01T00:00:05Z";
    const lost = await updateIdentityRow(WS, ID, {}, "2026-09-01T00:00:00Z");

    expect(rec.updates).toEqual([]);
    expect(rec.filters).toContainEqual(["updated_at", "2026-09-01T00:00:00Z"]);
    expect(lost).toBeNull();
  });

  it("STALE PAYLOAD: an older caller that passes no version keeps last-writer-wins", async () => {
    liveUpdatedAt = "2026-09-01T00:00:05Z";
    const saved = await updateIdentityRow(WS, ID, { name: "Renamed" });

    expect(rec.filters.map(([c]) => c)).not.toContain("updated_at");
    expect(saved.id).toBe(ID);
  });
});
