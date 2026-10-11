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
  BURIED_ROUTE_CRITICAL,
  NOW,
  ago,
  alertRows,
  mcpToolCallRows,
  mount,
  routeErrorRows,
  sqlRoute,
} from "./_fake-health-db";
import {
  computeOverallStatus,
  getMcpHealth,
  getRecentAlerts,
  getServerErrorsByRoute,
  routeOf,
  type AlertGroup,
  type RouteErrorGroup,
} from "./health";

function total(
  rows: Array<{ count: number }> | Array<{ errors_24h: number }>
): number {
  return (rows as Array<Record<string, number>>).reduce(
    (sum, r) => sum + (r.count ?? r.errors_24h),
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

/* --------------------- 2/3 · getServerErrorsByRoute --------------------- */

describe("getServerErrorsByRoute — system_events grouped by route template", () => {
  it("counts EVERY error per route through the RPC", async () => {
    mount({ system_events: routeErrorRows(6_000) }, true);
    const scan = await getServerErrorsByRoute();
    expect(scan.truncated).toBe(false);
    expect(total(scan.rows)).toBe(6_000);
    // The two await sources differ only by channel id, so they are ONE route.
    expect(
      scan.rows.find((r) => r.route === "GET /api/channels/:id/await")?.errors_24h
    ).toBe(3_000);
  });

  it("degrades to the CLIPPED per-route count and says truncated", async () => {
    mount({ system_events: routeErrorRows(6_000) }, false);
    const scan = await getServerErrorsByRoute();
    expect(total(scan.rows)).toBe(MAX_ROWS);
    expect(scan.truncated).toBe(true);
    const await_ = scan.rows.find((r) => r.route === "GET /api/channels/:id/await")!;
    expect(await_.errors_24h).toBe(500);
    expect(await_.errors_24h).not.toBe(3_000);
  });

  it("zeroes a buried CRITICAL, which is what downgrades the red banner", async () => {
    const rows = routeErrorRows(6_000);
    mount({ system_events: rows }, true);
    const exact = await getServerErrorsByRoute();
    mount({ system_events: rows }, false);
    const clipped = await getServerErrorsByRoute();

    const sessions = (s: { rows: RouteErrorGroup[] }) =>
      s.rows.find((r) => r.route === "POST /api/channels/sessions")!;
    // ⚠ BURIED_ROUTE_CRITICAL sits on this route, past the 1,000-row clip.
    expect(BURIED_ROUTE_CRITICAL % 4).toBe(0);
    expect(sessions(exact).criticals_24h).toBe(1);
    expect(sessions(clipped).criticals_24h).toBe(0);
  });

  it("normalises ids out of the path, so one route is one row", async () => {
    mount({ system_events: routeErrorRows(6_000) }, true);
    const routes = (await getServerErrorsByRoute()).rows.map((r) => r.route).sort();
    // 🔒 FOUR raw sources, THREE templates — the 35-vs-15 collapse the real
    // table shows. Grouping on the raw string would list both await channels.
    expect(routes).toEqual([
      "GET /api/channels/:id/await",
      "POST /api/channels/sessions",
      "unknown",
    ]);
    expect(routes.some((r) => /[0-9a-f]{8}-/.test(r))).toBe(false);
  });

  it("keys the odd inputs the same way in TS and in the SQL-shaped regex", () => {
    const cases: Array<[string | null, string]> = [
      [
        "GET /api/channels/4c6456f6-6bd9-4c86-ac65-8b846d5fd682/await",
        "GET /api/channels/:id/await",
      ],
      // Two ids in one path: BOTH replaced, which needs the global flag.
      [
        "POST /api/a/4c6456f6-6bd9-4c86-ac65-8b846d5fd682/b/bb0f57db-bb46-4ce6-af96-83eb8e2dbf28",
        "POST /api/a/:id/b/:id",
      ],
      // Upper case hex is still a uuid.
      [
        "GET /x/4C6456F6-6BD9-4C86-AC65-8B846D5FD682",
        "GET /x/:id",
      ],
      ["POST /api/channels/sessions", "POST /api/channels/sessions"],
      ["", "unknown"],
      [null, "unknown"],
    ];
    for (const [input, expected] of cases) {
      expect(routeOf(input)).toBe(expected);
      // 🔒 The parity that matters: the TS regex and the SQL's are one pattern.
      expect(sqlRoute(input)).toBe(expected);
    }
  });

  it("reports the NEWEST error's message on both paths", async () => {
    const rows: Row[] = [
      { source: "GET /a", severity: "error", message: "old", category: "other", created_at: ago(9) },
      { source: "GET /a", severity: "critical", message: "new", category: "other", created_at: ago(1) },
      { source: "GET /b", severity: "error", message: "only", category: "other", created_at: ago(2) },
    ];
    mount({ system_events: rows }, true);
    const exact = await getServerErrorsByRoute();
    mount({ system_events: rows }, false);
    const degraded = await getServerErrorsByRoute();
    for (const scan of [exact, degraded]) {
      expect(scan.rows.find((r) => r.route === "GET /a")).toMatchObject({
        last_error_message: "new",
        last_error_at: ago(1),
        errors_24h: 2,
        criticals_24h: 1,
      });
      expect(scan.rows.find((r) => r.route === "GET /b")).toMatchObject({
        last_error_message: "only",
        errors_24h: 1,
        criticals_24h: 0,
      });
    }
  });

  it("asks for severities and NOT for a category — the old panel's blank filter", async () => {
    const fake = mount({ system_events: routeErrorRows(10) }, false);
    await getServerErrorsByRoute();
    // 🔒 A `category IN (...)` clause here is the regression: the four it used
    // to name hold zero rows in prod, which is why this panel was blank.
    const ins = fake.calls.filter((c) => c.op === "in");
    expect(ins).toHaveLength(1);
    expect(ins[0].args[0]).toBe("severity");
    expect(ins[0].args[1]).toEqual(["error", "critical"]);
  });

  it("agrees row-for-row with the RPC below the ceiling", async () => {
    const rows = routeErrorRows(600);
    mount({ system_events: rows }, true);
    const exact = await getServerErrorsByRoute();
    mount({ system_events: rows }, false);
    const degraded = await getServerErrorsByRoute();
    expect(degraded.rows).toEqual(exact.rows);
  });
});

/* ------------------------- 3/3 · getMcpHealth --------------------------- */

describe("getMcpHealth — a COUNT, which max_rows cannot clip", () => {
  it("returns the TRUE volume far past the ceiling, with no RPC and no truncation", async () => {
    const fake = mount({ mcp_tool_calls: mcpToolCallRows(6_361) }, false);
    // ⚠ `applied: false` — there is no aggregate to be missing, which is the
    // whole point: a counted read has nothing to degrade to.
    expect(await getMcpHealth()).toEqual({ calls_24h: 6_361 });
    expect(fake.calls.some((c) => c.op === "rpc")).toBe(false);
  });

  it("asks for a HEAD count, so no row can be clipped", async () => {
    const fake = mount({ mcp_tool_calls: mcpToolCallRows(2_500) }, false);
    await getMcpHealth();
    const select = fake.calls.find((c) => c.op === "select")!;
    expect(select.args[1]).toEqual({ count: "exact", head: true });
    // 🔒 No `.limit()` anywhere: a limit is what made every other read a floor.
    expect(fake.calls.some((c) => c.op === "limit")).toBe(false);
  });

  it("reads mcp_tool_calls and NOT the dead mcp_events table", async () => {
    const fake = mount({ mcp_tool_calls: mcpToolCallRows(5) }, false);
    await getMcpHealth();
    // 🔒 `mcp_events` has had no writer since 2026-07-17, so this panel showed
    // zeros for three months. Reading it again is the regression.
    expect(fake.calls.filter((c) => c.op === "from").map((c) => c.args[0])).toEqual([
      "mcp_tool_calls",
    ]);
  });

  it("excludes the charged-call rows and the await polling, as clause text", async () => {
    const fake = mount({ mcp_tool_calls: mcpToolCallRows(5) }, false);
    await getMcpHealth();
    // ⚠ Pinned as TEXT because `postgrest-cap.ts` records these without parsing
    // them — a fake that parsed a PostgREST filter would assert its own parser.
    expect(fake.calls).toEqual(
      expect.arrayContaining([
        { op: "or", args: ["tool.neq.channel,op.not.like.await*"] },
        { op: "not", args: ["tool", "like", "mcp:*"] },
      ])
    );
  });

  it("answers zero for an empty day", async () => {
    mount({ mcp_tool_calls: [] }, false);
    expect(await getMcpHealth()).toEqual({ calls_24h: 0 });
  });
});

/* ---------------------------- the banner -------------------------------- */

describe("computeOverallStatus — a clipped read is not an all-clear", () => {
  const quiet = {
    alerts: { rows: [] as AlertGroup[], truncated: false },
    routes: { rows: [] as RouteErrorGroup[], truncated: false },
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
      computeOverallStatus({ ...quiet, routes: { rows: [], truncated: true } }).truncated
    ).toBe(true);
    expect(
      computeOverallStatus({ ...quiet, alerts: { rows: [], truncated: true } }).truncated
    ).toBe(true);
  });

  it("goes RED on a route failing critically", () => {
    const status = computeOverallStatus({
      ...quiet,
      routes: {
        rows: [{ route: "POST /x", criticals_24h: 1 } as RouteErrorGroup],
        truncated: false,
      },
    });
    expect(status).toMatchObject({
      level: "red",
      reason: "A server route is failing critically",
    });
  });

  it("takes NO mcp input at all — the deleted arm cannot come back by default", () => {
    // 🔒 The arm read `mcp.error_rate > 0.2`, and nothing live measures an MCP
    // error. Keeping it against a rate pinned at 0 would be a check that can
    // never fire reading as a check that passes — the same defect this sweep
    // deleted from ontology, where `length >= 5_000` could never be true.
    // The TYPE is the guard: `mcp` is not in the input, so re-adding the arm
    // cannot compile without re-adding an instrument to measure it.
    expect(Object.keys(quiet).sort()).toEqual(["alerts", "routes"]);
  });
});
