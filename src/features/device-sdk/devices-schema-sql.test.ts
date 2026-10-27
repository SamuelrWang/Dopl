/**
 * `20261122200000_device_sdk_devices.sql` read as text (no SQL engine runs here without Docker; the
 * live replay is CI's `rls-redteam` job, which `db reset`s every migration). Pins what a text scan can:
 * the kind set equals the contract, the owner-shape CHECK, service-role-only RLS, the backfill's
 * idempotency guard and its version literals. The behavioural idempotency check is the manual one in
 * the migration header.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DEVICE_KINDS, ENVIRONMENTS } from "@dopl/contracts/device-sdk";
import { describe, expect, it } from "vitest";

import { livePolicies, tableIsLive } from "@/features/knowledge/migration-replay";
import { stripSqlLineComments } from "@/shared/supabase/migration-files";

import { DESKTOP_ADAPTER_ID, DESKTOP_ADAPTER_VERSION } from "./adapters/desktop";
import { EVEN_G2_ADAPTER_VERSION } from "./adapters/even-g2";

const FILE = join(__dirname, "..", "..", "..", "supabase", "migrations", "20261122200000_device_sdk_devices.sql");
const SQL = stripSqlLineComments(readFileSync(FILE, "utf8"));

const listIn = (re: RegExp) => {
  const m = SQL.match(re);
  expect(m, String(re)).not.toBeNull();
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

const backfills = () => SQL.split(/INSERT INTO public\.devices/).slice(1);

describe("devices migration (text)", () => {
  it("both tables are live after the replay, with no policy (service role only) and RLS on", () => {
    for (const t of ["devices", "device_credentials"]) {
      expect(tableIsLive(t)).toBe(true);
      expect(livePolicies(t).size).toBe(0);
      expect(SQL).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON public\\.${t} FROM anon, authenticated`));
    }
  });

  it("the kind CHECK is exactly the contract's DeviceKind set", () => {
    expect(listIn(/kind IN \(('glasses'[^)]*)\)/)).toEqual([...DEVICE_KINDS]);
  });

  it("env CHECK is the contract's Environment set", () => {
    expect(listIn(/env IN \(([^)]*)\)/)).toEqual([...ENVIRONMENTS]);
  });

  it("exactly one owner shape: user_id XOR (project_id, env, end_user_id)", () => {
    const check = SQL.match(/CONSTRAINT devices_owner_shape_check CHECK \(([\s\S]*?)\n\s*\)\n\);/)?.[1] ?? "";
    expect(check.replace(/\s+/g, " ").trim()).toBe(
      "(user_id IS NOT NULL AND project_id IS NULL AND env IS NULL AND end_user_id IS NULL) OR " +
        "(user_id IS NULL AND project_id IS NOT NULL AND env IS NOT NULL AND end_user_id IS NOT NULL)"
    );
  });

  it("SDK owner columns carry no FK yet (Lane X tables land in parallel)", () => {
    expect(SQL).toMatch(/project_id uuid NULL,/);
    expect(SQL).toMatch(/end_user_id uuid NULL,/);
    expect(SQL).not.toMatch(/REFERENCES public\.dev_/);
  });

  it("credentials are hashes only", () => {
    expect(SQL).toMatch(/hash text NOT NULL UNIQUE CHECK \(hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(SQL).not.toMatch(/INSERT INTO public\.device_credentials/);
  });

  it("backfill is idempotent: two blocks, each keyed on the source id with ON CONFLICT DO NOTHING", () => {
    const blocks = backfills();
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      expect(b).toMatch(/SELECT\s+\w\.id,/);
      expect(b).toMatch(/ON CONFLICT \(id\) DO NOTHING;/);
      expect(b).toMatch(/\w\.user_id,/);
    }
    expect(blocks[0]).toMatch(/FROM public\.glasses_device_links g/);
    expect(blocks[1]).toMatch(/FROM public\.desktop_devices d/);
  });

  it("backfill version literals equal the adapters' versions", () => {
    const [glasses, desktop] = backfills();
    expect(glasses).toContain(`'${EVEN_G2_ADAPTER_VERSION}'`);
    expect(desktop).toContain(`'${DESKTOP_ADAPTER_VERSION}'`);
    expect(desktop).toContain(`'${DESKTOP_ADAPTER_ID}'`);
  });

  it("the old tables are untouched (no behaviour change)", () => {
    expect(SQL).not.toMatch(/(ALTER|DROP|UPDATE|DELETE FROM)\s+(TABLE\s+)?public\.(glasses_device_links|desktop_devices)/i);
  });
});
