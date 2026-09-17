/**
 * A TINY IN-MEMORY POSTGREST — enough of the builder for the search
 * repositories, and it APPLIES the filters rather than recording them.
 *
 * ⚠ **THAT IS THE WHOLE POINT, AND IT IS INVARIANTS §14's RULE APPLIED.** A
 * chainable recorder (`channels/server/repository-account.test.ts`'s shape)
 * proves a `WHERE` was WRITTEN; it cannot prove a non-member gets nothing,
 * because nothing in it ever excludes a row. The fence tests in this feature
 * have to drive the real service against real rows belonging to somebody else
 * and observe the output, or they assert a comment. The recorder shape is still
 * used beside this, for the queries whose SHAPE is the claim.
 *
 * ⚠ NOT A POSTGRES. It implements the operators these repositories use and
 * throws on anything else, so a repository that grows a new filter fails loudly
 * here instead of being silently unfiltered.
 */

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;

/** Which query reached the fake. Kept so a test can also assert an ABSENCE — a
 *  table nobody touched is the enforcement for the home-scope rule. */
export interface FakeQueryLog {
  table: string;
  filters: string[];
}

function likeToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      // An escaped metacharacter is a LITERAL — this is the half
      // `query-text.ts › escapeLikeLiteral` exists to produce.
      i += 1;
      out += (pattern[i] ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      continue;
    }
    if (ch === "%") out += "[\\s\\S]*";
    else if (ch === "_") out += "[\\s\\S]";
    else out += (ch as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

/** `"quoted,value"` or a bare one, as PostgREST's `.or()` grammar spells it. */
function parseOrValue(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  return raw.slice(1, -1).replace(/\\(.)/g, "$1");
}

/** Split an `.or()` filter into arms WITHOUT splitting inside a quoted value. */
function splitArms(filter: string): string[] {
  const arms: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < filter.length; i += 1) {
    const ch = filter[i] as string;
    if (quoted && ch === "\\") {
      current += ch + (filter[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      arms.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current !== "") arms.push(current);
  return arms;
}

/**
 * ⚠ `search_tsv` IS SYNTHESISED, AND THE SPELLING MIRRORS **BOTH** REAL GENERATED
 * COLUMNS. `knowledge_entries.search_tsv` is `setweight(title,'A') ||
 * setweight(excerpt,'B') || setweight(body,'C')`
 * (`20260501020000_knowledge_fulltext.sql`); `channel_messages.search_tsv` is
 * `to_tsvector('simple', coalesce(body, ''))`
 * (`20261007120000_search_fulltext_indexes.sql`, applied 2026-09-17). Joining
 * whichever of the three a row HAS answers both — a message row carries only
 * `body`, so it reduces to the body on its own.
 * ⚠ Weights do not matter to a containment test; the SOURCE COLUMNS do, because a
 * repository that searched `search_tsv` expecting the body alone would pass a
 * fake that only held the body.
 */
function textOf(row: FakeRow, column: string): string {
  if (column === "search_tsv") {
    return [row.title, row.excerpt, row.body]
      .filter((v) => typeof v === "string")
      .join(" ");
  }
  const value = row[column];
  return typeof value === "string" ? value : "";
}

/** `websearch_to_tsquery('simple', q)` reduced to "every bare term appears as a
 *  whole word". Quoted phrases and `-negation` are not modelled; no repository
 *  here depends on them and pretending otherwise would be the lying kind of
 *  fake. */
function matchesTsQuery(haystack: string, query: string): boolean {
  const words = new Set(haystack.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) return false;
  return terms.every((t) => words.has(t));
}

type Predicate = (row: FakeRow) => boolean;

class FakeQuery implements PromiseLike<{ data: FakeRow[]; error: null }> {
  private predicates: Predicate[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private cap = Number.POSITIVE_INFINITY;

  constructor(
    private readonly rows: FakeRow[],
    private readonly log: FakeQueryLog
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.log.filters.push(`eq:${column}`);
    this.predicates.push((r) => r[column] === value);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.log.filters.push(`in:${column}`);
    const set = new Set(values);
    this.predicates.push((r) => set.has(r[column]));
    return this;
  }

  is(column: string, value: null): this {
    this.log.filters.push(`is:${column}`);
    this.predicates.push((r) => (r[column] ?? null) === value);
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.log.filters.push(`ilike:${column}`);
    const re = likeToRegExp(pattern);
    this.predicates.push((r) => re.test(textOf(r, column)));
    return this;
  }

  or(filter: string): this {
    this.log.filters.push(`or:${filter}`);
    const arms = splitArms(filter).map((arm) => {
      const first = arm.indexOf(".");
      const second = arm.indexOf(".", first + 1);
      const column = arm.slice(0, first);
      const op = arm.slice(first + 1, second);
      const value = parseOrValue(arm.slice(second + 1));
      if (op === "eq") return (r: FakeRow) => r[column] === value;
      if (op === "ilike") {
        const re = likeToRegExp(value);
        return (r: FakeRow) => re.test(textOf(r, column));
      }
      throw new Error(`fake-db: unsupported .or() operator "${op}"`);
    });
    this.predicates.push((r) => arms.some((a) => a(r)));
    return this;
  }

  textSearch(column: string, query: string, opts?: { type?: string }): this {
    if (opts?.type !== "websearch") {
      throw new Error("fake-db: only websearch textSearch is modelled");
    }
    this.log.filters.push(`fts:${column}`);
    this.predicates.push((r) => matchesTsQuery(textOf(r, column), query));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.sort = { column, ascending: opts?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this.cap = n;
    return this;
  }

  private run(): FakeRow[] {
    let out = this.rows.filter((r) => this.predicates.every((p) => p(r)));
    if (this.sort) {
      const { column, ascending } = this.sort;
      out = [...out].sort((a, b) => {
        const av = String(a[column] ?? "");
        const bv = String(b[column] ?? "");
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    return out.slice(0, this.cap);
  }

  then<R1 = { data: FakeRow[]; error: null }, R2 = never>(
    onfulfilled?:
      | ((value: { data: FakeRow[]; error: null }) => R1 | PromiseLike<R1>)
      | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): PromiseLike<R1 | R2> {
    return Promise.resolve({ data: this.run(), error: null }).then(
      onfulfilled,
      onrejected
    );
  }
}

/** The `supabaseAdmin()` stand-in, plus the log of every table it was asked for. */
export function fakeDb(tables: FakeTables): {
  client: { from: (table: string) => FakeQuery };
  queries: FakeQueryLog[];
} {
  const queries: FakeQueryLog[] = [];
  return {
    client: {
      from(table: string) {
        const log: FakeQueryLog = { table, filters: [] };
        queries.push(log);
        return new FakeQuery(tables[table] ?? [], log);
      },
    },
    queries,
  };
}
