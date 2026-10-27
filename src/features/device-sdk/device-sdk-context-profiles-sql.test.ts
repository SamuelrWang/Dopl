/**
 * `20261122500000_device_sdk_context_profiles.sql` read as text (no database: the live replay is
 * CI's `rls-redteam` job, INVARIANTS §14). Pins: `context_profiles` columns + FK + versioning,
 * `dev_actions` idempotency key and closed sets equal to the frozen contracts, service-role-only RLS.
 */
import { describe, expect, it } from "vitest";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";
import { livePolicies, liveRlsEnabled } from "@/shared/supabase/rls-policy-scan";
import { ACTION_STATUSES, ENVIRONMENTS } from "./types";
import { DELIVER_INTENTS } from "@dopl/contracts/device-sdk";

const FILE = "20261122500000_device_sdk_context_profiles.sql";
const migration = readMigrations().find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");

function table(name: string) {
  const m = new RegExp(String.raw`CREATE TABLE IF NOT EXISTS public\.${name} \(([\s\S]*?)\n\);`).exec(sql);
  const body = m ? m[1] : "";
  const columns = body
    .split("\n")
    .map((l) => /^\s{2}([a-z_]+)\s+/.exec(l)?.[1])
    .filter((c): c is string => Boolean(c) && c !== "CONSTRAINT");
  const column = (c: string) => body.split("\n").find((l) => new RegExp(String.raw`^\s{2}${c}\s`).test(l)) ?? "";
  return { body, columns, column };
}
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("device SDK context profiles migration", () => {
  it("exists", () => expect(migration, FILE).toBeDefined());

  it("context_profiles: project FK, env, match/body jsonb objects, version, active, timestamps", () => {
    const t = table("context_profiles");
    expect(t.columns).toEqual(["id", "project_id", "env", "profile_id", "match", "body", "version", "active", "created_at", "updated_at"]);
    expect(t.column("project_id")).toMatch(/uuid\s+NOT NULL REFERENCES public\.dev_projects \(id\) ON DELETE CASCADE/);
    expect(quoted(/env IN \(([^)]*)\)/.exec(t.column("env"))![1])).toEqual([...ENVIRONMENTS]);
    for (const c of ["match", "body"]) expect(t.column(c)).toMatch(/jsonb\s+NOT NULL CHECK \(jsonb_typeof\(\w+\) = 'object'/);
    expect(t.column("version")).toMatch(/CHECK \(version >= 1\)/);
    expect(t.column("active")).toMatch(/boolean\s+NOT NULL DEFAULT true/);
    expect(t.body).toMatch(/UNIQUE \(project_id, env, profile_id, version\)/);
  });

  it("dev_actions: one row per idempotency key, closed sets equal the contracts", () => {
    const t = table("dev_actions");
    expect(t.body).toMatch(/UNIQUE \(project_id, env, idempotency_key\)/);
    expect(quoted(/status IN \(([^)]*)\)/.exec(t.column("status"))![1])).toEqual([...ACTION_STATUSES]);
    expect(quoted(/intent IN \(([^)]*)\)/.exec(t.column("intent"))![1])).toEqual([...DELIVER_INTENTS]);
    expect(t.column("request_hash")).toMatch(/\{64\}/);
    expect(t.column("route_decision")).toMatch(/jsonb/);
    expect(sql.replace(/\s+/g, " ")).toContain("ON public.dev_actions (project_id, env, created_at DESC)");
  });

  it("does not create A4's tables", () => {
    for (const t of ["connections", "connect_sessions", "dev_webhook_outbox"]) {
      expect(sql).not.toMatch(new RegExp(String.raw`CREATE TABLE[^;]*public\.${t}\b`));
    }
  });

  it("🔒 RLS on and NO policy after the replay (service role only)", () => {
    for (const t of ["context_profiles", "dev_actions"]) {
      expect(liveRlsEnabled().has(t)).toBe(true);
      expect([...livePolicies().keys()].filter((k) => k.startsWith(`${t}.`))).toEqual([]);
      expect(sql).toMatch(new RegExp(String.raw`REVOKE ALL ON public\.${t}\s+FROM anon, authenticated;`));
    }
  });

  it("carries no backslash (the MCP SQL transport mangles them)", () => {
    expect(migration?.sql ?? "").not.toContain("\\");
  });
});
