/**
 * **THE MIGRATION REPLAY, FOR THE KNOWLEDGE SUITES** — every migration in
 * filename (= apply) order, and the four questions the grant suites ask of the
 * FINAL state: which policies are live, which tables are, and what a function's
 * body and its DECLARATION say.
 *
 * ⚠ **SPLIT OUT OF `schema-sql.test.ts` ON 2026-09-02 AT THE 500-LINE CAP**
 * (§1: "split, do not squeeze"), when the batch-2 review added the trigger's
 * two repaired arms and the backfill's fail-safe. The seam is real: everything
 * here is HOW to read the migration directory, and both suites that import it
 * are about WHAT it says. `resource-grant-trigger.test.ts` took the validity
 * trigger with it.
 *
 * ⚠ **A PLAIN MODULE, NOT A `.test.ts`** — importing one test file from another
 * registers its `describe` blocks twice. Same arrangement, same reason, as
 * `tools/law-removed-vocabulary.ts` in the MCP package.
 *
 * ⚠ **NOT `shared/supabase/rls-policy-scan.ts`, AND THE DUPLICATION IS KNOWN.**
 * That module answers the redteam suites' questions — squashed policy bodies
 * keyed `<table>.<policy>` across every table. These answer per-TABLE questions
 * and carry `tableIsLive` / `liveFunctionHeader`, which it does not. Folding
 * them is a change to four suites and is not this one.
 *
 * ⚠ COMMENTS ARE STRIPPED LINE-WISE before matching, because these migration
 * headers QUOTE their own SQL at length — the rollback prose, the verification
 * SELECTs, the owed probe lists and, in the tightening migration, the OLD policy
 * bodies verbatim. A scan that did not strip them would pin a paragraph.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations"
);

export function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** Every migration, filename-sorted (= apply order), comments removed. */
export const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    sql: stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8")),
  }));

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

/**
 * REPLAY the migrations and answer with the policies LIVE on `table` at the end
 * — `CREATE POLICY` inserts, `DROP POLICY` removes, `DROP TABLE` takes them all,
 * later wins. That is the only reading that can tell "tightened" from
 * "tightened, and the loose one left behind beside it".
 *
 * ⚠ THE `DROP TABLE` ARM IS NOT A DETAIL: a policy is a dependency of its table
 * and dies with it silently. Without that arm this function reports the policies
 * of a table that no longer exists, which is the exact reading that would let a
 * dropped table look guarded.
 */
export function livePolicies(table: string): Map<string, string> {
  const live = new Map<string, string>();
  const create = new RegExp(
    String.raw`CREATE\s+POLICY\s+(\w+)\s+ON\s+(?:public\.)?${table}\b`,
    "gi"
  );
  const drop = new RegExp(
    String.raw`DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+(?:public\.)?${table}\b`,
    "gi"
  );
  const dropTable = new RegExp(
    String.raw`DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?${table}\b`,
    "gi"
  );
  for (const { sql } of FILES) {
    // Order matters WITHIN a file too: a tightening migration drops and
    // re-creates the same policy name in one file.
    const events: Array<{ at: number; kind: "create" | "drop" | "dropTable"; name: string }> = [];
    for (const m of sql.matchAll(create)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "create", name: m[1] });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "drop", name: m[1] });
    }
    for (const m of sql.matchAll(dropTable)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "dropTable", name: "" });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "dropTable") live.clear();
      else if (e.kind === "drop") live.delete(e.name);
      else live.set(e.name, statementAt(sql, e.at));
    }
  }
  return live;
}

/** Does `table` exist at the end of the replay? */
export function tableIsLive(table: string): boolean {
  let live = false;
  const create = new RegExp(
    String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?${table}\b`,
    "gi"
  );
  const drop = new RegExp(
    String.raw`DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?${table}\b`,
    "gi"
  );
  for (const { sql } of FILES) {
    const events: Array<{ at: number; alive: boolean }> = [];
    for (const m of sql.matchAll(create)) {
      if (m.index !== undefined) events.push({ at: m.index, alive: true });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) events.push({ at: m.index, alive: false });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) live = e.alive;
  }
  return live;
}

/**
 * The body of the LAST `CREATE OR REPLACE FUNCTION <name>` in apply order, or
 * `null` if a later `DROP FUNCTION` retired it. ⚠ The body is dollar-quoted, so
 * it is delimited by its own opening tag rather than by the first `;` — a
 * `RAISE … ;` inside would otherwise truncate it two lines in.
 */
export function liveFunctionBody(name: string): string | null {
  return replayFunction(name, (sql, at) => {
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at));
    if (!tag || tag.index === undefined) return undefined;
    const open = at + tag.index + tag[0].length;
    const close = sql.indexOf(tag[1], open);
    return close === -1 ? sql.slice(open) : sql.slice(open, close);
  });
}

/**
 * Replay every `CREATE OR REPLACE` / `DROP FUNCTION` for `name` in apply order
 * and return what `read` made of the LAST surviving create — or `null` if a
 * `DROP` came after it.
 *
 * ⚠ **SHARED BECAUSE THE TWO READERS DISAGREED (2026-09-02, F-661).**
 * `liveFunctionHeader` scanned only for creates, so a function this wave
 * DROPPED still reported a header and every "is it gone" assertion written
 * against it was green by construction. The create/drop ordering is the whole
 * of "as the replay leaves it" and there must be one copy of it.
 *
 * ⚠ `read` returning `undefined` means *"this create is unreadable"* — the
 * previous answer stands. Returning `null` is not available to it: only a DROP
 * retires a function.
 */
function replayFunction(
  name: string,
  read: (sql: string, at: number) => string | undefined
): string | null {
  let live: string | null = null;
  const create = new RegExp(
    String.raw`CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?${name}\s*\(`,
    "gi"
  );
  const drop = new RegExp(
    String.raw`DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?${name}\s*\(`,
    "gi"
  );
  for (const { sql } of FILES) {
    const events: Array<{ at: number; kind: "create" | "drop" }> = [];
    for (const m of sql.matchAll(create)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "create" });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "drop" });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "drop") {
        live = null;
        continue;
      }
      live = read(sql, e.at) ?? live;
    }
  }
  return live;
}

/**
 * The DECLARATION of `name` as the replay leaves it — everything between
 * `CREATE OR REPLACE FUNCTION` and the body's opening dollar-quote.
 *
 * ⚠ A DIFFERENT QUESTION FROM {@link liveFunctionBody}, which answers only what
 * is INSIDE the quotes. `SECURITY DEFINER`, `SET search_path` and the return
 * type all live out here, so the body scan cannot see them — and a `CREATE OR
 * REPLACE` in a later migration that dropped `SECURITY DEFINER` would leave
 * every body assertion green.
 *
 * ⚠ **AND IT IGNORED `DROP FUNCTION` UNTIL 2026-09-02 (F-661)** — it scanned
 * for creates alone, so a dropped function still reported the header of its
 * last create and `expect(liveFunctionHeader(fn)).toBeNull()` could not fail.
 * Both readers share {@link replayFunction} now, which is the only copy of the
 * ordering rule.
 */
export function liveFunctionHeader(name: string): string | null {
  return replayFunction(name, (sql, at) => {
    const tag = /AS\s+\$[A-Za-z_]*\$/.exec(sql.slice(at));
    return tag && tag.index !== undefined
      ? sql.slice(at, at + tag.index)
      : sql.slice(at);
  });
}
