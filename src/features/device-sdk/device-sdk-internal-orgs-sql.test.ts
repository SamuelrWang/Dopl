/**
 * `20261122800000_device_sdk_internal_orgs.sql` read as text (no database: the live replay is CI's
 * `rls-redteam` job). Pins: `dev_orgs.internal` defaults false, and `dev_billable_events` (the read
 * model for usage/metrics/billing) drops internal orgs' events, is security_invoker, and is
 * SELECT-only to service_role.
 */
import { describe, expect, it } from "vitest";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";

const FILE = "20261122800000_device_sdk_internal_orgs.sql";
const migrations = readMigrations();
const migration = migrations.find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");

/** The body of `CREATE OR REPLACE VIEW public.dev_billable_events ... ;`. */
function viewBody(): string {
  const m = /CREATE OR REPLACE VIEW public\.dev_billable_events\s+WITH \(security_invoker = true\) AS([\s\S]*?);/.exec(sql);
  if (!m) throw new Error("no security_invoker CREATE VIEW for dev_billable_events");
  return m[1];
}

describe("device SDK internal orgs migration", () => {
  it("exists and sorts after the tenancy and events migrations", () => {
    expect(migration, FILE).toBeDefined();
    const names = migrations.map((m) => m.name);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261122100000_device_sdk_tenancy.sql"));
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261122300000_device_sdk_events.sql"));
  });

  it("adds dev_orgs.internal as NOT NULL DEFAULT false (every existing org stays billable)", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.dev_orgs\s+ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;/
    );
  });

  it("the billable view is dev_events minus events of internal orgs", () => {
    const body = viewBody();
    expect(body).toMatch(/SELECT e\.\*\s+FROM public\.dev_events e/);
    // NOT EXISTS, not an inner join: an event whose org row is gone must stay billable.
    expect(body).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1\s+FROM public\.dev_orgs o\s+WHERE o\.id = e\.org_id\s+AND o\.internal\s*\)/);
    expect(body).not.toMatch(/\bJOIN\b/i);
  });

  it("🔒 the view is service-role SELECT only", () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.dev_billable_events FROM anon, authenticated, service_role;/);
    expect(sql).toMatch(/GRANT SELECT ON public\.dev_billable_events TO service_role;/);
    expect(sql).not.toMatch(/GRANT [^;]*dev_billable_events[^;]*TO (anon|authenticated)/);
    expect(sql).not.toMatch(/GRANT (ALL|INSERT|UPDATE|DELETE)[^;]*dev_billable_events/);
  });

  it("carries no backslash (the MCP SQL transport mangles them)", () => {
    expect(migration?.sql ?? "").not.toContain("\\");
  });
});
