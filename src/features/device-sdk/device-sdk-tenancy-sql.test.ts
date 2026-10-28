/**
 * `20261122100000_device_sdk_tenancy.sql` read as text (no database: the live replay is CI's
 * `rls-redteam` job, INVARIANTS §14). Pins: service-role-only RLS on all five tables after the
 * replay, and the closed sets in the SQL CHECKs equal to the frozen contracts.
 */
import { describe, expect, it } from "vitest";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";
import { livePolicies, liveRlsEnabled } from "@/shared/supabase/rls-policy-scan";
import { API_KEY_KINDS, API_KEY_SCOPES, DEVICE_SDK_API_VERSION, ENVIRONMENTS } from "./types";

const FILE = "20261122100000_device_sdk_tenancy.sql";
const TABLES = ["dev_orgs", "dev_org_members", "dev_projects", "dev_api_keys", "dev_end_users"];

const migration = readMigrations().find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");

/** The body of `CREATE TABLE ... public.<t> ( ... );`. */
function tableBody(t: string): string {
  const m = new RegExp(String.raw`CREATE TABLE IF NOT EXISTS public\.${t} \(([\s\S]*?)\n\);`).exec(sql);
  if (!m) throw new Error(`no CREATE TABLE for ${t}`);
  return m[1];
}

/** `'a', 'b'` → ["a", "b"]. */
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("device SDK tenancy migration", () => {
  it("exists in supabase/migrations", () => {
    expect(migration, FILE).toBeDefined();
  });

  it("🔒 every table has RLS on and NO policy after the replay (service role only)", () => {
    const rls = liveRlsEnabled();
    const policies = [...livePolicies().keys()];
    for (const t of TABLES) {
      expect(rls.has(t), `${t} RLS`).toBe(true);
      expect(policies.filter((k) => k.startsWith(`${t}.`)), `${t} policies`).toEqual([]);
      expect(sql).toMatch(new RegExp(String.raw`REVOKE ALL ON public\.${t}\s+FROM anon, authenticated;`));
    }
  });

  it("restates the contracts' env, kind and scope sets exactly", () => {
    const keys = tableBody("dev_api_keys");
    expect(quoted(/env\s+text\s+NOT NULL CHECK \(env IN \(([^)]*)\)\)/.exec(keys)![1])).toEqual([...ENVIRONMENTS]);
    expect(quoted(/kind\s+text\s+NOT NULL CHECK \(kind IN \(([^)]*)\)\)/.exec(keys)![1])).toEqual([...API_KEY_KINDS]);
    expect(quoted(/scopes <@ ARRAY\[([^\]]*)\]/.exec(keys)![1])).toEqual([...API_KEY_SCOPES]);
    const users = tableBody("dev_end_users");
    expect(quoted(/env\s+text\s+NOT NULL CHECK \(env IN \(([^)]*)\)\)/.exec(users)![1])).toEqual([...ENVIRONMENTS]);
  });

  it("stores a hash, never a raw key, and fences publishable keys to `connect`", () => {
    const keys = tableBody("dev_api_keys");
    expect(keys).toMatch(/key_hash\s+text\s+NOT NULL UNIQUE CHECK \(key_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(keys).not.toMatch(/\b(raw_key|secret|key)\s+text/);
    expect(keys).toMatch(/kind = 'secret' OR scopes <@ ARRAY\['connect'\]/);
  });

  it("D1: end users reference no auth user; orgs are owned by one", () => {
    expect(tableBody("dev_end_users")).not.toMatch(/auth\.users/);
    expect(tableBody("dev_orgs")).toMatch(/owner_user_id\s+uuid\s+NOT NULL REFERENCES auth\.users/);
    expect(sql).toMatch(/CONSTRAINT dev_end_users_project_env_external_key UNIQUE \(project_id, env, external_user_id\)/);
  });

  it("defaults a project's api_version to the frozen contracts version", () => {
    expect(tableBody("dev_projects")).toContain(`DEFAULT '${DEVICE_SDK_API_VERSION}'`);
  });

  it("carries no backslash (the MCP SQL transport mangles them)", () => {
    expect(migration?.sql ?? "").not.toContain("\\");
  });
});
