/**
 * THE ADMIN HEALTH DASHBOARD'S THREE AGGREGATES, REIMPLEMENTED AS POSTGRES WOULD
 * RUN THEM — plus the event fixtures the cases drive through them (Samuel #2935).
 *
 * ⚠ **ITS OWN MODULE** because the suite that uses it reached the §1 500-line cap
 * — the seam `_fake-credit-db.ts` already named: the FAKE vs the CASES.
 * ⚠ `_`-prefixed and not a `.test.ts`, so vitest does not collect it.
 *
 * 🔒 **IT IS SQL-SHAPED, NOT TS-SHAPED, AND THAT IS THE ENTIRE POINT.** These
 * functions mirror the migration's statements — 1-based array subscripts,
 * `count(*)::bigint` crossing the wire as a STRING, the alternation regex
 * `'\.|\['`, `array_agg(… ORDER BY created_at DESC)[1]` for the newest-row
 * fields — rather than calling `health.ts`'s own groupers. A fake RPC that
 * delegated to the TS grouper could never catch the RPC path and the degrade path
 * drifting apart, which is the one failure a fallback must not have.
 *
 * ⚠ **THE TABLE READS ARE CLIPPED AT `max_rows` BY `shared/testing/postgrest-cap`**
 * and say nothing about it, which is the finding itself. `rpc()` is NOT clipped:
 * it returns one row per group, which is why the fix is an aggregate.
 */

import { vi } from "vitest";
import { fakePostgrest, type Row } from "@/shared/testing/postgrest-cap";
import { supabaseAdmin } from "@/shared/supabase/admin";

/* -------------------------- the SQL side, in TS ------------------------- */

const RANK: Record<string, number> = { info: 0, warn: 1, error: 2, critical: 3 };
const BY_RANK = ["info", "warn", "error", "critical"];

/**
 * ⚠ The migration's `coalesce(nullif(source,''),'unknown')` + its UUID
 * `regexp_replace(…, ':id', 'g')`, literally — spelled out here rather than
 * imported from `health.ts › routeOf`, so a drift between the SQL and the TS is
 * what fails rather than being shared with the code under test.
 */
export function sqlRoute(source: unknown): string {
  const src = String(source ?? "");
  return (src === "" ? "unknown" : src).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ":id"
  );
}

function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const bucket = out.get(k);
    if (bucket) bucket.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/** Newest first — what `array_agg(… ORDER BY created_at DESC)[1]` picks from. */
function newestFirst(rows: Row[]): Row[] {
  return [...rows].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at))
  );
}

function sqlAlertGroups(all: readonly Row[], args: Record<string, unknown>) {
  const since = String(args.p_since);
  const severities = args.p_severities as string[];
  const kept = all.filter(
    (r) => String(r.created_at) >= since && severities.includes(String(r.severity))
  );
  const groups = [...groupBy(kept, (r) => String(r.fingerprint))].map(
    ([fingerprint, rows]) => {
      const desc = newestFirst(rows);
      return {
        fingerprint,
        severity: BY_RANK[Math.max(...rows.map((r) => RANK[String(r.severity)] ?? 0))],
        category: String(desc[0].category),
        source: String(desc[0].source),
        sample_message: String(desc[0].message),
        event_count: String(rows.length),
        first_seen: String(desc[desc.length - 1].created_at),
        last_seen: String(desc[0].created_at),
      };
    }
  );
  groups.sort(
    (a, b) =>
      RANK[b.severity] - RANK[a.severity] ||
      b.last_seen.localeCompare(a.last_seen) ||
      a.fingerprint.localeCompare(b.fingerprint)
  );
  return groups.slice(0, Math.max(Number(args.p_limit), 0));
}

/** ⚠ Filters on SEVERITY and not on `category` — the read's own ruling, mirrored. */
function sqlRouteErrorGroups(all: readonly Row[], args: Record<string, unknown>) {
  const since = String(args.p_since);
  const severities = args.p_severities as string[];
  const kept = all.filter(
    (r) => String(r.created_at) >= since && severities.includes(String(r.severity))
  );
  const rows = [...groupBy(kept, (r) => sqlRoute(r.source))].map(
    ([route, group]) => {
      const desc = newestFirst(group);
      return {
        route,
        errors_24h: String(group.length),
        criticals_24h: String(group.filter((r) => r.severity === "critical").length),
        last_error_message: String(desc[0].message),
        last_error_at: String(desc[0].created_at),
      };
    }
  );
  rows.sort(
    (a, b) =>
      Number(b.criticals_24h) - Number(a.criticals_24h) ||
      Number(b.errors_24h) - Number(a.errors_24h) ||
      a.route.localeCompare(b.route)
  );
  return rows;
}

/* ⚠ `sqlMcpHealth` IS GONE, with the RPC it mirrored. MCP volume is a COUNTED
   read now, and `postgrest-cap.ts` keeps `count` exact the way the real server
   does — so the fake needs no aggregate for it, which is the point. */

/* ------------------------------- fixtures ------------------------------- */

/**
 * ⚠ **THE CLOCK IS FROZEN FOR THE WHOLE SUITE.** `health.ts` derives its window
 * from `Date.now()`, and {@link ago} is called both when building a fixture and
 * when asserting against it — a millisecond of real drift between the two fails
 * a `first_seen` case for a reason that has nothing to do with clipping.
 */
export const NOW = Date.parse("2026-10-10T12:00:00.000Z");

/** Newest first at `i = 0`, one second apart — comfortably inside the 24h window. */
export function ago(i: number): string {
  return new Date(NOW - i * 1_000).toISOString();
}

/**
 * 🔒 **ONE `critical` BURIED DEEPER THAN A 1,000-ROW CLIP CAN REACH**, and that
 * row is the whole point: the clip does not merely under-count, it changes
 * fp-0's SEVERITY, which turns the banner's verdict from red into yellow. A
 * dashboard that downgrades its own alarm is the failure mode.
 */
export const BURIED_CRITICAL = 5_997;

const ALERT_SEVERITY = ["warn", "error", "warn"];

/** `n` system_events across three fingerprints. */
export function alertRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    fingerprint: `fp-${i % 3}`,
    severity: i === BURIED_CRITICAL ? "critical" : ALERT_SEVERITY[i % 3],
    category: `cat-${i % 3}`,
    source: `svc-${i % 3}.api`,
    message: `msg-${i}`,
    created_at: ago(i),
  }));
}

/**
 * ⚠ **PROD'S OWN SOURCE SHAPES** (measured 2026-10-10): HTTP route strings, two
 * of them carrying a channel UUID. Those two collapse to ONE route template, so
 * a fake that forgot the id normalisation reports three routes where there are
 * two — the 35-vs-15 difference the real table shows.
 * ⚠ An empty source is kept: it keys as `unknown`, as the old provider key did.
 */
const ROUTE_SOURCES = [
  "POST /api/channels/sessions",
  "GET /api/channels/4c6456f6-6bd9-4c86-ac65-8b846d5fd682/await",
  "GET /api/channels/bb0f57db-bb46-4ce6-af96-83eb8e2dbf28/await",
  "",
];

/** ⚠ The ONE `critical` is buried past the clip — see {@link BURIED_CRITICAL}:
 *  clipping it downgrades the banner from red to yellow. */
export const BURIED_ROUTE_CRITICAL = 5_996;

/** ⚠ EVERY row is error-or-critical, because the read filters on severity: a
 *  `warn` here would be filtered out and quietly weaken the count cases. */
export function routeErrorRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    source: ROUTE_SOURCES[i % 4],
    severity: i === BURIED_ROUTE_CRITICAL ? "critical" : "error",
    message: `err-${i}`,
    // ⚠ Deliberately `other`: the read must NOT filter on category, and a
    // fixture that only carried the old four would hide a re-added filter.
    category: "other",
    created_at: ago(i),
  }));
}

/**
 * `mcp_tool_calls` rows for the VOLUME count — all LOOPBACK rows, so the
 * expected answer is simply `n`.
 *
 * ⚠ **THEY ARE ALL LOOPBACK ON PURPOSE, BECAUSE THE FAKE DOES NOT INTERPRET THE
 * EXCLUSIONS.** `postgrest-cap.ts` records `.or()` and `.not()` without parsing
 * them (a fake that parsed a PostgREST filter string would be asserting its own
 * parser — the discipline `_fake-credit-db.ts` set). So mixing `mcp:`-prefixed
 * rows in here would NOT be filtered and the count case would simply read the
 * wrong number for an invisible reason. The two exclusions are pinned as CLAUSE
 * TEXT by their own case instead, which is the half a fake can actually prove.
 */
export function mcpToolCallRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `call-${String(i).padStart(6, "0")}`,
    tool: "dopl_search",
    op: "search",
    created_at: ago(i),
  }));
}

/* -------------------------------- mount --------------------------------- */

export type Tables = Record<string, readonly Row[]>;

/**
 * Point `supabaseAdmin()` at the fake.
 *
 * `applied: true` = the migration has run, so `rpc()` answers the aggregate.
 * `applied: false` = `PGRST202`, **which is the live path today** (the migration
 * ships unapplied), so every case runs it too.
 */
export function mount(tables: Tables, applied: boolean) {
  const fake = fakePostgrest(tables, {
    rpc: applied
      ? (name, args) => {
          const events = tables.system_events ?? [];
          if (name === "analytics_recent_alert_groups") {
            return { data: sqlAlertGroups(events, args), error: null };
          }
          if (name === "analytics_route_error_groups") {
            return { data: sqlRouteErrorGroups(events, args), error: null };
          }
          return undefined;
        }
      : undefined,
  });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}
