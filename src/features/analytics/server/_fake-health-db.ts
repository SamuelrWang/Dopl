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

/** ⚠ The migration's `coalesce(nullif(source,''),'unknown')` + `'\.|\['`, literally. */
export function sqlProvider(source: unknown): string {
  const src = String(source ?? "");
  return (src === "" ? "unknown" : src).split(/\.|\[/)[0];
}

/**
 * ⚠ **THE 1-BASED SUBSCRIPT, AS POSTGRES EVALUATES IT**:
 * `sorted[floor(array_length * 0.95)::int + 1]`. Written out so a drift between
 * this and `health.ts › p95Index` is what fails, not an arithmetic shortcut
 * shared with the code under test.
 */
export function sqlP95OneBasedIndex(positiveCount: number): number {
  return Math.floor(positiveCount * 0.95) + 1;
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

function sqlExternalApi(all: readonly Row[], args: Record<string, unknown>) {
  const since = String(args.p_since);
  const categories = args.p_categories as string[];
  const kept = all.filter(
    (r) => String(r.created_at) >= since && categories.includes(String(r.category))
  );
  const rows = [...groupBy(kept, (r) => sqlProvider(r.source))].map(
    ([name, group]) => {
      const errs = newestFirst(
        group.filter((r) => r.severity === "error" || r.severity === "critical")
      );
      return {
        name,
        events_24h: String(group.length),
        errors_24h: String(errs.length),
        criticals_24h: String(group.filter((r) => r.severity === "critical").length),
        last_error_message: errs.length ? String(errs[0].message) : null,
        last_error_at: errs.length ? String(errs[0].created_at) : null,
      };
    }
  );
  rows.sort(
    (a, b) =>
      Number(b.errors_24h) - Number(a.errors_24h) ||
      Number(b.events_24h) - Number(a.events_24h) ||
      a.name.localeCompare(b.name)
  );
  return rows;
}

function sqlMcpHealth(all: readonly Row[], args: Record<string, unknown>) {
  const since = String(args.p_since);
  const kept = all.filter((r) => r.source === "mcp" && String(r.created_at) >= since);
  const sorted = kept
    .map((r) => r.latency_ms)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  return [
    {
      calls_24h: String(kept.length),
      errors_24h: String(
        kept.filter((r) => (Number(r.response_status) || 0) >= 400).length
      ),
      p95_latency_ms: sorted.length
        ? sorted[sqlP95OneBasedIndex(sorted.length) - 1]
        : null,
    },
  ];
}

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

/** ⚠ Both delimiters, a leading one, an empty source — the keys that separate the
 *  real split from a `split_part(source,'.',1)` rewrite. */
const EXTERNAL_SOURCES = [
  "anthropic.messages",
  "anthropic[0]",
  "stripe.charges",
  "plain",
  ".leading",
  "",
];
const EXTERNAL_CATEGORIES = ["external_api", "quota", "auth", "perf"];

/** ⚠ stripe's only `critical` is buried past the clip — see {@link BURIED_CRITICAL}. */
export const BURIED_STRIPE_CRITICAL = 5_996;

export function externalRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    source: EXTERNAL_SOURCES[i % 6],
    severity:
      i === BURIED_STRIPE_CRITICAL ? "critical" : i % 10 === 0 ? "error" : "warn",
    message: `err-${i}`,
    category: EXTERNAL_CATEGORIES[i % 4],
    created_at: ago(i),
  }));
}

/** ⚠ Latency RISES with age, so a newest-first clip biases the p95 DOWNWARD. */
export function mcpRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    source: "mcp",
    response_status: i % 10 === 0 ? 500 : 200,
    latency_ms: i + 1,
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
          if (name === "analytics_external_api_health") {
            return { data: sqlExternalApi(events, args), error: null };
          }
          if (name === "analytics_mcp_health") {
            return { data: sqlMcpHealth(tables.mcp_events ?? [], args), error: null };
          }
          return undefined;
        }
      : undefined,
  });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}
