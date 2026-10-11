// ANALYTICS HEALTH — THE PURE SHAPING LAYER, split out 2026-10-11.
//
// WHY THIS FILE EXISTS: `health.ts` crossed the §2 500-line cap (523) when the release review's
// unreadable-haul fix landed, and that cap is `error` with no exemptions on `src/**`. The file
// was ALREADY 499 lines before that fix, so there was no size the fix could have been written at
// — a split was the only resolution, and this is the seam the module already had.
//
// WHAT IS HERE: everything that turns ROWS into GROUPS, plus the two degrade helpers. All of it
// is pure — no Supabase client, no paged read, no RPC — which is also why it is the half worth
// unit-testing directly. `health.ts` keeps the READS: the three `get*` functions that choose
// between an aggregate RPC and a degrade haul, and `computeOverallStatus`.
//
// ⚠ THE ONLY RUNTIME EDGE IS health.ts → HERE. The two result interfaces stay on `health.ts` as
// their module of record and come back as an `import type`, which is ERASED at compile time, so
// the back edge does not exist at runtime and there is no cycle to reason about.
//
// ⚠ `health.ts` RE-EXPORTS `groupAlerts`, `routeOf` and `tallyRoutes`, so no importer moved:
// `health.test.ts` imports them from `health.ts`, and `_fake-health-db.ts`'s SQL-vs-TS drift
// argument cites `health.ts › routeOf` by that path specifically.

import type { Clipped } from "@/shared/supabase/max-rows";
import type { AlertGroup, RouteErrorGroup } from "./health";

/** Postgres/PostgREST codes for "that function is not there" — the migration is
 *  not applied yet. ⚠ Expected: the degrade is the live path until it lands.
 *  Moved here with `degrading`, its only reader. */
const RPC_MISSING_CODES = new Set(["PGRST202", "42883"]);

/** 🔒 THE SEVERITY LADDER, IN ONE PLACE — the SQL rolls the same ranks up with
 *  `max()`; a third copy of this mapping is how the two paths drift. */
export const SEVERITY_RANK = { info: 0, warn: 1, error: 2, critical: 3 } as const;
export type Severity = keyof typeof SEVERITY_RANK;

/** ⚠ `bigint` crosses the PostgREST wire as a STRING. */
export function num(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

/** ⚠ Never silent: a dashboard folded over 1,000 of 50,000 rows looks calm. */
export function degrading(fn: string, error: { code?: string; message?: string }): void {
  const why = RPC_MISSING_CODES.has(error.code ?? "")
    ? "absent"
    : `unusable (${error.code ?? "?"})`;
  console.warn(
    `[admin/health] ${fn} ${why}, degrading to the clipped haul — numbers will be reported as floors: ${error.message ?? ""}`
  );
}

/**
 * 🔒 **THE DEGRADE'S OWN DEGRADE: NO ROWS, AND `truncated: true` SO NOTHING CALLS
 * IT AN ALL-CLEAR.** Both hauls destructured `{ data }` alone, so a `42501`, a
 * timeout or an RLS change answered `data: null` and fell through to
 * `rows: [], truncated: false` — read by {@link computeOverallStatus} as a green
 * "All clear in the last 24h" over a table it could not open, on the path that is
 * LIVE until the aggregates land. ⚠ `truncated` is honest, not a stretch:
 * {@link OverallStatus} already means "nothing in the sample". ⚠ No throw — that
 * blanks the fan ({@link getMcpHealth} records the trade). ⚠ LOGGED.
 */
export function unreadableHaul<T>(panel: string, error: { code?: string; message?: string }): Clipped<T> {
  console.warn(
    `[admin/health] ${panel} haul unreadable (${error.code ?? "?"}), reporting NO rows and truncated: ${error.message ?? ""}`
  );
  return { rows: [], truncated: true };
}

export interface AlertEventRow {
  fingerprint: string;
  severity: string;
  category: string;
  source: string;
  message: string;
  created_at: string;
}

/** ⚠ {@link AlertGroup} as it crosses the wire: `bigint` arrives as a STRING. */
export type AlertGroupRpcRow = Omit<AlertGroup, "count" | "severity"> & {
  severity: string;
  event_count: number | string;
};

/**
 * The JS group-by, kept as the degrade. ⚠ **Rows MUST arrive newest-first**:
 * `category`, `source` and `sample_message` come from each group's first row and
 * are never revised, which is only "the newest row's" under that order — the RPC
 * states it as `ORDER BY created_at DESC` inside the aggregate.
 */
export function groupAlerts(rows: AlertEventRow[]): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();
  for (const row of rows) {
    const existing = groups.get(row.fingerprint);
    if (!existing) {
      groups.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        severity: row.severity as Severity,
        category: row.category,
        source: row.source,
        sample_message: row.message,
        count: 1,
        first_seen: row.created_at,
        last_seen: row.created_at,
      });
      continue;
    }
    existing.count += 1;
    if (row.created_at > existing.last_seen) {
      existing.last_seen = row.created_at;
      existing.sample_message = row.message;
    }
    if (row.created_at < existing.first_seen) {
      existing.first_seen = row.created_at;
    }
    const rank = SEVERITY_RANK[row.severity as Severity] ?? 0;
    if (rank > SEVERITY_RANK[existing.severity]) {
      existing.severity = row.severity as Severity;
    }
  }
  return sortAlertGroups(Array.from(groups.values()));
}

/**
 * Worst severity first, then most recent. ⚠ **`fingerprint` is the final
 * tie-break and it is load-bearing for parity**: without it, groups sharing a
 * severity and a `last_seen` come back in Map-insertion order here and in
 * physical order from Postgres — a different list from identical data.
 */
export function sortAlertGroups(groups: AlertGroup[]): AlertGroup[] {
  return groups.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.last_seen.localeCompare(a.last_seen) ||
      a.fingerprint.localeCompare(b.fingerprint)
  );
}


export interface RouteEventRow {
  source: string | null;
  severity: string;
  message: string;
  created_at: string;
}

/** ⚠ {@link RouteErrorGroup} on the wire: the counts arrive as STRINGS. */
export type RouteErrorRpcRow = Pick<
  RouteErrorGroup,
  "route" | "last_error_message" | "last_error_at"
> &
  Record<"errors_24h" | "criticals_24h", number | string>;

/** Any UUID in a path segment. ⚠ The SQL states this pattern CHARACTER FOR
 *  CHARACTER; the two must agree or the panel groups differently per path. */
export const UUID_IN_PATH =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * 🔒 **THE ROUTE TEMPLATE, AND THE SQL MIRRORS IT EXACTLY.** `source` is an HTTP
 * route string (`POST /api/channels/<uuid>/await`) and the ids in it are the
 * noise: measured 2026-10-10, 30 days of errors key as **35 raw sources but only
 * 15 templates**, because thirteen of the top twenty were the same
 * `/channels/:id/await` route under different channel ids. Grouping on the raw
 * string makes a handful of real failures read as thirty-five one-off blips.
 * ⚠ A null or EMPTY source is `unknown`, as the old key did.
 */
export function routeOf(source: string | null | undefined): string {
  return (source || "unknown").replace(UUID_IN_PATH, ":id");
}

/** The JS roll-up, kept as the degrade. ⚠ Newest-first in, as {@link groupAlerts}. */
export function tallyRoutes(rows: RouteEventRow[]): RouteErrorGroup[] {
  const byRoute = new Map<string, RouteErrorGroup>();
  for (const row of rows) {
    const route = routeOf(row.source);
    let entry = byRoute.get(route);
    if (!entry) {
      entry = {
        route,
        errors_24h: 0,
        criticals_24h: 0,
        last_error_message: null,
        last_error_at: null,
      };
      byRoute.set(route, entry);
    }
    // ⚠ Every row reaching here is already `error` or `critical` — the read
    // filters on severity, so there is no third arm to count separately. A
    // `critical` is counted in BOTH columns, as the old roll-up did.
    entry.errors_24h += 1;
    if (row.severity === "critical") entry.criticals_24h += 1;
    if (!entry.last_error_at || row.created_at > entry.last_error_at) {
      entry.last_error_at = row.created_at;
      entry.last_error_message = row.message;
    }
  }
  return sortRoutes(Array.from(byRoute.values()));
}

/** ⚠ `route` is the final tie-break for the same parity reason as {@link sortAlertGroups}. */
export function sortRoutes(rows: RouteErrorGroup[]): RouteErrorGroup[] {
  return rows.sort(
    (a, b) =>
      b.criticals_24h - a.criticals_24h ||
      b.errors_24h - a.errors_24h ||
      a.route.localeCompare(b.route)
  );
}
