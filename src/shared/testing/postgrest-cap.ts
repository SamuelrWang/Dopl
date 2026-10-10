/**
 * A TINY POSTGREST THAT ACTUALLY CLIPS — the shared harness for the `max_rows`
 * sweep (Samuel #2935).
 *
 * ⚠ **IT APPLIES THE CEILING RATHER THAN RECORDING IT** (INVARIANTS §14, and the
 * discipline `home/server/_fake-credit-db.ts` set for the first of these fixes):
 * a chainable recorder proves a query was WRITTEN and can never prove a total is
 * EXACT, because nothing in it ever drops a row. The silent clip IS the finding,
 * so the fake has to perform it.
 *
 * ⚠ **ONE HARNESS, FIVE FEATURES, AND THAT IS WHY IT IS IN `shared/testing/`.**
 * The sweep found the identical bug in `workspaces`, `channels`, `analytics` and
 * `ontology`. §2 forbids one feature importing another's test helper, so the
 * alternative was four more bespoke fakes — four more places for the ceiling to
 * be hardcoded, and four chances for one of them to quietly stop clipping.
 * ⚠ `home/server/_fake-credit-db.ts` is DELIBERATELY left alone: it also fakes
 * the `home_credit_usage_bins` aggregate and its wallet fence, which is
 * feature-specific behaviour this generic table fake must not grow.
 *
 * ⚠ **WHAT IT DOES NOT INTERPRET, ON PURPOSE:** `.or()`, `.not()` and `.like()`
 * are RECORDED, never parsed. A fake that parsed a PostgREST filter string would
 * be asserting its own parser; those clauses are pinned as TEXT by the suites
 * that care, exactly as `_fake-credit-db.ts` pins the wallet arms.
 *
 * ⚠ **`count` IS EXACT AND UNCLIPPED, BECAUSE THE REAL SERVER'S IS.** `max_rows`
 * bounds the ROWS in a response body and not the `Content-Range` total — which
 * is precisely why a counted read is the sanctioned shape and a hauled-and-folded
 * one is not. A fake that clipped the count too would hide that difference and
 * make the wrong fix look right.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** ⚠ THE REAL CEILING, READ FROM THE REAL FILE. A literal `1000` here would keep
 *  passing the day somebody moved the config — the "fix" this sweep forbids. */
export const MAX_ROWS = (() => {
  const toml = readFileSync(
    join(process.cwd(), "supabase", "config.toml"),
    "utf8"
  );
  const match = /^\s*max_rows\s*=\s*(\d+)\s*$/m.exec(toml);
  if (!match) throw new Error("supabase/config.toml no longer states max_rows");
  return Number(match[1]);
})();

export type Row = Record<string, unknown>;
export type Call = { op: string; args: unknown[] };

/** Rows per table name. A table absent from the map reads as empty, not as an error. */
export type FakeTables = Record<string, readonly Row[]>;

export interface FakeOptions {
  /**
   * `rpc(name, args)` → the response. Return `undefined` to answer as a database
   * where that function has not been applied (`PGRST202`), which is the degrade
   * path every aggregate in this sweep must still satisfy.
   */
  rpc?: (
    name: string,
    args: Record<string, unknown>
  ) => { data: unknown; error: unknown } | undefined;
}

export interface FakePostgrest {
  /** Every chained call, in order — for pinning the clauses the fake won't parse. */
  calls: Call[];
  /** Pass to `vi.mocked(supabaseAdmin).mockReturnValue(client as never)`. */
  client: unknown;
  /** How many table selects were resolved — a page loop's cost, asserted. */
  pageReads: () => number;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

/**
 * Build the fake. Chainable filters NARROW `selected`; `order`/`limit`/`range`
 * set the response shape; awaiting resolves it through the ceiling.
 */
export function fakePostgrest(
  tables: FakeTables,
  opts: FakeOptions = {}
): FakePostgrest {
  const calls: Call[] = [];
  let reads = 0;
  const builder: Record<string, unknown> = {};

  let selected: Row[] = [];
  let limit = Number.POSITIVE_INFINITY;
  let orderBy: Array<{ column: string; ascending: boolean }> = [];
  let rangeFrom = 0;
  let rangeSize = Number.POSITIVE_INFINITY;
  let headOnly = false;

  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };

  const keep = (op: string, args: unknown[], pred: (r: Row) => boolean) => {
    selected = selected.filter(pred);
    return rec(op, args);
  };

  Object.assign(builder, {
    from: (table: string) => {
      // ⚠ A new statement resets the shape. Without this a second read in one
      // test inherits the first one's `limit` and the clip case passes by luck.
      limit = Number.POSITIVE_INFINITY;
      orderBy = [];
      rangeFrom = 0;
      rangeSize = Number.POSITIVE_INFINITY;
      headOnly = false;
      selected = [...(tables[table] ?? [])];
      return rec("from", [table]);
    },
    select: (cols?: string, o?: { count?: string; head?: boolean }) => {
      headOnly = o?.head === true;
      return rec("select", [cols, o]);
    },
    eq: (c: string, v: unknown) => keep("eq", [c, v], (r) => r[c] === v),
    neq: (c: string, v: unknown) => keep("neq", [c, v], (r) => r[c] !== v),
    is: (c: string, v: unknown) => keep("is", [c, v], (r) => r[c] === v),
    in: (c: string, v: readonly unknown[]) => {
      const set = new Set(v);
      return keep("in", [c, v], (r) => set.has(r[c]));
    },
    gt: (c: string, v: unknown) => keep("gt", [c, v], (r) => compare(r[c], v) > 0),
    gte: (c: string, v: unknown) =>
      keep("gte", [c, v], (r) => compare(r[c], v) >= 0),
    lt: (c: string, v: unknown) => keep("lt", [c, v], (r) => compare(r[c], v) < 0),
    lte: (c: string, v: unknown) =>
      keep("lte", [c, v], (r) => compare(r[c], v) <= 0),
    // ⚠ RECORDED, NOT INTERPRETED — see the header.
    or: (f: string) => rec("or", [f]),
    like: (c: string, p: string) => rec("like", [c, p]),
    not: (c: string, op: string, v: unknown) => rec("not", [c, op, v]),
    order: (c: string, o?: { ascending?: boolean }) => {
      orderBy = [...orderBy, { column: c, ascending: o?.ascending !== false }];
      return rec("order", [c, o]);
    },
    limit: (n: number) => {
      limit = n;
      return rec("limit", [n]);
    },
    /** ⚠ INCLUSIVE both ends, as PostgREST's `Range` header is. */
    range: (from: number, to: number) => {
      rangeFrom = from;
      rangeSize = to - from + 1;
      return rec("range", [from, to]);
    },
    then: (resolve: (r: unknown) => void) => {
      reads += 1;
      const ordered = [...selected];
      // ⚠ Applied RIGHT-TO-LEFT so the FIRST `.order()` is the primary key —
      // `sort` is stable, so the last comparison applied wins the outer ordering.
      for (const { column, ascending } of [...orderBy].reverse()) {
        ordered.sort((a, b) =>
          ascending ? compare(a[column], b[column]) : compare(b[column], a[column])
        );
      }
      // ⚠ **THE COUNT IS THE WHOLE SET** — see the header. A head read carries no
      // rows at all, which is what makes it immune to this bug.
      const count = ordered.length;
      if (headOnly) return resolve({ data: null, count, error: null });
      // ⚠ **THE CLIP, AND IT IS SILENT** — no error, no marker, just fewer rows.
      // The server's ceiling wins over whatever the caller asked for, and it
      // bounds the RANGE WINDOW too: a `.range(0, 19999)` comes back with 1,000.
      const window = Math.min(rangeSize, limit, MAX_ROWS);
      return resolve({
        data: ordered.slice(rangeFrom, rangeFrom + window),
        count,
        error: null,
      });
    },
  });

  const client = {
    ...builder,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ op: "rpc", args: [name, args] });
      const answered = opts.rpc?.(name, args);
      if (!answered) {
        // ⚠ The un-applied database. Every aggregate in this sweep degrades on
        // this code rather than throwing, because the migration ships unapplied.
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: `function ${name} does not exist` },
        });
      }
      return Promise.resolve(answered);
    },
  };

  return { calls, client, pageReads: () => reads };
}
