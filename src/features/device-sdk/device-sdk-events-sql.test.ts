/**
 * `20261122300000_device_sdk_events.sql` read as text (no database: the live replay is CI's
 * `rls-redteam` job, INVARIANTS §14). Pins: the columns ARE the C8 row in contract order, the closed
 * sets equal the frozen contracts, the three analytics indexes, service-role-only RLS.
 */
import { describe, expect, it } from "vitest";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";
import { livePolicies, liveRlsEnabled } from "@/shared/supabase/rls-policy-scan";
import { DEVICE_KINDS, ENVIRONMENTS, EVENT_OUTCOMES, EVENT_ROW_FIELDS, RISK_TIERS } from "./types";

const FILE = "20261122300000_device_sdk_events.sql";
const migration = readMigrations().find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");

const body = (() => {
  const m = /CREATE TABLE IF NOT EXISTS public\.dev_events \(([\s\S]*?)\n\);/.exec(sql);
  return m ? m[1] : "";
})();
const columns = body
  .split("\n")
  .map((l) => /^\s{2}([a-z_]+)\s+/.exec(l)?.[1])
  .filter((c): c is string => Boolean(c));
const column = (name: string) => body.split("\n").find((l) => new RegExp(String.raw`^\s{2}${name}\s`).test(l)) ?? "";
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("device SDK events migration", () => {
  it("exists and creates dev_events", () => {
    expect(migration, FILE).toBeDefined();
    expect(body).not.toBe("");
  });

  it("columns are exactly the C8 row, in the contract's order", () => {
    // The portal's columns came later, additively (`20261124100000_dev_portal_log_fields.sql`).
    const later = ["api_key_id", "action_id", "operation", "http_method", "route", "http_status", "message_text", "channel_id", "message_id"];
    expect(columns).toEqual(EVENT_ROW_FIELDS.filter((f) => !later.includes(f)));
    expect(EVENT_ROW_FIELDS.slice(-later.length)).toEqual(later);
  });

  it("project_id is an FK to dev_projects (cascade); the nested C8 objects are jsonb", () => {
    expect(column("project_id")).toMatch(/uuid\s+NOT NULL REFERENCES public\.dev_projects \(id\) ON DELETE CASCADE/);
    for (const c of ["route_decision", "confirmation", "latency_ms"]) expect(column(c)).toMatch(/\bjsonb\b/);
    expect(column("latency_ms")).toMatch(/NOT NULL/);
    expect(column("outcome")).toMatch(/NOT NULL/);
  });

  it("restates the contracts' closed sets exactly", () => {
    expect(quoted(/env IN \(([^)]*)\)/.exec(column("env"))![1])).toEqual([...ENVIRONMENTS]);
    expect(quoted(/device_kind IN \(([^)]*)\)/.exec(column("device_kind"))![1])).toEqual([...DEVICE_KINDS]);
    expect(quoted(/risk_tier IN \(([^)]*)\)/.exec(column("risk_tier"))![1])).toEqual([...RISK_TIERS]);
    expect(quoted(/outcome IN \(([^)]*)\)/.exec(column("outcome"))![1])).toEqual([...EVENT_OUTCOMES]);
  });

  it("carries the three analytics indexes plus the retention index", () => {
    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toContain("ON public.dev_events (project_id, env, ts DESC)");
    expect(flat).toContain("ON public.dev_events (project_id, device_kind, ts)");
    expect(flat).toContain("ON public.dev_events (project_id, capability, ts)");
    expect(flat).toContain("ON public.dev_events (ts)");
  });

  it("🔒 RLS on and NO policy after the replay (service role only)", () => {
    expect(liveRlsEnabled().has("dev_events")).toBe(true);
    expect([...livePolicies().keys()].filter((k) => k.startsWith("dev_events."))).toEqual([]);
    expect(sql).toMatch(/REVOKE ALL ON public\.dev_events FROM anon, authenticated;/);
  });

  it("carries no backslash (the MCP SQL transport mangles them)", () => {
    expect(migration?.sql ?? "").not.toContain("\\");
  });
});
