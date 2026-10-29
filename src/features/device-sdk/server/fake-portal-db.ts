/**
 * TEST FAKE — an in-memory stand-in for `supabaseAdmin()` covering the query shapes the portal's
 * self-serve writes (`portal-admin.ts`) and reads (`portal.ts`, `keys.ts › mint/revoke`) issue.
 * Filters, inserts, updates and deletes are applied for real, and the constraints that guard a
 * race (unique keys, the one-open-invite partial index) are enforced, so a claim that loses
 * actually loses. `auth.admin.getUserById` reads `fakePortal.users`.
 * Not a `.test.ts`: suites import it from their `vi.mock` factory.
 */
import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string };
type Result = { data: unknown; error: DbError | null; count?: number | null };

export const fakePortal = {
  tables: new Map<string, Row[]>(),
  users: new Map<string, { id: string; email: string | null; email_confirmed_at: string | null }>(),
  /** Table names whose next insert fails the way PostgREST does. */
  failNextInsert: new Set<string>(),
};

/** Unique keys enforced on insert/upsert. `where` = partial index predicate. */
const UNIQUE: Record<string, Array<{ name: string; cols: string[]; where?: (r: Row) => boolean }>> = {
  dev_org_members: [{ name: "dev_org_members_pkey", cols: ["org_id", "user_id"] }],
  dev_api_keys: [{ name: "dev_api_keys_key_hash_key", cols: ["key_hash"] }],
  dev_org_invites: [
    { name: "dev_org_invites_token_hash_key", cols: ["token_hash"] },
    {
      name: "dev_org_invites_one_open_per_email",
      cols: ["org_id", "email"],
      where: (r) => r.accepted_at == null && r.revoked_at == null,
    },
  ],
};

const DEFAULTS: Record<string, () => Row> = {
  dev_orgs: () => ({ internal: false }),
  dev_projects: () => ({ api_version: "2026-10-27", branding: {} }),
  dev_org_members: () => ({ role: "developer" }),
  dev_api_keys: () => ({ last_used_at: null, revoked_at: null, expires_at: null }),
  dev_org_invites: () => ({ accepted_at: null, accepted_by: null, revoked_at: null }),
};

export function resetFakePortal(): void {
  fakePortal.tables.clear();
  fakePortal.users.clear();
  fakePortal.failNextInsert.clear();
}

export function rows(table: string): Row[] {
  let t = fakePortal.tables.get(table);
  if (!t) {
    t = [];
    fakePortal.tables.set(table, t);
  }
  return t;
}

/** Seed a row (defaults + id + created_at filled in). Returns it. */
export function seed(table: string, row: Row): Row {
  const full = withDefaults(table, row);
  rows(table).push(full);
  return full;
}

let clock = 0;
function withDefaults(table: string, row: Row): Row {
  // Strictly increasing created_at so "newest first" orders are deterministic.
  clock += 1;
  const created = new Date(Date.UTC(2026, 9, 1) + clock * 1000).toISOString();
  const base: Row = { created_at: created, ...(DEFAULTS[table]?.() ?? {}) };
  if (table !== "dev_org_members") base.id = randomUUID();
  return { ...base, ...row };
}

function violates(table: string, candidate: Row, ignore?: Row): string | null {
  for (const u of UNIQUE[table] ?? []) {
    if (u.where && !u.where(candidate)) continue;
    const clash = rows(table).some(
      (r) => r !== ignore && (!u.where || u.where(r)) && u.cols.every((c) => r[c] === candidate[c])
    );
    if (clash) return u.name;
  }
  return null;
}

type Filter = (r: Row) => boolean;

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | Row[] = {};
  private onConflict: string[] = [];
  private returning = false;
  private columns: string[] | null = null;
  private countMode = false;
  private head = false;
  private mode: "many" | "single" | "maybeSingle" = "many";
  private orders: Array<[string, boolean]> = [];
  private max: number | null = null;

  constructor(private readonly table: string) {}

  select(columns?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") this.returning = true;
    if (columns && columns !== "*") this.columns = columns.split(",").map((c) => c.trim());
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = row;
    this.onConflict = (opts?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val));
    return this;
  }
  gt(col: string, val: string) {
    this.filters.push((r) => typeof r[col] === "string" && Date.parse(r[col] as string) > Date.parse(val));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push([col, opts?.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.max = n;
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

  private project(r: Row): Row {
    if (!this.columns) return { ...r };
    const out: Row = {};
    for (const c of this.columns) out[c] = r[c];
    return out;
  }

  private shape(list: Row[], count?: number): Result {
    const data = list.map((r) => this.project(r));
    if (this.mode === "many") return { data: this.head ? null : data, error: null, count: this.countMode ? (count ?? list.length) : null };
    if (data.length > 1) return { data: null, error: { message: "multiple rows" } };
    if (data.length === 0) {
      return this.mode === "single" ? { data: null, error: { message: "no rows", code: "PGRST116" } } : { data: null, error: null };
    }
    return { data: data[0], error: null };
  }

  private run(): Result {
    const t = rows(this.table);
    const match = (r: Row) => this.filters.every((f) => f(r));
    if (this.op === "select") {
      let list = t.filter(match);
      for (const [col, asc] of [...this.orders].reverse()) {
        list = [...list].sort((a, b) => {
          const x = String(a[col] ?? "");
          const y = String(b[col] ?? "");
          return asc ? x.localeCompare(y) : y.localeCompare(x);
        });
      }
      const count = list.length;
      if (this.max !== null) list = list.slice(0, this.max);
      return this.shape(list, count);
    }
    if (this.op === "insert" || this.op === "upsert") {
      if (fakePortal.failNextInsert.has(this.table)) {
        fakePortal.failNextInsert.delete(this.table);
        return { data: null, error: { message: "insert failed (fake)" } };
      }
      const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => withDefaults(this.table, r));
      const written: Row[] = [];
      for (const r of incoming) {
        if (this.op === "upsert" && this.onConflict.length > 0) {
          const existing = t.find((x) => this.onConflict.every((c) => x[c] === r[c]));
          if (existing) {
            const { created_at: _c, ...patch } = r;
            void _c;
            Object.assign(existing, patch);
            written.push(existing);
            continue;
          }
        }
        const clash = violates(this.table, r);
        if (clash) return { data: null, error: { message: `duplicate key value violates unique constraint "${clash}"`, code: "23505" } };
        t.push(r);
        written.push(r);
      }
      return this.returning ? this.shape(written) : { data: null, error: null };
    }
    if (this.op === "update") {
      const hit = t.filter(match);
      for (const r of hit) {
        const next = { ...r, ...(this.payload as Row) };
        const clash = violates(this.table, next, r);
        if (clash) return { data: null, error: { message: `duplicate key value violates unique constraint "${clash}"`, code: "23505" } };
      }
      for (const r of hit) Object.assign(r, this.payload as Row);
      return this.returning ? this.shape(hit) : { data: null, error: null };
    }
    const keep = t.filter((r) => !match(r));
    const gone = t.filter(match);
    fakePortal.tables.set(this.table, keep);
    return this.returning ? this.shape(gone) : { data: null, error: null };
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export const fakePortalDb = {
  from: (table: string) => new Query(table),
  auth: {
    admin: {
      getUserById: async (id: string) => {
        const u = fakePortal.users.get(id);
        return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "User not found" } };
      },
    },
  },
};
