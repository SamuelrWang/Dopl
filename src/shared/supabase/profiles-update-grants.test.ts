/**
 * 🔒 The `profiles` column-grant migration (applied to prod 2026-09-28) may only let users UPDATE the fields
 * the profile route itself accepts — never a billing, entitlement or identity column.
 * (Security finding, db-cleanup audit 2026-09-28.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20261110160000_profiles_update_column_grants.sql"
);
const sql = readFileSync(FILE, "utf8")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

/** `api/user/profile/route.ts › ProfilePatchSchema`'s keys. */
const USER_EDITABLE = [
  "bio",
  "display_name",
  "github_username",
  "twitter_handle",
  "website_url",
];

describe("profiles UPDATE grants", () => {
  it("revokes the table-wide write privileges from both API roles first", () => {
    expect(sql).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+public\.profiles\s+FROM\s+anon,\s*authenticated;/
    );
    expect(sql.indexOf("REVOKE")).toBeLessThan(sql.indexOf("GRANT UPDATE"));
  });

  it("grants UPDATE on exactly the user-editable columns, to authenticated only", () => {
    const m = sql.match(/GRANT\s+UPDATE\s*\(([^)]*)\)\s*ON\s+public\.profiles\s+TO\s+(\w+);/);
    expect(m).not.toBeNull();
    const cols = m![1].split(",").map((c) => c.trim()).sort();
    expect(cols).toEqual(USER_EDITABLE);
    expect(m![2]).toBe("authenticated");
  });

  it("never grants a billing, entitlement or identity column", () => {
    for (const col of [
      "stripe_customer_id",
      "stripe_subscription_id",
      "subscription_tier",
      "subscription_status",
      "subscription_period_end",
      "trial_started_at",
      "trial_expires_at",
      "email",
      "id",
      "onboarded_at",
      "mcp_connected_at",
    ]) {
      expect(sql).not.toMatch(new RegExp(`GRANT[^;]*\\b${col}\\b`));
    }
  });
});
