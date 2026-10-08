import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: () => { throw new Error("no real db in tests"); } }));

import {
  __resetCatalogCompatForTests,
  catalogsForUser,
  isMissingCatalogTable,
  upsertCatalog,
  type CatalogDb,
} from "./repository";

const MISSING_PG = { code: "42P01", message: 'relation "public.runtime_model_catalogs" does not exist' };
const MISSING_REST = { code: "PGRST205", message: "Could not find the table 'public.runtime_model_catalogs' in the schema cache" };

function fakeDb(opts: { error?: unknown; rows?: unknown[] } = {}) {
  const calls = { upserts: [] as Record<string, unknown>[], selects: 0 };
  const db: CatalogDb = {
    from: () => ({
      upsert: (row) => {
        calls.upserts.push(row);
        return Promise.resolve({ error: opts.error ?? null });
      },
      select: () => ({
        eq: () => {
          calls.selects += 1;
          return Promise.resolve({ data: opts.error ? null : (opts.rows ?? []), error: opts.error ?? null });
        },
      }),
    }),
  };
  return { db, calls };
}

const INPUT = { runtime: "claude", models: [{ id: "m-1", label: "M 1", isDefault: true }] };

let clock = 0;
beforeEach(() => {
  clock = Date.parse("2026-10-08T12:00:00Z");
  __resetCatalogCompatForTests(() => clock);
});

describe("runtime_model_catalogs, tolerant of the table not existing yet (INVARIANTS §12)", () => {
  it("writes labels-only rows with the default id and a server timestamp", async () => {
    const { db, calls } = fakeDb();
    expect(await upsertCatalog("u1", "dev-1", INPUT, db)).toEqual({ stored: true });
    expect(calls.upserts[0]).toMatchObject({ user_id: "u1", device_id: "dev-1", runtime: "claude", default_id: "m-1" });
    expect(calls.upserts[0].published_at).toBe("2026-10-08T12:00:00.000Z");
  });

  it("detects the missing table from either error spelling, and only for THIS table", () => {
    expect(isMissingCatalogTable(MISSING_PG)).toBe(true);
    expect(isMissingCatalogTable(MISSING_REST)).toBe(true);
    expect(isMissingCatalogTable({ code: "42P01", message: 'relation "other" does not exist' })).toBe(false);
    expect(isMissingCatalogTable({ code: "23505", message: "runtime_model_catalogs" })).toBe(false);
  });

  it("🔒 missing table: publish answers stored:false and the read answers [] (glasses fall back)", async () => {
    const { db } = fakeDb({ error: MISSING_REST });
    expect(await upsertCatalog("u1", "dev-1", INPUT, db)).toEqual({ stored: false });
    expect(await catalogsForUser("u1", db)).toEqual([]);
  });

  it("remembers the miss for 5 minutes, then tries the table again (applying heals with no deploy)", async () => {
    const missing = fakeDb({ error: MISSING_PG });
    await catalogsForUser("u1", missing.db);
    const healed = fakeDb({ rows: [] });
    await catalogsForUser("u1", healed.db);
    expect(healed.calls.selects).toBe(0);
    clock += 5 * 60 * 1000 + 1;
    await catalogsForUser("u1", healed.db);
    expect(healed.calls.selects).toBe(1);
  });

  it("any OTHER error is still an error", async () => {
    const { db } = fakeDb({ error: { code: "XX000", message: "boom" } });
    await expect(upsertCatalog("u1", "dev-1", INPUT, db)).rejects.toThrow(/boom/);
    await expect(catalogsForUser("u1", db)).rejects.toThrow(/boom/);
  });

  it("🔒 re-validates rows on the way out: a bad model is dropped, not replayed onto a device", async () => {
    const { db } = fakeDb({
      rows: [
        {
          runtime: "claude",
          device_id: "dev-1",
          models: [{ id: "ok-1", label: "Ok" }, { id: "has space" }, { nope: true }],
          default_id: null,
          published_at: "2026-10-08T11:00:00Z",
        },
      ],
    });
    const rows = await catalogsForUser("u1", db);
    expect(rows[0].models.map((m) => m.id)).toEqual(["ok-1"]);
    expect(rows[0].deviceId).toBe("dev-1");
  });

  it("two computers keep separate rows: the conflict key includes the device", async () => {
    const onConflicts: string[] = [];
    const db: CatalogDb = {
      from: () => ({
        upsert: (_row, opts) => {
          onConflicts.push(opts.onConflict);
          return Promise.resolve({ error: null });
        },
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      }),
    };
    await upsertCatalog("u1", "mac-a", INPUT, db);
    expect(onConflicts).toEqual(["user_id,runtime,device_id"]);
  });

  it("🔒 a row with no device is dropped, never shown as anyone's", async () => {
    const { db } = fakeDb({ rows: [{ runtime: "claude", models: [{ id: "m" }], published_at: "2026-10-08T11:00:00Z" }] });
    expect(await catalogsForUser("u1", db)).toEqual([]);
  });
});

