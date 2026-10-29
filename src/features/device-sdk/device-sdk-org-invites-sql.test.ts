/**
 * `20261123210000_device_sdk_org_invites.sql` read as text (no database: the live replay is
 * `server/rls-redteam-org-invites.test.ts` in CI's `rls-redteam` job). Pins the properties that
 * fail quietly:
 *  - 🔒 the token is stored HASHED (sha256 hex), never in clear;
 *  - 🔒 `owner` can never be an invited role;
 *  - 🔒 at most one OPEN invite per (org, email);
 *  - 🔒 service role only (RLS on, no policy, no grant to anon/authenticated).
 */
import { describe, expect, it } from "vitest";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";

const FILE = "20261123210000_device_sdk_org_invites.sql";
const migrations = readMigrations();
const migration = migrations.find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");

function tableBody(): string {
  const m = /CREATE TABLE IF NOT EXISTS public\.dev_org_invites \(([\s\S]*?)\n\);/.exec(sql);
  if (!m) throw new Error("no CREATE TABLE dev_org_invites");
  return m[1];
}

describe("device SDK org invites migration", () => {
  it("exists and sorts after the tenancy migration", () => {
    expect(migration, FILE).toBeDefined();
    const names = migrations.map((m) => m.name);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261122100000_device_sdk_tenancy.sql"));
  });

  it("🔒 stores a sha256 hex token hash, unique, and no clear token column", () => {
    const body = tableBody();
    expect(body).toMatch(/token_hash\s+text\s+NOT NULL UNIQUE CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(body).not.toMatch(/^\s*token\s/m);
  });

  it("🔒 the invited role is admin or developer, never owner", () => {
    expect(tableBody()).toMatch(/role\s+text\s+NOT NULL CHECK \(role IN \('admin', 'developer'\)\)/);
  });

  it("cascades with the org and stores the email normalised", () => {
    const body = tableBody();
    expect(body).toMatch(/org_id\s+uuid\s+NOT NULL REFERENCES public\.dev_orgs \(id\) ON DELETE CASCADE/);
    expect(body).toMatch(/email = lower\(btrim\(email\)\)/);
    expect(body).toMatch(/expires_at\s+timestamptz NOT NULL/);
  });

  it("🔒 one open invite per (org, email)", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS dev_org_invites_one_open_per_email\s+ON public\.dev_org_invites \(org_id, email\)\s+WHERE accepted_at IS NULL AND revoked_at IS NULL;/
    );
  });

  it("🔒 service role only", () => {
    expect(sql).toMatch(/ALTER TABLE public\.dev_org_invites ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/REVOKE ALL ON public\.dev_org_invites FROM anon, authenticated;/);
    expect(sql).toMatch(/GRANT ALL ON public\.dev_org_invites TO service_role;/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/GRANT [^;]*dev_org_invites[^;]*TO (anon|authenticated)/);
  });

  it("carries no backslash (the MCP SQL transport mangles them)", () => {
    expect(migration?.sql ?? "").not.toContain("\\");
  });
});
