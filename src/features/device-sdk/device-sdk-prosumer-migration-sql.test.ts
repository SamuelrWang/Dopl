/**
 * `20261122900000_device_sdk_prosumer_migration.sql` read as text (W1.1, Plans/Dopl SDK Split §8).
 * The live replay of the functions (migrate → idempotent → flag → legacy revoke → revert, and the
 * anon/authenticated refusals) is `server/rls-redteam-device-migration.test.ts` in CI.
 */
import { describe, expect, it } from "vitest";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";
import { EVEN_G2_ADAPTER_VERSION } from "./adapters/even-g2";
import { tierGrants } from "./server/connect/scopes";

const FILE = "20261122900000_device_sdk_prosumer_migration.sql";
const migrations = readMigrations();
const migration = migrations.find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");

const FUNCTIONS = [
  "migrate_prosumer_device(uuid, uuid)",
  "revert_sdk_device(uuid)",
  "sdk_delivery_state(uuid)",
  "set_sdk_delivery(uuid, boolean)",
] as const;

/** The body between `CREATE OR REPLACE FUNCTION public.<name>(` and its closing `$function$;`. */
function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  const end = sql.indexOf("$function$;", start);
  return sql.slice(start, end);
}

describe("device SDK prosumer migration", () => {
  it("exists and sorts after the devices, connect and internal-orgs migrations", () => {
    expect(migration, FILE).toBeDefined();
    const names = migrations.map((m) => m.name);
    for (const before of [
      "20261122200000_device_sdk_devices.sql",
      "20261122400000_device_sdk_connect.sql",
      "20261122800000_device_sdk_internal_orgs.sql",
    ]) {
      expect(names.indexOf(FILE), before).toBeGreaterThan(names.indexOf(before));
    }
  });

  it("🔒 keeps prosumer XOR SDK: never drops or rewrites devices_owner_shape_check", () => {
    expect(sql).not.toMatch(/DROP CONSTRAINT[^;]*devices_owner_shape_check/i);
    expect(sql).not.toMatch(/ALTER TABLE public\.devices[^;]*(DROP|ADD) CONSTRAINT/i);
    // Every owner flip is one UPDATE that sets all four owner columns at once.
    const migrate = fnBody("migrate_prosumer_device");
    expect(migrate).toMatch(/SET user_id = NULL,\s+project_id = p_project_id,\s+env = 'live',\s+end_user_id = v_end_user/);
    const revert = fnBody("revert_sdk_device");
    expect(revert).toMatch(/SET user_id = v_user,\s+project_id = NULL,\s+env = NULL,\s+end_user_id = NULL/);
  });

  it("🔒 migrate refuses any project that is not an internal org's", () => {
    expect(fnBody("migrate_prosumer_device")).toMatch(
      /FROM public\.dev_projects p\s+JOIN public\.dev_orgs o ON o\.id = p\.org_id\s+WHERE p\.id = p_project_id\s+AND o\.internal;\s+IF NOT FOUND THEN\s+RAISE EXCEPTION/
    );
  });

  it("keeps the device id (no re-pair): the devices row and credential use the link's id and hash", () => {
    const migrate = fnBody("migrate_prosumer_device");
    expect(migrate).toMatch(/VALUES \(v_link\.id, 'device_token', v_link\.token_hash\)/);
    expect(migrate).toMatch(/WHERE d\.id = v_link\.id;/);
    // The legacy app table is never written by migrate or revert.
    for (const f of ["migrate_prosumer_device", "revert_sdk_device"]) {
      expect(fnBody(f)).not.toMatch(/UPDATE public\.glasses_device_links/);
      expect(fnBody(f)).not.toMatch(/DELETE FROM public\.glasses_device_links/);
    }
  });

  it("the mirror insert matches the A3 backfill's adapter version", () => {
    expect(fnBody("migrate_prosumer_device")).toContain(`'${EVEN_G2_ADAPTER_VERSION}'`);
  });

  it("the connection grant's tier_grants equal connect/scopes.ts › tierGrants of its scopes", () => {
    const migrate = fnBody("migrate_prosumer_device");
    const scopes = /ARRAY\[([^\]]+)\]::text\[\],\s+'(\{[^']+\})'::jsonb/.exec(migrate);
    if (!scopes) throw new Error("no granted_scopes / tier_grants literal");
    const list = scopes[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
    expect(JSON.parse(scopes[2])).toEqual(tierGrants(list));
  });

  it("revert revokes the SDK credential and connections and clears the flag on the last device", () => {
    const revert = fnBody("revert_sdk_device");
    expect(revert).toMatch(/UPDATE public\.connections c\s+SET status = 'revoked', revoked_at = now\(\)/);
    expect(revert).toMatch(/UPDATE public\.device_credentials c\s+SET revoked_at = now\(\)/);
    expect(revert).toMatch(/DELETE FROM public\.sdk_delivery_users f WHERE f\.user_id = v_user;/);
    // Only a row that came from the legacy table has a prosumer owner to return to.
    expect(revert).toMatch(/legacy_source IS DISTINCT FROM 'glasses_device_links'/);
  });

  it("🔒 the flag is never read alone: state requires a live migrated device", () => {
    const state = fnBody("sdk_delivery_state");
    expect(state).toMatch(/EXISTS \(SELECT 1 FROM public\.sdk_delivery_users f WHERE f\.user_id = p_user_id\)\s+AND EXISTS \(SELECT 1 FROM migrated\)/);
    for (const clause of [/WHERE o\.internal/, /d\.revoked_at IS NULL/, /c\.kind = 'device_token' AND c\.revoked_at IS NULL/, /c\.status = 'active'/]) {
      expect(state).toMatch(clause);
    }
    expect(fnBody("set_sdk_delivery")).toMatch(/IF p_on THEN\s+IF cardinality\(\(SELECT s\.device_ids FROM public\.sdk_delivery_state\(p_user_id\) s\)\) = 0 THEN\s+RAISE EXCEPTION/);
  });

  it("🔒 a legacy revoke / token change / delete reaches the SDK copy (trigger)", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER glasses_device_links_sdk_sync\s+AFTER UPDATE OF token_hash, revoked_at OR DELETE ON public\.glasses_device_links\s+FOR EACH ROW/
    );
    const sync = fnBody("glasses_device_links_sdk_sync");
    expect(sync).toMatch(/UPDATE public\.device_credentials c SET revoked_at = NEW\.revoked_at/);
    expect(sync).toMatch(/UPDATE public\.connections c SET status = 'revoked', revoked_at = NEW\.revoked_at/);
    expect(sync).toMatch(/IF TG_OP = 'DELETE' THEN\s+DELETE FROM public\.devices d WHERE d\.id = OLD\.id;/);
    // Prosumer rows are a no-op: only an SDK-shaped legacy mirror is touched.
    expect(sync).toMatch(/AND d\.user_id IS NULL\s+AND d\.legacy_source = 'glasses_device_links'/);
  });

  it("🔒 every function is SECURITY INVOKER with a pinned search_path", () => {
    for (const f of [...FUNCTIONS.map((s) => s.slice(0, s.indexOf("("))), "glasses_device_links_sdk_sync"]) {
      const body = fnBody(f);
      expect(body, f).toMatch(/SECURITY INVOKER/);
      expect(body, f).not.toMatch(/SECURITY DEFINER/);
      expect(body, f).toMatch(/SET search_path = public, pg_temp/);
    }
  });

  it("🔒 EXECUTE: revoked from PUBLIC, anon, authenticated; granted to service_role only", () => {
    for (const f of [...FUNCTIONS, "glasses_device_links_sdk_sync()"]) {
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(sql, `${f} ${role}`).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM ${role};`);
      }
    }
    for (const f of FUNCTIONS) expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role;`);
    expect(sql).not.toMatch(/GRANT [^;]*TO (anon|authenticated|PUBLIC)/);
  });

  it("🔒 the flag table is service role only (RLS on, no policy)", () => {
    expect(sql).toMatch(/ALTER TABLE public\.sdk_delivery_users ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/REVOKE ALL ON public\.sdk_delivery_users FROM anon, authenticated;/);
    expect(sql).toMatch(/GRANT ALL ON public\.sdk_delivery_users TO service_role;/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });

  it("carries no backslash (the MCP SQL transport mangles them)", () => {
    expect(migration?.sql ?? "").not.toContain("\\");
  });
});
