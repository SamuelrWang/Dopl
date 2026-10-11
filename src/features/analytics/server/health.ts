import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { clippedAt, effectiveCeiling, type Clipped } from "@/shared/supabase/max-rows";
import { MCP_CALL_ROWS } from "./mcp-tool-calls";

/**
 * Admin health aggregation. All queries run on-demand at /admin/health — no
 * cron, no stored alert state; everything derives from raw `system_events` and
 * `mcp_tool_calls`. Thresholds live in code.
 *
 * ⚠ **`mcp_events` IS NO LONGER READ HERE** — it has had no writer since
 * 2026-07-17, so the MCP panel reported zeros for three months. The table is
 * left in place (its drop is a db-cleanup task); see {@link McpHealth}.
 *
 * 🔒 **ALL THREE READS WERE GROUP-BYs RUN IN JS OVER A SILENTLY CLIPPED SET
 * (Samuel #2935, the `max_rows` sweep).** `shared/supabase/max-rows.ts ›
 * POSTGREST_MAX_ROWS` is the ceiling PostgREST applies server-side whether or
 * not we ask for one, raising nothing — so a `.limit(5000)` is not a bound, it
 * is a request the server declines. This file was the worst-documented case in
 * the sweep: it carried NO clip marker at all, so the dashboard printed counts,
 * error totals and a `p95 latency` computed over at most 1,000 rows **as if they
 * were exact**, under a green "All clear in the last 24h".
 *
 * ⚠ **THE FIX IS AN AGGREGATE IN SQL, PER READ** — each of the three is a pure
 * group-by, so Postgres returns one row per GROUP and the ceiling lands two
 * orders of magnitude from the data. Not a bigger `max_rows` (moves the number,
 * keeps the silence) and not a page loop (hauls the same rows to do arithmetic
 * Postgres does once).
 *
 * ⚠ **EVERY JS GROUPER BELOW STAYS, AS THE DEGRADE PATH.** The migration ships
 * unapplied (this repo's standing gate), so **the degrade is the LIVE path
 * today** — which is why the honest marker matters at least as much as the RPC:
 * every shape here now carries `truncated`, and {@link computeOverallStatus}
 * refuses to call a clipped read an all-clear.
 */

export interface AlertGroup {
  fingerprint: string;
  severity: "info" | "warn" | "error" | "critical";
  category: string;
  source: string;
  sample_message: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

/**
 * SERVER ERRORS, GROUPED BY ROUTE TEMPLATE — renamed 2026-10-10, because this is
 * what the data actually is.
 *
 * 🔒 **IT WAS `ExternalApiHealth`, KEYED ON A PROVIDER, AND BLANK IN PROD FOR
 * TWO INDEPENDENT REASONS.** It filtered
 * `category IN ('external_api','quota','auth','perf')` — **zero rows in 30 days,
 * measured** — and keyed on a leading dotted segment, documented as
 * `anthropic.messages`, while the logger writes HTTP routes like
 * `POST /api/channels/sessions`. ⚠ **NOTHING HERE LOGS A PROVIDER TODAY**; that
 * instrumentation is separate work, and naming a panel after data that does not
 * exist is what kept the gap invisible.
 */
export interface RouteErrorGroup {
  /** The route TEMPLATE — ids normalised out. See {@link routeOf}. */
  route: string;
  errors_24h: number;
  criticals_24h: number;
  last_error_message: string | null;
  last_error_at: string | null;
}

/**
 * MCP CALL VOLUME, last 24h. **One number, and that is the honest ceiling of
 * what any live table can back.**
 *
 * 🔒 **IT CARRIED FOUR NUMBERS AND THREE WERE DELETED ON 2026-10-10.**
 * `errors_24h`, `error_rate` and `p95_latency_ms` came off `mcp_events`
 * (`response_status`, `latency_ms`), and that table has had **no writer since
 * 2026-07-17** — 170 rows, nothing in any 24h window since, so this panel
 * reported zeros for three months. The live table cannot back them:
 * `mcp_tool_calls` is `(workspace_id, user_id, tool, op, is_write, created_at)`,
 * no status, no latency, no error, and `system_events` carries no MCP-tagged
 * error either. So they are DELETED rather than derived from something that does
 * not measure them (Samuel, 2026-10-10: "don't fake").
 * ⚠ **NO `truncated`**: a COUNTED read has no row to clip — see
 * {@link getMcpHealth}.
 */
export interface McpHealth {
  calls_24h: number;
}

export interface OverallStatus {
  level: "green" | "yellow" | "red";
  reason: string;
  /** Any input read was clipped, so `green` is "nothing in the sample", not "nothing". */
  truncated: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The ask on the two remaining hauls. ⚠ **NOT the bound** — {@link clippedAt}
 *  measures `min(this, POSTGREST_MAX_ROWS)`: `1000 >= 5000` is false, so
 *  comparing against this alone is how a floor reports itself complete. */
const EVENT_SCAN_LIMIT = 5_000;

/* ⚠ The `mcp_events` haul and its 10,000-row ask are GONE, not fixed: that
   table has no writer (see {@link McpHealth}). `getMcpHealth` counts instead. */

/** Postgres/PostgREST codes for "that function is not there" — the migration is
 *  not applied yet. ⚠ Expected: the degrade is the live path until it lands. */
const RPC_MISSING_CODES = new Set(["PGRST202", "42883"]);

/** 🔒 THE SEVERITY LADDER, IN ONE PLACE — the SQL rolls the same ranks up with
 *  `max()`; a third copy of this mapping is how the two paths drift. */
const SEVERITY_RANK = { info: 0, warn: 1, error: 2, critical: 3 } as const;
type Severity = keyof typeof SEVERITY_RANK;

const WARN_AND_ABOVE: Severity[] = ["warn", "error", "critical"];
const ALL_SEVERITIES: Severity[] = ["info", "warn", "error", "critical"];

/**
 * The severities this panel is NAMED after.
 *
 * 🔒 **IT FILTERS ON SEVERITY AND DELIBERATELY NOT ON `category`.** The panel it
 * replaces filtered four categories holding zero rows; today every error the
 * logger writes lands in `category = 'other'` (426 rows / 30 days, measured).
 * Pinning to `'other'` would be correct today and blank again the moment someone
 * categorises properly — **a category filter is the exact fragility that made
 * the old panel blank, so this read has none.** "Server errors" is a claim about
 * severity.
 */
const ERROR_SEVERITIES: Severity[] = ["error", "critical"];

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

/** ⚠ `bigint` crosses the PostgREST wire as a STRING. */
function num(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

/** ⚠ Never silent: a dashboard folded over 1,000 of 50,000 rows looks calm. */
function degrading(fn: string, error: { code?: string; message?: string }): void {
  const why = RPC_MISSING_CODES.has(error.code ?? "")
    ? "absent"
    : `unusable (${error.code ?? "?"})`;
  console.warn(
    `[admin/health] ${fn} ${why}, degrading to the clipped haul — numbers will be reported as floors: ${error.message ?? ""}`
  );
}

/* ---------------------------- recent alerts ---------------------------- */

/**
 * system_events GROUPED BY fingerprint — count, first/last seen, the worst
 * severity seen and the NEWEST row's message. Severities >= warn unless
 * `includeInfo`.
 *
 * 🔒 **`×N` WAS THE LIE WITH THE SHARPEST EDGE.** The old read hauled
 * {@link EVENT_SCAN_LIMIT} rows newest-first and counted them here, so the card
 * read `×1,000`-ish for the loudest fingerprint and `×1` for everything older
 * than the clip — and `first_seen` was not the first sighting, it was the oldest
 * row that survived.
 *
 * ⚠ **THE RPC's `p_limit` IS A TOP-N ON THE GROUP LIST, NOT A CLIP ON THE
 * COUNTS**, which is why the RPC path reports `truncated: false`: Postgres
 * counts every event in the window and the 50 rendered are the 50 worst. The
 * degrade cannot say that, so it reports the haul's own clip.
 */
export async function getRecentAlerts(opts?: {
  sinceMs?: number;
  includeInfo?: boolean;
  limit?: number;
}): Promise<Clipped<AlertGroup>> {
  const since = iso(opts?.sinceMs ?? DAY_MS);
  const limit = opts?.limit ?? 50;
  const severities = opts?.includeInfo ? ALL_SEVERITIES : WARN_AND_ABOVE;
  const db = supabaseAdmin();

  const { data: grouped, error } = await db.rpc("analytics_recent_alert_groups", {
    p_since: since,
    // ⚠ Clamped so the RPC's OWN response can never be clipped: a top-N asking
    // for more than the server returns comes back short and reads as exact.
    p_limit: effectiveCeiling(limit),
    p_severities: severities,
  });

  if (!error) {
    const rows = ((grouped ?? []) as AlertGroupRpcRow[]).map((r) => ({
      fingerprint: r.fingerprint,
      severity: r.severity as Severity,
      category: r.category,
      source: r.source,
      sample_message: r.sample_message,
      count: num(r.event_count),
      first_seen: r.first_seen,
      last_seen: r.last_seen,
    }));
    // ⚠ Re-sorted through the SAME comparator the degrade uses — idempotent on
    // an ordered list, and what makes "the two paths agree" testable.
    return { rows: sortAlertGroups(rows), truncated: false };
  }
  degrading("analytics_recent_alert_groups", error);

  const { data } = await db
    .from("system_events")
    .select("fingerprint, severity, category, source, message, created_at")
    .gte("created_at", since)
    .in("severity", severities)
    .order("created_at", { ascending: false })
    .limit(EVENT_SCAN_LIMIT);

  const scan = clippedAt((data ?? []) as AlertEventRow[], EVENT_SCAN_LIMIT);
  return { rows: groupAlerts(scan.rows).slice(0, limit), truncated: scan.truncated };
}

interface AlertEventRow {
  fingerprint: string;
  severity: string;
  category: string;
  source: string;
  message: string;
  created_at: string;
}

/** ⚠ {@link AlertGroup} as it crosses the wire: `bigint` arrives as a STRING. */
type AlertGroupRpcRow = Omit<AlertGroup, "count" | "severity"> & {
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
function sortAlertGroups(groups: AlertGroup[]): AlertGroup[] {
  return groups.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.last_seen.localeCompare(a.last_seen) ||
      a.fingerprint.localeCompare(b.fingerprint)
  );
}

/* ----------------------- server errors by route ------------------------- */

/**
 * SERVER ERRORS PER ROUTE TEMPLATE, last 24h, with the newest error's message —
 * see {@link RouteErrorGroup} for why this replaced a provider panel that could
 * never draw a row.
 */
export async function getServerErrorsByRoute(): Promise<Clipped<RouteErrorGroup>> {
  const since = iso(DAY_MS);
  const db = supabaseAdmin();

  const { data: grouped, error } = await db.rpc("analytics_route_error_groups", {
    p_since: since,
    p_severities: ERROR_SEVERITIES,
  });

  if (!error) {
    const rows = ((grouped ?? []) as RouteErrorRpcRow[]).map((r) => ({
      route: r.route,
      errors_24h: num(r.errors_24h),
      criticals_24h: num(r.criticals_24h),
      last_error_message: r.last_error_message,
      last_error_at: r.last_error_at,
    }));
    return { rows: sortRoutes(rows), truncated: false };
  }
  degrading("analytics_route_error_groups", error);

  const { data } = await db
    .from("system_events")
    .select("source, severity, message, created_at")
    .gte("created_at", since)
    .in("severity", ERROR_SEVERITIES)
    .order("created_at", { ascending: false })
    .limit(EVENT_SCAN_LIMIT);

  const scan = clippedAt((data ?? []) as RouteEventRow[], EVENT_SCAN_LIMIT);
  return { rows: tallyRoutes(scan.rows), truncated: scan.truncated };
}

interface RouteEventRow {
  source: string | null;
  severity: string;
  message: string;
  created_at: string;
}

/** ⚠ {@link RouteErrorGroup} on the wire: the counts arrive as STRINGS. */
type RouteErrorRpcRow = Pick<
  RouteErrorGroup,
  "route" | "last_error_message" | "last_error_at"
> &
  Record<"errors_24h" | "criticals_24h", number | string>;

/** Any UUID in a path segment. ⚠ The SQL states this pattern CHARACTER FOR
 *  CHARACTER; the two must agree or the panel groups differently per path. */
const UUID_IN_PATH =
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
function sortRoutes(rows: RouteErrorGroup[]): RouteErrorGroup[] {
  return rows.sort(
    (a, b) =>
      b.criticals_24h - a.criticals_24h ||
      b.errors_24h - a.errors_24h ||
      a.route.localeCompare(b.route)
  );
}

/* ------------------------------ MCP health ------------------------------ */

/** De Morgan of `NOT (tool = 'channel' AND op LIKE 'await%')` — `dopl_channel`'s
 *  await ops POLL, a row per tick. ⚠ A THIRD copy on purpose: the trade
 *  `home/server/repository-overview.ts › EXCLUDE_AWAIT_POLLING` records, since §2
 *  forbids importing another feature's repository. */
const EXCLUDE_AWAIT_POLLING = "tool.neq.channel,op.not.like.await*";

/**
 * MCP CALL VOLUME, last 24h — **counted, never hauled.**
 *
 * 🔒 **IT WAS THE WORST OF THE THREE AND IS NOW THE SAFEST, BY CHANGING SHAPE
 * RATHER THAN BY GETTING AN AGGREGATE.** The old read asked `mcp_events` for
 * 10,000 rows with **no `ORDER BY` at all**, so `max_rows` cut it to 1,000 rows
 * Postgres could return in ANY permutation and `calls_24h` was `data.length` —
 * not even CONSISTENTLY wrong, which is why it never became a bug report. And it
 * was reading a DEAD TABLE throughout (see {@link McpHealth}).
 *
 * 🔒 **A COUNT NEEDS NO RPC, AND THAT IS THE POINT.** `max_rows` bounds the
 * response BODY, never the `Content-Range` total, so `head: true` with
 * `count: "exact"` is immune to this whole class of bug — the reason
 * `home/server/repository-overview.ts › countMetricInWindow` is the sanctioned
 * shape. **So `analytics_mcp_health` was written for the sweep and then deleted
 * from the migration**: one fewer `SECURITY INVOKER` function to review.
 *
 * ⚠ **IT COUNTS THE LOOPBACK POPULATION, AND THE CHOICE IS MEASURED.**
 * `mcp_tool_calls` holds loopback REQUESTS and the consume route's charged-call
 * tally ({@link MCP_CALL_ROWS} prefix) — 4,094 and 2,266 in the 24h of
 * 2026-10-10, so counting both would nearly double the figure by counting many
 * calls twice. One MCP REQUEST is what `mcp_events` counted, so loopback is the
 * honest continuation. Await-polling is excluded as every other reader excludes it.
 */
export async function getMcpHealth(): Promise<McpHealth> {
  const { count, error } = await supabaseAdmin()
    .from("mcp_tool_calls")
    .select("id", { count: "exact", head: true })
    .gte("created_at", iso(DAY_MS))
    .or(EXCLUDE_AWAIT_POLLING)
    .not("tool", "like", MCP_CALL_ROWS);

  // ⚠ A dead count is 0 and SAYS SO IN THE LOG rather than throwing: this panel
  // sits beside two others and a 500 here would blank the whole page.
  if (error) {
    console.warn(
      `[admin/health] mcp_tool_calls count unreadable, reporting 0: ${error.message}`
    );
    return { calls_24h: 0 };
  }
  return { calls_24h: count ?? 0 };
}

/* ---------------------------- overall status ---------------------------- */

/**
 * The banner's verdict.
 *
 * 🔒 **A CLIP CANNOT INVALIDATE `red`/`yellow`, AND IT ALWAYS INVALIDATES
 * `green`.** Red and yellow rest on a POSITIVE finding — a critical was seen, a
 * rate was exceeded — and reading more rows can only add more of those. Green
 * rests on an ABSENCE, and a read that stopped at 1,000 of the day's events has
 * no evidence of absence at all. So the level stands either way while the REASON
 * stops claiming an all-clear it cannot support.
 */
export function computeOverallStatus(inputs: {
  alerts: Clipped<AlertGroup>;
  routes: Clipped<RouteErrorGroup>;
}): OverallStatus {
  const truncated = inputs.alerts.truncated || inputs.routes.truncated;

  const hasCritical = inputs.alerts.rows.some((a) => a.severity === "critical");
  const routeCritical = inputs.routes.rows.some((r) => r.criticals_24h > 0);

  if (hasCritical || routeCritical) {
    return {
      level: "red",
      reason: hasCritical
        ? "Critical alert active"
        : "A server route is failing critically",
      truncated,
    };
  }

  // 🔒 **THE "ELEVATED MCP ERROR RATE" ARM WAS DELETED, NOT DEFAULTED
  // (2026-10-10).** It read `mcp.error_rate > 0.2`, and nothing live measures an
  // MCP error (see {@link McpHealth}). Keeping the arm against a rate pinned at
  // 0 would be a CHECK THAT CAN NEVER FIRE reading as a check that passes —
  // which is the same defect this sweep deleted from `ontology/server`, where
  // `length >= 5_000` could never be true against a 1,000-row clip. A banner
  // arm with no instrument behind it is worse than an absent arm, because only
  // the absent one is visible.
  const hasErrors = inputs.alerts.rows.some((a) => a.severity === "error");

  if (hasErrors) {
    return { level: "yellow", reason: "Errors logged in last 24h", truncated };
  }

  return {
    level: "green",
    reason: truncated
      ? "Nothing in the rows we could read — the reads were clipped, so this is not an all-clear"
      : "All clear in the last 24h",
    truncated,
  };
}
