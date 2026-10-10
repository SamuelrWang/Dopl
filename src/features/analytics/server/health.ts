import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { clippedAt, effectiveCeiling, type Clipped } from "@/shared/supabase/max-rows";

/**
 * Admin health aggregation. All queries run on-demand at /admin/health — no
 * cron, no stored alert state; everything derives from raw system_events and
 * mcp_events. Thresholds live in code.
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

export interface ExternalApiHealth {
  name: string;
  events_24h: number;
  errors_24h: number;
  criticals_24h: number;
  last_error_message: string | null;
  last_error_at: string | null;
}

export interface McpHealth {
  calls_24h: number;
  errors_24h: number;
  error_rate: number;
  p95_latency_ms: number | null;
  /** ⚠ TRUE = every number above is a FLOOR. See {@link Clipped}. */
  truncated: boolean;
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

/** The ask on the mcp_events haul. Same story — see {@link EVENT_SCAN_LIMIT}. */
const MCP_SCAN_LIMIT = 10_000;

/** Postgres/PostgREST codes for "that function is not there" — the migration is
 *  not applied yet. ⚠ Expected: the degrade is the live path until it lands. */
const RPC_MISSING_CODES = new Set(["PGRST202", "42883"]);

/** 🔒 THE SEVERITY LADDER, IN ONE PLACE — the SQL rolls the same ranks up with
 *  `max()`; a third copy of this mapping is how the two paths drift. */
const SEVERITY_RANK = { info: 0, warn: 1, error: 2, critical: 3 } as const;
type Severity = keyof typeof SEVERITY_RANK;

const WARN_AND_ABOVE: Severity[] = ["warn", "error", "critical"];
const ALL_SEVERITIES: Severity[] = ["info", "warn", "error", "critical"];

/** Categories the external-API roll-up draws from. */
const EXTERNAL_CATEGORIES = ["external_api", "quota", "auth", "perf"];

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

/* -------------------------- external API health ------------------------- */

/**
 * Events/errors/criticals per external API provider, last 24h, plus the newest
 * error's message. ⚠ Sources carry dotted or bracketed prefixes
 * (`anthropic.messages`, `anthropic[0]`) and the provider is the leading
 * segment — see {@link providerOf}; the SQL states both delimiters as a regex.
 */
export async function getExternalApiHealth(): Promise<Clipped<ExternalApiHealth>> {
  const since = iso(DAY_MS);
  const db = supabaseAdmin();

  const { data: grouped, error } = await db.rpc("analytics_external_api_health", {
    p_since: since,
    p_categories: EXTERNAL_CATEGORIES,
  });

  if (!error) {
    const rows = ((grouped ?? []) as ExternalApiRpcRow[]).map((r) => ({
      name: r.name,
      events_24h: num(r.events_24h),
      errors_24h: num(r.errors_24h),
      criticals_24h: num(r.criticals_24h),
      last_error_message: r.last_error_message,
      last_error_at: r.last_error_at,
    }));
    return { rows: sortProviders(rows), truncated: false };
  }
  degrading("analytics_external_api_health", error);

  const { data } = await db
    .from("system_events")
    .select("source, severity, message, created_at, category")
    .gte("created_at", since)
    .in("category", EXTERNAL_CATEGORIES)
    .order("created_at", { ascending: false })
    .limit(EVENT_SCAN_LIMIT);

  const scan = clippedAt((data ?? []) as ExternalEventRow[], EVENT_SCAN_LIMIT);
  return { rows: tallyProviders(scan.rows), truncated: scan.truncated };
}

interface ExternalEventRow {
  source: string | null;
  severity: string;
  message: string;
  created_at: string;
}

/** ⚠ {@link ExternalApiHealth} on the wire: the counts arrive as STRINGS. */
type ExternalApiRpcRow = Pick<
  ExternalApiHealth,
  "name" | "last_error_message" | "last_error_at"
> &
  Record<"events_24h" | "errors_24h" | "criticals_24h", number | string>;

/**
 * 🔒 **THE PROVIDER KEY, AND THE SQL MIRRORS IT EXACTLY.** Split on `.` or `[`,
 * leading segment; a null or EMPTY source is `unknown`. ⚠ Two odd inputs are
 * pinned by test: `".foo"` keys as the EMPTY STRING, and `"anthropic[0]"` keys
 * as `anthropic` — the bracket is the delimiter a `split_part(…, '.', 1)`
 * translation silently drops, forking every indexed source into its own row.
 */
export function providerOf(source: string | null | undefined): string {
  return (source || "unknown").split(/[.\[]/)[0];
}

/** The JS roll-up, kept as the degrade. ⚠ Newest-first in, as {@link groupAlerts}. */
export function tallyProviders(rows: ExternalEventRow[]): ExternalApiHealth[] {
  const byProvider = new Map<string, ExternalApiHealth>();
  for (const row of rows) {
    const provider = providerOf(row.source);
    let entry = byProvider.get(provider);
    if (!entry) {
      entry = {
        name: provider,
        events_24h: 0,
        errors_24h: 0,
        criticals_24h: 0,
        last_error_message: null,
        last_error_at: null,
      };
      byProvider.set(provider, entry);
    }
    entry.events_24h += 1;
    if (row.severity === "error" || row.severity === "critical") {
      entry.errors_24h += 1;
      if (row.severity === "critical") entry.criticals_24h += 1;
      if (!entry.last_error_at || row.created_at > entry.last_error_at) {
        entry.last_error_at = row.created_at;
        entry.last_error_message = row.message;
      }
    }
  }
  return sortProviders(Array.from(byProvider.values()));
}

/** ⚠ `name` is the final tie-break for the same parity reason as {@link sortAlertGroups}. */
function sortProviders(rows: ExternalApiHealth[]): ExternalApiHealth[] {
  return rows.sort(
    (a, b) =>
      b.errors_24h - a.errors_24h ||
      b.events_24h - a.events_24h ||
      a.name.localeCompare(b.name)
  );
}

/* ------------------------------ MCP health ------------------------------ */

/**
 * 🔒 **THE EXACT p95 INDEX, SHARED BY BOTH PATHS.** 0-based
 * `Math.floor(n * 0.95)` over the ASCENDING list of STRICTLY POSITIVE latencies —
 * `n` counts those, not the calls.
 *
 * ⚠ **`percentile_cont`/`percentile_disc` DO NOT COMPUTE THIS, WHICH IS WHY THE
 * SQL SPELLS OUT AN ARRAY SUBSCRIPT (`… + 1`, 1-based).** For n = 20 this picks
 * 0-based 19, the maximum; `percentile_disc(0.95)` picks 18 and
 * `percentile_cont` interpolates off the list entirely. Either would make the
 * RPC and this degrade disagree about identical data — the one failure a
 * fallback must not have. The migration argues the float parity and asserts it.
 */
export function p95Index(positiveLatencyCount: number): number {
  return Math.floor(positiveLatencyCount * 0.95);
}

/**
 * MCP call volume, error rate and p95 latency, last 24h.
 *
 * 🔒 **THIS WAS THE WORST OF THE THREE, BECAUSE THE CLIP WAS UNORDERED.** The
 * old read asked for {@link MCP_SCAN_LIMIT} rows with **no `ORDER BY` at all**,
 * so `max_rows` cut it to 1,000 rows Postgres may return in ANY permutation.
 * `calls_24h` was `data.length` — a hard 1,000 the moment the day held more —
 * and the p95 was a percentile of an arbitrary sample, so it was not even
 * CONSISTENTLY wrong: two refreshes could disagree with each other and neither
 * with the truth, which is why it never became a bug report.
 *
 * ⚠ **THE DEGRADE NOW ORDERS NEWEST-FIRST** — not exact, but a DEFINED floor
 * (the newest 1,000 calls) instead of a lottery.
 */
export async function getMcpHealth(): Promise<McpHealth> {
  const since = iso(DAY_MS);
  const db = supabaseAdmin();

  const { data: agg, error } = await db.rpc("analytics_mcp_health", {
    p_since: since,
  });

  if (!error) {
    // ⚠ One row, always: bare aggregates over an empty table still answer.
    const row = ((agg ?? []) as McpHealthRpcRow[])[0];
    return mcpHealth(
      num(row?.calls_24h),
      num(row?.errors_24h),
      row?.p95_latency_ms ?? null,
      false
    );
  }
  degrading("analytics_mcp_health", error);

  const { data } = await db
    .from("mcp_events")
    .select("response_status, latency_ms")
    .eq("source", "mcp")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MCP_SCAN_LIMIT);

  const scan = clippedAt((data ?? []) as McpEventRow[], MCP_SCAN_LIMIT);
  const errors = scan.rows.filter((r) => (r.response_status ?? 0) >= 400).length;
  const latencies = scan.rows
    .map((r) => r.latency_ms)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);

  return mcpHealth(
    scan.rows.length,
    errors,
    latencies.length ? latencies[p95Index(latencies.length)] : null,
    scan.truncated
  );
}

type McpEventRow = { response_status: number | null; latency_ms: number | null };

type McpHealthRpcRow = Record<"calls_24h" | "errors_24h", number | string> & {
  p95_latency_ms: number | null;
};

/** ⚠ ONE divide, so the two paths cannot disagree about a rate they both derive. */
function mcpHealth(
  calls: number,
  errors: number,
  p95: number | null,
  truncated: boolean
): McpHealth {
  return {
    calls_24h: calls,
    errors_24h: errors,
    error_rate: calls === 0 ? 0 : errors / calls,
    p95_latency_ms: p95,
    truncated,
  };
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
  mcp: McpHealth;
  external: Clipped<ExternalApiHealth>;
}): OverallStatus {
  const truncated =
    inputs.alerts.truncated || inputs.external.truncated || inputs.mcp.truncated;

  const hasCritical = inputs.alerts.rows.some((a) => a.severity === "critical");
  const externalAuthFailed = inputs.external.rows.some((p) => p.criticals_24h > 0);

  if (hasCritical || externalAuthFailed) {
    return {
      level: "red",
      reason: hasCritical ? "Critical alert active" : "External API auth failing",
      truncated,
    };
  }

  const hasErrors = inputs.alerts.rows.some((a) => a.severity === "error");
  const mcpElevated = inputs.mcp.calls_24h > 10 && inputs.mcp.error_rate > 0.2;

  if (hasErrors || mcpElevated) {
    return {
      level: "yellow",
      reason: hasErrors ? "Errors logged in last 24h" : "Elevated MCP error rate",
      truncated,
    };
  }

  return {
    level: "green",
    reason: truncated
      ? "Nothing in the rows we could read — the reads were clipped, so this is not an all-clear"
      : "All clear in the last 24h",
    truncated,
  };
}
