/**
 * THE ADMIN HEALTH DASHBOARD'S THREE GROUP-BYs, DRIVEN THROUGH A POSTGREST THAT
 * ACTUALLY CLIPS (Samuel #2935, the `max_rows` sweep).
 *
 * 🔒 **THE CASES HAVE TEETH ONLY BECAUSE THE FAKE DROPS ROWS.** Every number
 * here was computed in JS over a `.limit(5000)` / `.limit(10000)` haul that
 * `supabase/config.toml › max_rows = 1000` cut server-side, silently, with no
 * clip marker anywhere in the file. So each case asserts THREE things, not one:
 * the RPC's answer is the TRUE total, the degrade's answer is the CLIPPED one,
 * and **the two differ** — a suite where they happened to match would pass while
 * proving nothing.
 *
 * ⚠ The SQL-shaped aggregates and the fixtures live in `_fake-health-db.ts`
 * (§1's 500-line cap, and the FAKE/CASES seam `_fake-credit-db.ts` named).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_ROWS, type Row } from "@/shared/testing/postgrest-cap";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import {
  BURIED_CRITICAL,
  NOW,
  ago,
  alertRows,
  externalRows,
  mcpRows,
  mount,
  sqlP95OneBasedIndex,
  sqlProvider,
} from "./_fake-health-db";
import {
  computeOverallStatus,
  getExternalApiHealth,
  getMcpHealth,
  getRecentAlerts,
  p95Index,
  providerOf,
  type AlertGroup,
  type ExternalApiHealth,
} from "./health";

function total(rows: Array<{ count: number }> | Array<{ events_24h: number }>): number {
  return (rows as Array<Record<string, number>>).reduce(
    (sum, r) => sum + (r.count ?? r.events_24h),
    0
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------ the harness ----------------------------- */

describe("the fake really clips, so every case below means something", () => {
  it("answers a .limit(5000) with max_rows rows and no error", async () => {
    const fake = mount({ system_events: alertRows(6_000) }, false);
    const db = fake.client as {
      from: (t: string) => {
        select: (c: string) => {
          limit: (n: number) => PromiseLike<{ data: Row[] | null; error: unknown }>;
        };
      };
    };
    const { data, error } = await db.from("system_events").select("*").limit(5_000);
    expect(data).toHaveLength(MAX_ROWS);
    expect(error).toBeNull();
  });
});

/* ------------------------- 1/3 · getRecentAlerts ------------------------ */

describe("getRecentAlerts — system_events grouped by fingerprint", () => {
  it("counts EVERY event in the window through the RPC", async () => {
    mount({ system_events: alertRows(6_000) }, true);
    const scan = await getRecentAlerts();
    expect(scan.truncated).toBe(false);
    expect(total(scan.rows)).toBe(6_000);
    expect(scan.rows.map((r) => r.count)).toEqual([2_000, 2_000, 2_000]);
  });

  it("degrades to the CLIPPED count and says truncated — and the two differ", async () => {
    mount({ system_events: alertRows(6_000) }, false);
    const scan = await getRecentAlerts();
    // 🔒 THE BUG, measured: 6,000 events reported as 1,000 of them.
    expect(total(scan.rows)).toBe(MAX_ROWS);
    expect(total(scan.rows)).not.toBe(6_000);
    expect(scan.truncated).toBe(true);
    expect(scan.rows.map((r) => r.count)).toEqual([333, 334, 333]);
  });

  it("warns rather than degrading silently", async () => {
    mount({ system_events: alertRows(2_000) }, false);
    await getRecentAlerts();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("analytics_recent_alert_groups")
    );
  });

  it("loses a buried CRITICAL to the clip — the severity itself goes wrong", async () => {
    const rows = alertRows(6_000);
    mount({ system_events: rows }, true);
    const exact = await getRecentAlerts();
    mount({ system_events: rows }, false);
    const clipped = await getRecentAlerts();

    expect(exact.rows[0]).toMatchObject({ fingerprint: "fp-0", severity: "critical" });
    expect(clipped.rows.find((r) => r.fingerprint === "fp-0")?.severity).toBe("warn");
    expect(clipped.rows.some((r) => r.severity === "critical")).toBe(false);
  });

  it("reports first_seen as the FIRST sighting, not the oldest survivor", async () => {
    const rows = alertRows(6_000);
    mount({ system_events: rows }, true);
    const exact = await getRecentAlerts();
    mount({ system_events: rows }, false);
    const clipped = await getRecentAlerts();

    const fp0 = (s: { rows: AlertGroup[] }) =>
      s.rows.find((r) => r.fingerprint === "fp-0")!;
    expect(fp0(exact).first_seen).toBe(ago(BURIED_CRITICAL));
    expect(fp0(clipped).first_seen).toBe(ago(999));
    expect(fp0(clipped).first_seen > fp0(exact).first_seen).toBe(true);
  });

  it("agrees row-for-row with the RPC on a set BELOW the ceiling", async () => {
    const rows = alertRows(600);
    mount({ system_events: rows }, true);
    const exact = await getRecentAlerts();
    mount({ system_events: rows }, false);
    const degraded = await getRecentAlerts();
    // ⚠ Including the order: the SQL `ORDER BY` and `sortAlertGroups` are the
    // same comparator, tie-break and all.
    expect(degraded.rows).toEqual(exact.rows);
    expect(degraded.truncated).toBe(false);
  });

  it("takes category/source/sample_message from the NEWEST row, both paths", async () => {
    const rows: Row[] = [
      { fingerprint: "f", severity: "warn", category: "old", source: "old.svc", message: "old", created_at: ago(9) },
      { fingerprint: "f", severity: "error", category: "new", source: "new.svc", message: "new", created_at: ago(1) },
    ];
    mount({ system_events: rows }, true);
    const exact = await getRecentAlerts();
    mount({ system_events: rows }, false);
    const degraded = await getRecentAlerts();
    const shape = {
      category: "new",
      source: "new.svc",
      sample_message: "new",
      severity: "error",
      count: 2,
    };
    expect(exact.rows[0]).toMatchObject(shape);
    expect(degraded.rows[0]).toMatchObject(shape);
  });

  it("clamps the RPC's top-N to the server ceiling so its own answer cannot clip", async () => {
    const fake = mount({ system_events: alertRows(10) }, true);
    await getRecentAlerts({ limit: 5_000 });
    const rpc = fake.calls.find((c) => c.op === "rpc")!;
    expect((rpc.args[1] as { p_limit: number }).p_limit).toBe(MAX_ROWS);
  });
});

/* ---------------------- 2/3 · getExternalApiHealth ---------------------- */

describe("getExternalApiHealth — system_events grouped by provider", () => {
  it("counts EVERY event per provider through the RPC", async () => {
    mount({ system_events: externalRows(6_000) }, true);
    const scan = await getExternalApiHealth();
    expect(scan.truncated).toBe(false);
    expect(total(scan.rows)).toBe(6_000);
    expect(scan.rows.find((p) => p.name === "anthropic")?.events_24h).toBe(2_000);
  });

  it("degrades to the CLIPPED per-provider count and says truncated", async () => {
    mount({ system_events: externalRows(6_000) }, false);
    const scan = await getExternalApiHealth();
    expect(total(scan.rows)).toBe(MAX_ROWS);
    expect(scan.truncated).toBe(true);
    const anthropic = scan.rows.find((p) => p.name === "anthropic")!;
    expect(anthropic.events_24h).toBe(334);
    expect(anthropic.events_24h).not.toBe(2_000);
  });

  it("zeroes a buried CRITICAL, which is what downgrades the red banner", async () => {
    const rows = externalRows(6_000);
    mount({ system_events: rows }, true);
    const exact = await getExternalApiHealth();
    mount({ system_events: rows }, false);
    const clipped = await getExternalApiHealth();

    const stripe = (s: { rows: ExternalApiHealth[] }) =>
      s.rows.find((p) => p.name === "stripe")!;
    expect(stripe(exact).criticals_24h).toBe(1);
    expect(stripe(clipped).criticals_24h).toBe(0);
  });

  it("splits the provider on BOTH delimiters — `.` and `[`", async () => {
    mount({ system_events: externalRows(6_000) }, true);
    const names = (await getExternalApiHealth()).rows.map((p) => p.name).sort();
    // ⚠ `anthropic.messages` and `anthropic[0]` are ONE provider. A
    // `split_part(source,'.',1)` translation would list `anthropic[0]` here.
    expect(names).toEqual(["", "anthropic", "plain", "stripe", "unknown"]);
    expect(names).not.toContain("anthropic[0]");
  });

  it("keys the odd inputs the same way in TS and in the SQL-shaped regex", () => {
    const cases: Array<[string | null, string]> = [
      ["anthropic.messages", "anthropic"],
      ["anthropic[0]", "anthropic"],
      ["anthropic[0].messages", "anthropic"],
      [".leading", ""],
      ["[leading", ""],
      ["plain", "plain"],
      ["", "unknown"],
      [null, "unknown"],
    ];
    for (const [input, expected] of cases) {
      expect(providerOf(input)).toBe(expected);
      // 🔒 The parity that matters: `[.\[]` and the SQL's `\.|\[` are one set.
      expect(sqlProvider(input)).toBe(expected);
    }
  });

  it("reports the NEWEST error's message, and null where there is none", async () => {
    const rows: Row[] = [
      { source: "a.x", severity: "error", message: "old", category: "auth", created_at: ago(9) },
      { source: "a.y", severity: "error", message: "new", category: "auth", created_at: ago(1) },
      { source: "b.z", severity: "warn", message: "quiet", category: "auth", created_at: ago(2) },
    ];
    mount({ system_events: rows }, true);
    const exact = await getExternalApiHealth();
    mount({ system_events: rows }, false);
    const degraded = await getExternalApiHealth();
    for (const scan of [exact, degraded]) {
      expect(scan.rows.find((p) => p.name === "a")).toMatchObject({
        last_error_message: "new",
        last_error_at: ago(1),
        errors_24h: 2,
      });
      expect(scan.rows.find((p) => p.name === "b")).toMatchObject({
        last_error_message: null,
        last_error_at: null,
      });
    }
  });

  it("agrees row-for-row with the RPC below the ceiling", async () => {
    const rows = externalRows(600);
    mount({ system_events: rows }, true);
    const exact = await getExternalApiHealth();
    mount({ system_events: rows }, false);
    const degraded = await getExternalApiHealth();
    expect(degraded.rows).toEqual(exact.rows);
  });
});

/* ------------------------- 3/3 · getMcpHealth --------------------------- */

describe("getMcpHealth — the unordered clip", () => {
  it("counts every call and every error through the RPC", async () => {
    mount({ mcp_events: mcpRows(2_500) }, true);
    const mcp = await getMcpHealth();
    expect(mcp).toMatchObject({ calls_24h: 2_500, errors_24h: 250, truncated: false });
    expect(mcp.error_rate).toBeCloseTo(0.1);
  });

  it("degrades to the CLIPPED call count and says truncated", async () => {
    mount({ mcp_events: mcpRows(2_500) }, false);
    const mcp = await getMcpHealth();
    // 🔒 `calls_24h` was `data.length` — pinned at max_rows the moment the day
    // held more, with no marker anywhere.
    expect(mcp.calls_24h).toBe(MAX_ROWS);
    expect(mcp.calls_24h).not.toBe(2_500);
    expect(mcp.errors_24h).toBe(100);
    expect(mcp.truncated).toBe(true);
  });

  it("biases the p95 DOWNWARD under the clip — the number, not just the count", async () => {
    const rows = mcpRows(2_500);
    mount({ mcp_events: rows }, true);
    const exact = await getMcpHealth();
    mount({ mcp_events: rows }, false);
    const clipped = await getMcpHealth();
    // floor(2500*0.95) = 2375 → 0-based 2375 → latency 2376.
    expect(exact.p95_latency_ms).toBe(2_376);
    // floor(1000*0.95) = 950 → 0-based 950 → latency 951.
    expect(clipped.p95_latency_ms).toBe(951);
    expect(clipped.p95_latency_ms).toBeLessThan(exact.p95_latency_ms!);
  });

  it("orders the degrade newest-first, so its floor is DEFINED and not a permutation", async () => {
    const fake = mount({ mcp_events: mcpRows(2_500) }, false);
    await getMcpHealth();
    expect(fake.calls).toEqual(
      expect.arrayContaining([
        { op: "order", args: ["created_at", { ascending: false }] },
      ])
    );
  });

  it("ignores non-mcp sources on both paths", async () => {
    const rows: Row[] = [
      ...mcpRows(10),
      { source: "web", response_status: 500, latency_ms: 9_999, created_at: ago(1) },
    ];
    mount({ mcp_events: rows }, true);
    expect((await getMcpHealth()).calls_24h).toBe(10);
    mount({ mcp_events: rows }, false);
    expect((await getMcpHealth()).calls_24h).toBe(10);
  });

  it("answers zeros and a null p95 for an empty day, both paths", async () => {
    const empty = {
      calls_24h: 0,
      errors_24h: 0,
      error_rate: 0,
      p95_latency_ms: null,
      truncated: false,
    };
    mount({ mcp_events: [] }, true);
    expect(await getMcpHealth()).toEqual(empty);
    mount({ mcp_events: [] }, false);
    expect(await getMcpHealth()).toEqual(empty);
  });

  it("counts a null response_status as a success, and 0/null latencies as untimed", async () => {
    const rows: Row[] = [
      { source: "mcp", response_status: null, latency_ms: null, created_at: ago(3) },
      { source: "mcp", response_status: 200, latency_ms: 0, created_at: ago(2) },
      { source: "mcp", response_status: 200, latency_ms: 40, created_at: ago(1) },
    ];
    mount({ mcp_events: rows }, true);
    const exact = await getMcpHealth();
    mount({ mcp_events: rows }, false);
    const degraded = await getMcpHealth();
    // Only one STRICTLY POSITIVE latency, so p95 is that one value.
    expect(exact).toMatchObject({ calls_24h: 3, errors_24h: 0, p95_latency_ms: 40 });
    expect(degraded).toMatchObject({ calls_24h: 3, errors_24h: 0, p95_latency_ms: 40 });
  });
});

describe("the p95 index — SQL and JS must land on the same element", () => {
  it("is floor(n*0.95), 0-based in TS and +1 in SQL, for every n up to 3,000", () => {
    for (let n = 1; n <= 3_000; n++) {
      expect(sqlP95OneBasedIndex(n) - 1).toBe(p95Index(n));
      // ⚠ Never out of range: floor(0.95n) <= n-1 for all n >= 1.
      expect(p95Index(n)).toBeLessThanOrEqual(n - 1);
      expect(p95Index(n)).toBeGreaterThanOrEqual(0);
    }
  });

  it("picks the MAXIMUM of 20 values, which is where percentile_disc diverges", () => {
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(sorted[p95Index(20)]).toBe(20);
    // 🔒 `percentile_disc(0.95)` lands on the 19th (0-based 18) and
    // `percentile_cont(0.95)` interpolates to 19.05 — in the list by no right at
    // all. Either would make the RPC disagree with its own degrade path.
    const percentileDisc = sorted[Math.ceil(20 * 0.95) - 1];
    expect(percentileDisc).toBe(19);
    expect(percentileDisc).not.toBe(sorted[p95Index(20)]);
  });

  it("selects the single value when only one call was timed", () => {
    expect(p95Index(1)).toBe(0);
    expect(sqlP95OneBasedIndex(1)).toBe(1);
  });
});

/* ---------------------------- the banner -------------------------------- */

describe("computeOverallStatus — a clipped read is not an all-clear", () => {
  const quiet = {
    alerts: { rows: [] as AlertGroup[], truncated: false },
    external: { rows: [] as ExternalApiHealth[], truncated: false },
    mcp: {
      calls_24h: 0,
      errors_24h: 0,
      error_rate: 0,
      p95_latency_ms: null,
      truncated: false,
    },
  };

  it("still says all clear when nothing was clipped", () => {
    expect(computeOverallStatus(quiet)).toEqual({
      level: "green",
      reason: "All clear in the last 24h",
      truncated: false,
    });
  });

  it("refuses to claim an all-clear over a clipped read", () => {
    // 🔒 THE SENTENCE THIS DASHBOARD PRINTED over the newest 1,000 events.
    const status = computeOverallStatus({
      ...quiet,
      alerts: { rows: [], truncated: true },
    });
    expect(status.level).toBe("green");
    expect(status.truncated).toBe(true);
    expect(status.reason).not.toBe("All clear in the last 24h");
    expect(status.reason).toMatch(/clipped/i);
  });

  it("keeps a RED verdict under a clip — reading more rows can only add alarms", () => {
    const status = computeOverallStatus({
      ...quiet,
      alerts: { rows: [{ severity: "critical" } as AlertGroup], truncated: true },
    });
    expect(status).toMatchObject({
      level: "red",
      reason: "Critical alert active",
      truncated: true,
    });
  });

  it("carries truncated up from whichever read was clipped", () => {
    expect(
      computeOverallStatus({ ...quiet, mcp: { ...quiet.mcp, truncated: true } }).truncated
    ).toBe(true);
    expect(
      computeOverallStatus({ ...quiet, external: { rows: [], truncated: true } }).truncated
    ).toBe(true);
  });
});
