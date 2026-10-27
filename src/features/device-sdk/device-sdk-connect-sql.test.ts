/**
 * `20261122400000_device_sdk_connect.sql` read as text (no database: the live replay is CI's
 * `rls-redteam` job, INVARIANTS §14). Pins: service-role-only RLS on the three new tables, tokens
 * stored as hashes only, the closed sets equal to the frozen contracts, the folded A3 FKs added
 * NOT VALID then VALIDATEd, and the G2 claim column on `glasses_pairings`.
 */
import { describe, expect, it } from "vitest";
import { CONNECTION_STATUSES, DEVICE_KINDS, ENVIRONMENTS, WEBHOOK_EVENT_NAMES } from "./types";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";
import { livePolicies, liveRlsEnabled } from "@/shared/supabase/rls-policy-scan";

const FILE = "20261122400000_device_sdk_connect.sql";
const TABLES = ["connections", "connect_sessions", "dev_webhook_outbox"];

const migration = readMigrations().find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");

function tableBody(t: string): string {
  const m = new RegExp(String.raw`CREATE TABLE IF NOT EXISTS public\.${t} \(([\s\S]*?)\n\);`).exec(sql);
  if (!m) throw new Error(`no CREATE TABLE for ${t}`);
  return m[1];
}

const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("device SDK connect migration", () => {
  it("exists and sorts after A1 (tenancy) and A3 (devices)", () => {
    expect(migration, FILE).toBeDefined();
    const names = readMigrations().map((m) => m.name);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261122200000_device_sdk_devices.sql"));
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261122100000_device_sdk_tenancy.sql"));
  });

  it("🔒 every new table has RLS on and NO policy after the replay (service role only)", () => {
    const rls = liveRlsEnabled();
    const policies = [...livePolicies().keys()];
    for (const t of TABLES) {
      expect(rls.has(t), `${t} RLS`).toBe(true);
      expect(policies.filter((k) => k.startsWith(`${t}.`)), `${t} policies`).toEqual([]);
      expect(sql).toMatch(new RegExp(String.raw`REVOKE ALL ON public\.${t}\s+FROM anon, authenticated;`));
    }
  });

  it("🔒 Connect tokens are stored as sha256 hex only", () => {
    const s = tableBody("connect_sessions");
    expect(s).toMatch(/token_hash\s+text\s+NOT NULL UNIQUE CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(s).toMatch(/public_token_hash\s+text\s+UNIQUE CHECK/);
    expect(s).not.toMatch(/\b(connect_token|public_token|token)\s+text/);
  });

  it("restates the contracts' env, kind, connection-status and webhook sets exactly", () => {
    for (const t of TABLES) {
      expect(quoted(/env\s+text\s+NOT NULL CHECK \(env IN \(([^)]*)\)\)/.exec(tableBody(t))![1]), t).toEqual([...ENVIRONMENTS]);
    }
    expect(quoted(/allowed_kinds <@ ARRAY\[([^\]]*)\]/.exec(tableBody("connect_sessions"))![1])).toEqual([...DEVICE_KINDS]);
    expect(quoted(/status\s+text\s+NOT NULL DEFAULT 'active' CHECK \(status IN \(([^)]*)\)\)/.exec(tableBody("connections"))![1])).toEqual([
      ...CONNECTION_STATUSES,
    ]);
    expect(quoted(/event_type\s+text\s+NOT NULL CHECK \(event_type IN \(([\s\S]*?)\)\),/.exec(tableBody("dev_webhook_outbox"))![1])).toEqual([
      ...WEBHOOK_EVENT_NAMES,
    ]);
  });

  it("D1: end users are dev_end_users, never auth.users", () => {
    for (const t of ["connections", "connect_sessions"]) {
      expect(tableBody(t)).toMatch(/end_user_id\s+uuid\s+NOT NULL REFERENCES public\.dev_end_users/);
      expect(tableBody(t)).not.toMatch(/auth\.users/);
    }
  });

  it("folds in A3's deferred devices FKs: NOT VALID, then VALIDATE (NULL prosumer owners pass)", () => {
    for (const [col, target] of [
      ["project_id", "dev_projects"],
      ["end_user_id", "dev_end_users"],
    ]) {
      expect(sql).toMatch(
        new RegExp(String.raw`ADD CONSTRAINT devices_${col}_fkey FOREIGN KEY \(${col}\)\s+REFERENCES public\.${target} \(id\) ON DELETE CASCADE NOT VALID`)
      );
      expect(sql).toContain(`ALTER TABLE public.devices VALIDATE CONSTRAINT devices_${col}_fkey;`);
    }
  });

  it("a G2 pairing claimed through Connect points at devices, never at both owners", () => {
    expect(sql).toMatch(/ALTER TABLE public\.glasses_pairings\s+ADD COLUMN IF NOT EXISTS sdk_device_id uuid NULL REFERENCES public\.devices \(id\)/);
    expect(sql).toMatch(/CHECK \(device_id IS NULL OR sdk_device_id IS NULL\)/);
  });

  it("carries no backslash (the MCP SQL transport mangles them)", () => {
    expect(migration?.sql ?? "").not.toContain("\\");
  });
});
