/**
 * A tiny in-memory stand-in for the supabase-js query builder, enough for the
 * glasses modules that read other features' tables (`channel-link.ts`,
 * `voice-channel.ts`) to be tested without a database. Supports select, eq, in,
 * gt, `or` over `and(col.eq.v,col.gt.n)` groups, order, limit, maybeSingle, and
 * awaiting the builder for `{data, error}`.
 */
type Row = Record<string, unknown>;

export function fakePostgrest(tables: Record<string, Row[]>) {
  function from(table: string) {
    let rows = [...(tables[table] ?? [])];
    const builder = {
      select: () => builder,
      eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), builder),
      in: (col: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[col]))), builder),
      gt: (col: string, v: number) => ((rows = rows.filter((r) => (r[col] as number) > v)), builder),
      or: (expr: string) => {
        const groups = [...expr.matchAll(/and\(([^)]*)\)/g)].map((m) =>
          m[1].split(",").map((cond) => {
            const [col, op, ...rest] = cond.split(".");
            return { col, op, v: rest.join(".") };
          }),
        );
        const holds = (r: Row, c: { col: string; op: string; v: string }) =>
          c.op === "eq" ? String(r[c.col]) === c.v : c.op === "gt" ? (r[c.col] as number) > Number(c.v) : false;
        rows = rows.filter((r) => groups.some((g) => g.every((c) => holds(r, c))));
        return builder;
      },
      order: (col: string, o: { ascending: boolean }) => {
        const cmp = (x: unknown, y: unknown) => (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y)));
        rows.sort((a, b) => cmp(a[col], b[col]) * (o.ascending ? 1 : -1));
        return builder;
      },
      limit: (n: number) => ((rows = rows.slice(0, n)), builder),
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
    };
    return builder;
  }
  return { from };
}
