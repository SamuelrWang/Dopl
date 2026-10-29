/**
 * `20261123100000_device_sdk_webhook_sender.sql` read as text (no database: the live replay is CI's
 * `rls-redteam` job, INVARIANTS §14). Pins: service-role-only tables and functions, no SECURITY
 * DEFINER, secrets only in Vault (no secret column), the closed sets equal to the frozen contracts,
 * and the delivery state machine's shape.
 */
import { describe, expect, it } from "vitest";
import { ENVIRONMENTS, WEBHOOK_EVENT_NAMES } from "./types";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";
import { livePolicies, liveRlsEnabled } from "@/shared/supabase/rls-policy-scan";

const FILE = "20261123100000_device_sdk_webhook_sender.sql";
const TABLES = ["dev_webhook_endpoints", "dev_webhook_deliveries", "dev_webhook_attempts"];
const FUNCTIONS = [
  "dev_webhook_endpoints_vault_cleanup",
  "dev_webhook_create_endpoint",
  "dev_webhook_rotate_secret",
  "dev_webhook_endpoint_secrets",
  "dev_webhook_fan_out",
  "dev_webhook_claim",
  "dev_webhook_record_attempt",
  "dev_webhook_replay",
  "dev_webhook_prune_expired_secrets",
];

const migration = readMigrations().find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");

function tableBody(t: string): string {
  const m = new RegExp(String.raw`CREATE TABLE IF NOT EXISTS public\.${t} \(([\s\S]*?)\n\);`).exec(sql);
  if (!m) throw new Error(`no CREATE TABLE for ${t}`);
  return m[1];
}

function functionBody(f: string): string {
  const m = new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${f}\(([\s\S]*?)(?:\n|END )\$\$;`).exec(sql);
  if (!m) throw new Error(`no CREATE FUNCTION for ${f}`);
  return m[1];
}

const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("device SDK webhook sender migration", () => {
  it("exists and sorts after the connect migration (outbox)", () => {
    expect(migration, FILE).toBeDefined();
    const names = readMigrations().map((m) => m.name);
    expect(names.indexOf(FILE)).toBeGreaterThan(names.indexOf("20261122400000_device_sdk_connect.sql"));
  });

  it("🔒 every new table has RLS on and NO policy after the replay (service role only)", () => {
    const rls = liveRlsEnabled();
    const policies = [...livePolicies().keys()];
    for (const t of TABLES) {
      expect(rls.has(t), `${t} RLS`).toBe(true);
      expect(policies.filter((k) => k.startsWith(`${t}.`)), `${t} policies`).toEqual([]);
      expect(sql).toMatch(new RegExp(String.raw`REVOKE ALL ON public\.${t}\s+FROM anon, authenticated;`));
      expect(sql).toMatch(new RegExp(String.raw`GRANT ALL ON public\.${t}\s+TO service_role;`));
    }
  });

  it("🔒 every function is SECURITY INVOKER, search_path pinned, EXECUTE for service_role only", () => {
    expect(sql).not.toMatch(/^\s*SECURITY DEFINER\s*$/m);
    for (const f of FUNCTIONS) {
      const body = functionBody(f);
      expect(body, f).toMatch(/SECURITY INVOKER/);
      expect(body, f).toMatch(/SET search_path = ''/);
      expect(sql, `${f} in the grant loop`).toMatch(new RegExp(`'${f}'`));
    }
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.%I FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.%I TO service_role/);
  });

  it("🔒 the signing secret lives in Vault only: no secret text column anywhere", () => {
    const endpoints = tableBody("dev_webhook_endpoints");
    expect(endpoints).toMatch(/\bsecret_id\s+uuid\s+NOT NULL/);
    expect(endpoints).toMatch(/\bprevious_secret_id\s+uuid\s+NULL/);
    for (const t of TABLES) expect(tableBody(t), t).not.toMatch(/\b\w*secret\s+text\b/);
    expect(functionBody("dev_webhook_create_endpoint")).toMatch(/vault\.create_secret\(/);
    expect(functionBody("dev_webhook_rotate_secret")).toMatch(/vault\.create_secret\(/);
    expect(functionBody("dev_webhook_endpoint_secrets")).toMatch(/vault\.decrypted_secrets/);
    // A deleted endpoint (or a project cascade) takes its vault rows with it.
    expect(sql).toMatch(/AFTER DELETE ON public\.dev_webhook_endpoints/);
    expect(functionBody("dev_webhook_endpoints_vault_cleanup")).toMatch(
      /DELETE FROM vault\.secrets WHERE id IN \(OLD\.secret_id, OLD\.previous_secret_id\)/
    );
  });

  it("the previous secret signs only inside its overlap window", () => {
    expect(functionBody("dev_webhook_endpoint_secrets")).toMatch(
      /CASE WHEN e\.previous_secret_expires_at > now\(\) THEN prev\.decrypted_secret END/
    );
    expect(tableBody("dev_webhook_endpoints")).toMatch(
      /CHECK \(\(previous_secret_id IS NULL\) = \(previous_secret_expires_at IS NULL\)\)/
    );
  });

  it("closed sets equal the frozen contracts", () => {
    const endpoints = tableBody("dev_webhook_endpoints");
    const events = /enabled_events <@ ARRAY\[([\s\S]*?)\]::text\[\]/.exec(endpoints);
    expect(quoted(events?.[1] ?? "").sort()).toEqual([...WEBHOOK_EVENT_NAMES].sort());
    for (const t of ["dev_webhook_endpoints", "dev_webhook_deliveries"]) {
      const env = /env\s+text\s+NOT NULL CHECK \(env IN \(([^)]*)\)\)/.exec(tableBody(t));
      expect(quoted(env?.[1] ?? "").sort(), t).toEqual([...ENVIRONMENTS].sort());
    }
    expect(endpoints).toMatch(/url ~ '\^https:\/\/'/);
  });

  it("deliveries: one per (event, endpoint), a lease, dead-letter state", () => {
    const d = tableBody("dev_webhook_deliveries");
    expect(d).toMatch(/UNIQUE \(outbox_id, endpoint_id\)/);
    expect(d).toMatch(/status\s+text\s+NOT NULL DEFAULT 'pending' CHECK \(status IN \('pending', 'delivered', 'failed'\)\)/);
    expect(d).toMatch(/locked_until\s+timestamptz NULL/);
    expect(functionBody("dev_webhook_claim")).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(functionBody("dev_webhook_claim")).toMatch(/locked_until IS NULL OR locked_until < now\(\)/);
    expect(functionBody("dev_webhook_fan_out")).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(functionBody("dev_webhook_fan_out")).toMatch(/ON CONFLICT \(outbox_id, endpoint_id\) DO NOTHING/);
    const record = functionBody("dev_webhook_record_attempt");
    expect(record).toMatch(/WHEN p_next_attempt_at IS NULL THEN 'failed'/);
    expect(record).toMatch(/locked_until = NULL/);
    expect(functionBody("dev_webhook_replay")).toMatch(/status = 'pending', attempts = 0/);
  });

  it("attempt log is capped (response body 1 KiB, error 500)", () => {
    const a = tableBody("dev_webhook_attempts");
    expect(a).toMatch(/length\(response_body\) <= 1024/);
    expect(a).toMatch(/length\(error\) <= 500/);
    expect(a).toMatch(/UNIQUE \(delivery_id, attempt\)/);
  });

  it("🔒 a record lands only under the live claim token; replay never steals a live lease (review #3)", () => {
    expect(tableBody("dev_webhook_deliveries")).toMatch(/claim_token\s+uuid\s+NULL/);
    expect(functionBody("dev_webhook_claim")).toMatch(/claim_token = gen_random_uuid\(\)/);
    const record = functionBody("dev_webhook_record_attempt");
    expect(record).toMatch(/p_claim_token uuid/);
    expect(record).toMatch(/WHERE id = p_delivery_id AND status = 'pending' AND claim_token = p_claim_token/);
    expect(record).toMatch(/claim_token = NULL/);
    expect(functionBody("dev_webhook_replay")).toMatch(
      /AND \(status IN \('delivered', 'failed'\) OR locked_until IS NULL OR locked_until < now\(\)\)/
    );
  });

  it("an endpoint never receives events from before it existed (review #5)", () => {
    expect(functionBody("dev_webhook_fan_out")).toMatch(/AND e\.created_at <= o\.created_at/);
  });

  it("🔒 asserts vault reach: service_role only (review #4); expired previous secrets are pruned (review #9)", () => {
    expect(sql).toMatch(/has_table_privilege\('anon', 'vault\.decrypted_secrets', 'SELECT'\)/);
    expect(sql).toMatch(/has_function_privilege\('authenticated', 'vault\.create_secret\(text, text, text, uuid\)', 'EXECUTE'\)/);
    expect(sql).toMatch(/NOT has_table_privilege\('service_role', 'vault\.decrypted_secrets', 'SELECT'\)/);
    const prune = functionBody("dev_webhook_prune_expired_secrets");
    expect(prune).toMatch(/previous_secret_expires_at <= now\(\)/);
    expect(prune).toMatch(/DELETE FROM vault\.secrets WHERE id = ANY \(v_ids\)/);
  });
});
