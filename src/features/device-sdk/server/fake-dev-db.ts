/**
 * TEST FAKE — an in-memory stand-in for `supabaseAdmin()` covering exactly the query shapes
 * `keys.ts` issues against `dev_api_keys` (with the `project:dev_projects!inner(...)` embed).
 * Filters are applied for real, so env isolation and hash lookup are exercised, not assumed.
 * Not a `.test.ts`: suites import it from their `vi.mock` factory.
 */
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;

export const fakeStore = {
  projects: new Map<string, { id: string; org_id: string; api_version: string }>(),
  keys: [] as Row[],
  updates: [] as Array<{ table: string; patch: Row; filters: Array<[string, unknown]> }>,
  /** Make the next insert fail the way PostgREST does (`{ data: null, error }`). */
  failNextInsert: false,
};

export function resetFakeStore(): void {
  fakeStore.projects.clear();
  fakeStore.keys = [];
  fakeStore.updates = [];
  fakeStore.failNextInsert = false;
}

type Result = { data: unknown; error: { message: string } | null };

class Query implements PromiseLike<Result> {
  private filters: Array<[string, unknown]> = [];
  private op: "select" | "insert" | "update" = "select";
  private payload: Row = {};
  private embedProject = false;
  private mode: "many" | "single" | "maybeSingle" = "many";
  private columns: string[] | null = null;

  constructor(private readonly table: string) {
    if (table !== "dev_api_keys") throw new Error(`fake-dev-db: unexpected table ${table}`);
  }

  select(columns?: string) {
    if (columns?.includes("project:dev_projects")) this.embedProject = true;
    // Honour the projection, so a column the code does not select cannot leak out of the fake.
    if (columns) this.columns = columns.split(",").map((c) => c.trim()).filter((c) => /^\w+$/.test(c));
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([c, v]) => (row[c] ?? null) === v);
  }

  private run(): Result {
    let rows: Row[];
    if (this.op === "insert" && fakeStore.failNextInsert) {
      fakeStore.failNextInsert = false;
      return { data: null, error: { message: "fake insert failure" } };
    }
    if (this.op === "insert") {
      const row: Row = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        last_used_at: null,
        revoked_at: null,
        expires_at: null,
        ...this.payload,
      };
      fakeStore.keys.push(row);
      rows = [row];
    } else if (this.op === "update") {
      fakeStore.updates.push({ table: this.table, patch: this.payload, filters: [...this.filters] });
      rows = fakeStore.keys.filter((r) => this.matches(r));
      for (const r of rows) Object.assign(r, this.payload);
    } else {
      rows = fakeStore.keys.filter((r) => this.matches(r));
    }
    const pick = (r: Row): Row =>
      this.columns ? Object.fromEntries(this.columns.map((c) => [c, r[c] ?? null])) : { ...r };
    const shaped = rows.map((r) =>
      this.embedProject ? { ...pick(r), project: fakeStore.projects.get(r.project_id as string) ?? null } : pick(r)
    );
    // `!inner`: a row whose project is gone is not returned.
    const visible = this.embedProject ? shaped.filter((r) => r.project !== null) : shaped;
    if (this.mode === "many") return { data: visible, error: null };
    return { data: visible[0] ?? null, error: null };
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export const fakeDb = { from: (table: string) => new Query(table) };
