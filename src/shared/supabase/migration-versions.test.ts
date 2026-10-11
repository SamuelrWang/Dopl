/**
 * **TWO MIGRATIONS MAY NOT CLAIM ONE VERSION.**
 *
 * `schema_migrations` is keyed by the version stamp, not the filename, so a
 * duplicate is not a tidiness problem: recording one file marks the other
 * APPLIED, and the second one's statements never run. The schema then differs
 * from the migration set with nothing failing anywhere — a column the code
 * expects simply does not exist in prod.
 *
 * ⚠ **THIS CLASS HAS ALREADY BITTEN THIS REPO ONCE.** `migrations-held.test.ts`
 * says so in its own words: two files at `20260901120000` "took the replay job
 * down the first time it ever ran". That suite then guarded the version stamp
 * only ACROSS `migrations/` and `migrations-held/`. Nothing guarded it WITHIN
 * `migrations/`, which is the common case and the one that reaches prod.
 *
 * ⚠ **WHY IT RECURS, AND WHY A TEST IS THE ONLY FIX.** A version is picked by
 * looking at the directory and taking the next free slot. That read is correct
 * when a branch is cut and stale by the time it merges, because the slot was
 * taken on main in the meantime. Nobody is careless; the information expires.
 * Found 2026-10-11 on `silent-drop-fix`, whose own tip commit — "give the new
 * migration a version no other file claims" — had already fixed this once, and
 * landed on a SECOND collision for exactly this reason.
 *
 * ⚠ **md5 DOES NOT CATCH IT.** A rename leaves the bytes identical, so a
 * byte-exact check on the file passes while the version is wrong. The only
 * thing that distinguishes the two files is the name this suite reads.
 */

import { describe, expect, it } from "vitest";

import { HELD_MIGRATIONS_DIR, readMigrationTexts } from "./migration-files";

/** `20261120120000_launch_directive_requested_by_agent.sql` -> `20261120120000`.
 *  Twin of the helper in `migrations-held.test.ts`; kept local so this suite
 *  does not reach into that one's scope. */
const versionOf = (name: string) => name.split("_")[0];

/** Versions mapped to every filename claiming them, for `dir`. */
function byVersion(dir?: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { name } of readMigrationTexts(dir)) {
    const v = versionOf(name);
    out.set(v, [...(out.get(v) ?? []), name]);
  }
  return out;
}

const report = (dupes: Array<[string, string[]]>) =>
  dupes
    .map(([v, names]) => `  ${v} claimed by ${names.length}: ${names.join(", ")}`)
    .join("\n");

describe("migration version stamps are unique", () => {
  it("🔒 no two files in `supabase/migrations/` share a version stamp", () => {
    const groups = byVersion();
    const dupes = [...groups].filter(([, names]) => names.length > 1);

    // ⚠ CONTROL: a mis-rooted loader would return an empty directory and this
    // suite would pass having read nothing. Assert it saw a real migration set
    // BEFORE asserting the absence, so a vacuous pass is impossible.
    expect(groups.size, "read no migrations at all — the loader is mis-rooted").toBeGreaterThan(50);

    expect(
      dupes.length,
      `duplicate migration version(s):\n${report(dupes)}\n` +
        `\`schema_migrations\` is keyed by VERSION and holds one row per stamp, so ` +
        `applying one of these marks the other applied and its statements never run. ` +
        `Re-stamp the newer file to a slot nothing claims.`
    ).toBe(0);
  });

  it("🔒 no two files in `supabase/migrations-held/` share a version stamp either", () => {
    // A held file is released by moving it into `migrations/`, so a collision
    // inside the hold is the same bug with a delay on it.
    const groups = byVersion(HELD_MIGRATIONS_DIR);
    const dupes = [...groups].filter(([, names]) => names.length > 1);
    expect(groups.size, "read no held migrations — the loader is mis-rooted").toBeGreaterThan(0);
    expect(dupes.length, `duplicate HELD migration version(s):\n${report(dupes)}`).toBe(0);
  });
});
