/**
 * `20261122700000_device_sdk_device_messages.sql` read as text (no database: the live replay is CI's
 * `rls-redteam` job). Pins: the SDK lens queue has the prosumer `glasses_messages` row shape keyed by
 * `devices`, the prosumer trigger function stamps `updated_at`, and service-role-only RLS.
 */
import { describe, expect, it } from "vitest";
import { readMigrations, stripSqlLineComments } from "@/shared/supabase/migration-files";
import { livePolicies, liveRlsEnabled } from "@/shared/supabase/rls-policy-scan";

const FILE = "20261122700000_device_sdk_device_messages.sql";
const migration = readMigrations().find((m) => m.name === FILE);
const sql = stripSqlLineComments(migration?.sql ?? "");
const body = /CREATE TABLE IF NOT EXISTS public\.dev_device_messages \(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? "";
const column = (c: string) => body.split("\n").find((l) => new RegExp(String.raw`^\s{2}${c}\s`).test(l)) ?? "";
const quoted = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

describe("device SDK device messages migration", () => {
  it("exists", () => expect(migration, FILE).toBeDefined());

  it("the glasses_messages row shape, keyed by devices (cascade)", () => {
    const cols = body
      .split("\n")
      .map((l) => /^\s{2}([a-z_]+)\s+/.exec(l)?.[1])
      .filter(Boolean);
    expect(cols).toEqual(["id", "device_id", "kind", "card_id", "payload", "status", "answer", "spec", "created_at", "updated_at", "expires_at"]);
    expect(column("device_id")).toMatch(/uuid NOT NULL REFERENCES public\.devices \(id\) ON DELETE CASCADE/);
    expect(quoted(column("kind"))).toEqual(["notify", "show", "ask", "screen"]);
    expect(quoted(/status IN \(([^)]*)\)/.exec(body)![1])).toEqual(["pending", "delivered", "answered", "dismissed", "expired"]);
  });

  it("updated_at is the DB clock, via the prosumer trigger function", () => {
    expect(sql).toMatch(/BEFORE UPDATE ON public\.dev_device_messages\s+FOR EACH ROW EXECUTE FUNCTION public\.glasses_messages_touch_updated_at\(\);/);
  });

  it("🔒 RLS on and NO policy after the replay (service role only)", () => {
    expect(liveRlsEnabled().has("dev_device_messages")).toBe(true);
    expect([...livePolicies().keys()].filter((k) => k.startsWith("dev_device_messages."))).toEqual([]);
    expect(sql).toMatch(/REVOKE ALL ON public\.dev_device_messages FROM anon, authenticated;/);
  });

  it("carries no backslash (the MCP SQL transport mangles them)", () => {
    expect(migration?.sql ?? "").not.toContain("\\");
  });
});
