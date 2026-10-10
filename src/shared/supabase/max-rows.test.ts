/**
 * THE CEILING, THE HONEST MARKER AND THE PAGE LOOP — the three pieces every
 * site in the `max_rows` sweep is built on (Samuel #2935).
 *
 * ⚠ **THE PAGE LOOP IS DRIVEN THROUGH A FAKE THAT CLIPS**, never through a stub
 * that returns whatever it was asked for: a loop tested against an obedient
 * server passes while being the bug. `postgrest-cap.ts` applies `max_rows` out of
 * `supabase/config.toml`.
 */

import { describe, expect, it } from "vitest";
import {
  POSTGREST_MAX_ROWS,
  clippedAt,
  effectiveCeiling,
  readAllPages,
} from "./max-rows";
import { MAX_ROWS, fakePostgrest, type Row } from "@/shared/testing/postgrest-cap";

/** `n` rows with a unique, totally-ordered key — what a page walk requires. */
function rows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(i).padStart(6, "0"),
    n: i,
  }));
}

describe("the ceiling constant", () => {
  it("is the one supabase/config.toml actually states", () => {
    // ⚠ Raising the server setting without moving this number would restore the
    // silent clip for every read that still hauls.
    expect(POSTGREST_MAX_ROWS).toBe(MAX_ROWS);
  });

  it("is the smaller of the asked limit and the server's", () => {
    expect(effectiveCeiling(20_000)).toBe(POSTGREST_MAX_ROWS);
    expect(effectiveCeiling(50)).toBe(50);
  });
});

describe("clippedAt", () => {
  it("calls a server-clipped read TRUNCATED even though it asked for far more", () => {
    // 🔒 THE REGRESSION. The old helper compared against `limit`, so
    // `1000 >= 20000` was false and a floor reported itself complete.
    expect(clippedAt(rows(POSTGREST_MAX_ROWS), 20_000).truncated).toBe(true);
  });

  it("leaves a genuinely short read alone", () => {
    expect(clippedAt(rows(12), 20_000).truncated).toBe(false);
  });

  it("still reports a read at a SUB-ceiling limit it actually reached", () => {
    expect(clippedAt(rows(50), 50).truncated).toBe(true);
  });
});

describe("readAllPages", () => {
  /** The read under test: ordered on the unique key, paged by the loop. */
  function walk(table: Row[], hardCap: number, pageSize?: number) {
    const fake = fakePostgrest({ t: table });
    const db = fake.client as {
      from: (t: string) => {
        select: (c: string) => {
          order: (c: string, o: { ascending: boolean }) => {
            range: (a: number, b: number) => PromiseLike<{
              data: Row[] | null;
              error: unknown;
            }>;
          };
        };
      };
    };
    return {
      fake,
      result: readAllPages<Row>(
        (from, to) =>
          db
            .from("t")
            .select("id, n")
            .order("id", { ascending: true })
            .range(from, to),
        { hardCap, pageSize }
      ),
    };
  }

  it("returns EVERY row of a set far past the server ceiling", async () => {
    // 🔒 THE FIX. A single `.limit(5000)` here comes back with 1,000 and says
    // nothing; the walk returns all 4,321.
    const { result } = walk(rows(4_321), 20_000);
    const scan = await result;
    expect(scan.rows).toHaveLength(4_321);
    expect(scan.truncated).toBe(false);
    // Complete AND in order — a page walk that skipped or doubled a row would
    // still have the right length on a lucky day.
    expect(scan.rows.map((r) => r.n)).toEqual(
      Array.from({ length: 4_321 }, (_, i) => i)
    );
  });

  it("proves the fake really is clipping, so the case above means something", async () => {
    const fake = fakePostgrest({ t: rows(4_321) });
    const db = fake.client as {
      from: (t: string) => {
        select: (c: string) => {
          limit: (n: number) => PromiseLike<{ data: Row[] | null }>;
        };
      };
    };
    const { data } = await db.from("t").select("id, n").limit(5_000);
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("asks for pages the server will answer in full, not the hardCap at once", async () => {
    const { fake, result } = walk(rows(2_500), 20_000);
    await result;
    const ranges = fake.calls
      .filter((c) => c.op === "range")
      .map((c) => c.args as [number, number]);
    // ⚠ Contiguous, non-overlapping, and no window wider than the ceiling — the
    // three properties that make a short page proof of exhaustion.
    expect(ranges[0]).toEqual([0, POSTGREST_MAX_ROWS - 1]);
    for (const [from, to] of ranges) {
      expect(to - from + 1).toBeLessThanOrEqual(POSTGREST_MAX_ROWS);
    }
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i][0]).toBe(ranges[i - 1][1] + 1);
    }
  });

  it("stops on the first short page instead of walking to the hardCap", async () => {
    const { fake, result } = walk(rows(10), 20_000);
    await result;
    expect(fake.pageReads()).toBe(1);
  });

  it("stops at an exact multiple of the page size, one empty page later", async () => {
    // ⚠ The boundary the loop must not read as "more to come forever": a full
    // final page is only exhausted once the next one answers empty.
    const { fake, result } = walk(rows(2 * POSTGREST_MAX_ROWS), 20_000);
    const scan = await result;
    expect(scan.rows).toHaveLength(2 * POSTGREST_MAX_ROWS);
    expect(scan.truncated).toBe(false);
    expect(fake.pageReads()).toBe(3);
  });

  it("reports TRUNCATED when the hardCap stops the walk", async () => {
    const { result } = walk(rows(5_000), 2_000);
    const scan = await result;
    expect(scan.rows).toHaveLength(2_000);
    expect(scan.truncated).toBe(true);
  });

  it("never fetches past the hardCap", async () => {
    const { fake, result } = walk(rows(5_000), 1_500);
    await result;
    const last = fake.calls.filter((c) => c.op === "range").at(-1);
    expect(last?.args).toEqual([1_000, 1_499]);
  });

  it("clamps a caller's oversized pageSize to the server ceiling", async () => {
    // A page wider than `max_rows` comes back short for the WRONG reason, and
    // the loop would call that exhaustion and silently drop the rest.
    const { fake, result } = walk(rows(2_500), 20_000, 20_000);
    const scan = await result;
    expect(scan.rows).toHaveLength(2_500);
    expect(fake.calls.filter((c) => c.op === "range")[0].args).toEqual([
      0,
      POSTGREST_MAX_ROWS - 1,
    ]);
  });

  it("throws the page's error rather than returning a short list as complete", async () => {
    const boom = { code: "42P01", message: "relation does not exist" };
    await expect(
      readAllPages<Row>(
        (from) =>
          Promise.resolve(
            from === 0
              ? { data: rows(POSTGREST_MAX_ROWS), error: null }
              : { data: null, error: boom }
          ),
        { hardCap: 20_000 }
      )
    ).rejects.toBe(boom);
  });

  it("treats a null page as empty, not as a crash", async () => {
    const scan = await readAllPages<Row>(
      () => Promise.resolve({ data: null, error: null }),
      { hardCap: 20_000 }
    );
    expect(scan).toEqual({ rows: [], truncated: false });
  });
});

describe("the fake's own contract", () => {
  it("keeps count EXACT while clipping the rows", async () => {
    const fake = fakePostgrest({ t: rows(3_000) });
    const db = fake.client as {
      from: (t: string) => {
        select: (c: string, o: { count: string; head: boolean }) => PromiseLike<{
          data: Row[] | null;
          count: number;
        }>;
      };
    };
    // 🔒 Why a COUNTED read is the sanctioned shape: `max_rows` never touches it.
    const { data, count } = await db
      .from("t")
      .select("id", { count: "exact", head: true });
    expect(count).toBe(3_000);
    expect(data).toBeNull();
  });

  it("answers PGRST202 for an RPC nobody taught it — the unapplied database", async () => {
    const fake = fakePostgrest({}, {});
    const db = fake.client as {
      rpc: (n: string, a: Record<string, unknown>) => PromiseLike<{
        error: { code?: string } | null;
      }>;
    };
    const { error } = await db.rpc("nope", {});
    expect(error?.code).toBe("PGRST202");
  });

  it("resets the response shape between statements", async () => {
    // Without the reset, a second read inherits the first's limit and a clip
    // case passes by luck.
    const fake = fakePostgrest({ a: rows(2_000), b: rows(5) });
    const db = fake.client as {
      from: (t: string) => {
        select: (c: string) => {
          limit: (n: number) => PromiseLike<{ data: Row[] | null }>;
        } & PromiseLike<{ data: Row[] | null }>;
      };
    };
    await db.from("a").select("id").limit(3);
    const { data } = await db.from("b").select("id");
    expect(data).toHaveLength(5);
  });
});
