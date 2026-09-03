/**
 * **THE HOLD IS A DIRECTORY, AND THIS SUITE IS WHAT MAKES IT ONE.**
 *
 * `supabase/migrations-held/` holds migrations that are finished but whose
 * precondition is not yet met (see that directory's README). The hold works
 * because `supabase db push` and `supabase db reset` read
 * `supabase/migrations/` and nothing else — so a held file cannot be applied by
 * a push, by the CI replay, or by a `db reset` on a laptop.
 *
 * ⚠ **THAT IS A FILESYSTEM FACT, NOT A PROMISE**, and it decays the moment
 * somebody copies a held file back "just to see the replay go green". The three
 * assertions below are the ratchet on it.
 *
 * ⚠ **WHY A TEST AND NOT PROSE.** The first draft of this hold was a comment at
 * the top of the held file saying DO NOT APPLY. `db push` does not read
 * comments. Neither does a hurried release.
 */

import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FILES as APPLIED } from "@/features/knowledge/migration-replay";

const HELD_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations-held"
);

const HELD = readdirSync(HELD_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** `20260923120000_drop_home_scoped.sql` -> `20260923120000`. */
const versionOf = (name: string) => name.split("_")[0];

describe("held migrations cannot be applied by accident", () => {
  it("🔒 no held file is ALSO in `supabase/migrations/` — a file in both is not held", () => {
    const applied = new Set(APPLIED.map((f) => f.name));
    for (const name of HELD) {
      expect(
        applied.has(name),
        `${name} is in BOTH migrations/ and migrations-held/. \`db push\` reads ` +
          `migrations/, so this file is APPLIED and the hold is decoration.`
      ).toBe(false);
    }
  });

  it("🔒 no held VERSION is reused by an applied file under another name", () => {
    // ⚠ Renaming a held file rather than moving it is the subtle way to defeat
    // the check above: a different basename, the same version stamp, and
    // `schema_migrations` can then only track one of them. That is the
    // duplicate-version class (two files at `20260901120000`) that took the
    // replay job down the first time it ever ran.
    const appliedVersions = new Set(APPLIED.map((f) => versionOf(f.name)));
    for (const name of HELD) {
      expect(
        appliedVersions.has(versionOf(name)),
        `${versionOf(name)} is held AND applied under a different filename — ` +
          `\`schema_migrations\` is keyed by version and can hold only one.`
      ).toBe(false);
    }
  });

  it("🔒 the hold is COMPLETE — no applied migration drops what a held one drops", () => {
    // ⚠ THE POINT OF THE HOLD IS THE COLUMN SURVIVING. If some other applied
    // file also dropped `home_scoped`, holding this one would achieve exactly
    // nothing while reading as though it achieved everything.
    for (const column of ["home_scoped"]) {
      const dropper = APPLIED.find((f) =>
        new RegExp(`DROP\\s+COLUMN\\s+(IF\\s+EXISTS\\s+)?${column}\\b`, "i").test(f.sql)
      );
      expect(
        dropper?.name,
        `${dropper?.name} drops ${column} too, so holding ` +
          `20260923120000 does not keep the column.`
      ).toBeUndefined();
    }
  });

  it("🔒 no APPLIED migration depends on a held one", () => {
    // Comment-stripped: these headers cite each other's versions in prose
    // constantly, and a citation is not a dependency. Executable SQL naming a
    // held version means the applied set assumes a drop that has not happened.
    // ⚠ STRING LITERALS ARE STRIPPED TOO, not just `--` lines. `COMMENT ON
    // FUNCTION … IS '…dropped in 20260923120000'` is prose that happens to sit
    // inside an executable statement; it is a citation, not a dependency.
    const heldVersions = HELD.map(versionOf);
    const withoutLiterals = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, "''");
    for (const file of APPLIED) {
      const sql = withoutLiterals(file.sql);
      for (const version of heldVersions) {
        expect(
          sql.includes(version),
          `${file.name} names held version ${version} in EXECUTABLE SQL — it is ` +
            `assuming a migration that has deliberately not been applied.`
        ).toBe(false);
      }
    }
  });

  it("🔒 the held set is exactly what the README documents", () => {
    // A held file nobody wrote down is a file nobody will remember to release.
    expect(HELD).toEqual(["20260923120000_drop_home_scoped.sql"]);
  });
});
