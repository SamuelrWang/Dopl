/**
 * The migration directory as the text-scanning gates read it: filename-sorted (= apply order),
 * `--` comments stripped, and (via {@link readMigrations}) forward-renamed
 * (`./migration-renames.ts`). One loader, so every replay answers under the same rules.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { forwardRenamed, type MigrationText } from "./migration-renames";

const SUPABASE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase");

export const MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations");
export const HELD_MIGRATIONS_DIR = join(SUPABASE_DIR, "migrations-held");

/** Line-wise: a `--` inside a string literal also truncates its line. */
export function stripSqlLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** The statement starting at `from`, up to the first `;` at paren depth 0. */
export function statementAt(sql: string, from: number): string {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (sql[i] === ";" && depth === 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

/** Every `.sql` in `dir`, sorted, comments stripped, names as written (no rename pass). */
export function readMigrationTexts(dir: string = MIGRATIONS_DIR): MigrationText[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: stripSqlLineComments(readFileSync(join(dir, name), "utf8")),
    }));
}

/** The replay input: {@link readMigrationTexts}, forward-renamed. */
export function readMigrations(dir: string = MIGRATIONS_DIR): MigrationText[] {
  return forwardRenamed(readMigrationTexts(dir));
}
