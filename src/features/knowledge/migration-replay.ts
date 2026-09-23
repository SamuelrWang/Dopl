/**
 * The schema-sql suites' replay questions (live policies, tables, function bodies and headers) over the
 * shared loader `@/shared/supabase/migration-files` (sorted, `--` comments stripped, forward-renamed).
 * A plain module, not a `.test.ts`: importing one test file from another registers its describes twice.
 */

import { readMigrations, statementAt } from "@/shared/supabase/migration-files";

export const FILES = readMigrations();

/**
 * Policies live on `table` after the replay; later wins. `DROP TABLE` takes a table's policies with it,
 * or a dropped table would report as guarded.
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
    // Order matters within a file: a tightening migration drops and re-creates one policy name.
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
 * The live body of function `name`, or `null` if dropped. Dollar-quoted, so it is delimited by its tag,
 * not the first `;` (a `RAISE … ;` inside would truncate it).
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
 * What `read` made of the last surviving create of `name`, or `null` after a `DROP`. Both readers share
 * it so drops are honoured (F-661). `read` → `undefined` keeps the previous answer.
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
 * The live declaration of `name` (up to the body's dollar-quote), where `SECURITY DEFINER`,
 * `SET search_path` and the return type live — none of which {@link liveFunctionBody} sees.
 */
export function liveFunctionHeader(name: string): string | null {
  return replayFunction(name, (sql, at) => {
    const tag = /AS\s+\$[A-Za-z_]*\$/.exec(sql.slice(at));
    return tag && tag.index !== undefined
      ? sql.slice(at, at + tag.index)
      : sql.slice(at);
  });
}
