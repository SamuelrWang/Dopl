import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { extractUnion } from "../../../scripts/check-role-drift";
import { sqlCheckValues } from "../../../scripts/check-message-kind-drift";
import { readMigrations } from "@/shared/supabase/migration-files";

/**
 * The task CHECK sets against `@dopl/contracts › tasks.ts`. Both directions are silent at the type
 * level: a status the CHECK lacks 23514s only on a real write, and a stored value the union lacks is
 * cast into it. The zod halves are `closedEnum`, which the compiler holds.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const CONTRACTS = readFileSync(resolve(REPO_ROOT, "packages/contracts/src/tasks.ts"), "utf8");
const MIGRATION = "20261121190000_channel_tasks.sql";
const SQL = readMigrations().find((f) => f.name === MIGRATION)?.sql ?? "";

const FAMILIES = [
  { type: "TaskStatus", column: "status" },
  { type: "SubtaskState", column: "state" },
] as const;

describe("channel task CHECK sets match the contracts unions", () => {
  it("reads the migration", () => {
    expect(SQL).toContain("CREATE TABLE IF NOT EXISTS public.channel_tasks");
  });

  it.each(FAMILIES)("$type equals CHECK ($column IN …)", ({ type, column }) => {
    const union = extractUnion(CONTRACTS, type).sort();
    expect(union.length).toBeGreaterThan(0);
    expect(sqlCheckValues(SQL, column).sort()).toEqual(union);
  });

  it("no later migration redefines either constraint", () => {
    const later = readMigrations().filter(
      (f) => f.name > MIGRATION && /channel_task(s|_subtasks)_(status|state)_check/.test(f.sql)
    );
    expect(later.map((f) => f.name)).toEqual([]);
  });
});
