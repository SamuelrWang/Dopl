/**
 * A migration that re-stamps a parent's `workspace_id` must re-stamp every child that
 * denormalises it (F-664). Two checks:
 *  1. every migration that re-stamps a parent carries an `UPDATE <child> … SET workspace_id`;
 *  2. the declared child set EQUALS the one discovered from the `CREATE TABLE` bodies (equality,
 *     not containment, so a new child cannot ship unnoticed).
 * It proves nothing about data (the repair migration's own `DO` block does).
 * Run: `npx tsx scripts/check-tenancy-move-gate.ts`
 */

import { readMigrations } from "../src/shared/supabase/migration-files";

/** Tables whose `workspace_id` IS the tenancy (`workspaces` has an `id`, not one). A third parent
 *  is a judgement check 2 cannot make: add it here when a row type gains tenancy-copying children. */
const PARENTS = ["knowledge_bases", "agent_identities"] as const;
type Parent = (typeof PARENTS)[number];

/** Child table → the parent it derives `workspace_id` from. `agent_identity_knowledge_bases` has
 *  two parents; it follows the IDENTITY (an attached base may live in another container). */
const DERIVES_FROM: Record<string, Parent> = {
  knowledge_folders: "knowledge_bases",
  knowledge_entries: "knowledge_bases",
  knowledge_entry_chunks: "knowledge_bases",
  agent_identity_knowledge_bases: "agent_identities",
};

/** Tables that reference a parent and carry a `workspace_id` without copying its tenancy, each
 *  with the reason. */
const NOT_DERIVED: Record<string, string> = {
  // Filed under the RESOURCE's container; the caller reaches it through the SCOPE's.
  resource_grants: "filed under the resource's container by rule, not copied",
  cluster_knowledge_bases: "keyed on the cluster, which has its own tenancy",
};

/** An applied migration is never edited, so a move that shipped without its children is
 *  discharged by a named later repair — checked, not trusted: the repair must re-stamp every
 *  child. History, not an escape hatch: an unshipped migration fixes itself instead. */
const REPAIRED_BY: Record<string, string> = {
  "20260920120000_workspace_kind_personal.sql":
    "20260924120000_personal_container_child_rows.sql",
};

// Forward-renamed (`shared/supabase/migration-renames.ts`): a renamed table reads under its final
// name in every file.
const sources = new Map(readMigrations().map((f) => [f.name, f.sql]));

const problems: string[] = [];

/* ── check 2: the declared child set is the discovered one ── */

/** `CREATE TABLE` bodies, last definition wins, dropped tables removed. */
function createdTables(): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const sql of sources.values()) {
    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi
    )) {
      let depth = 0;
      let end = m.index + m[0].length - 1;
      for (let i = end; i < sql.length; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      bodies.set(m[1], sql.slice(m.index, end + 1));
    }
    for (const m of sql.matchAll(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi
    )) {
      bodies.delete(m[1]);
    }
  }
  return bodies;
}

const discovered = new Map<string, Parent>();
for (const [table, body] of createdTables()) {
  if (!/\bworkspace_id\b/i.test(body)) continue;
  for (const parent of PARENTS) {
    if (new RegExp(String.raw`REFERENCES\s+(?:public\.)?${parent}\s*\(`, "i").test(body)) {
      // First match wins: discovery asks "copies a tenancy at all", `DERIVES_FROM` says which.
      if (!discovered.has(table)) discovered.set(table, parent);
    }
  }
}

for (const [table, parent] of discovered) {
  if (table in NOT_DERIVED) continue;
  if (!(table in DERIVES_FROM)) {
    problems.push(
      `${table} carries a workspace_id and references ${parent}, but is not declared in DERIVES_FROM. Say which parent it copies its tenancy from — or add it to NOT_DERIVED with the reason it does not.`
    );
  }
}
for (const table of Object.keys(DERIVES_FROM)) {
  if (!discovered.has(table)) {
    problems.push(
      `${table} is declared in DERIVES_FROM but no longer exists (or no longer carries a workspace_id) after replaying supabase/migrations. Delete the entry in the change that dropped it.`
    );
  }
}

/* ── check 1: a move of a parent moves its children ── */

/** Does `sql` carry an `UPDATE <table> … SET … workspace_id =`? */
function restamps(sql: string, table: string): boolean {
  const re = new RegExp(
    String.raw`UPDATE\s+(?:public\.)?${table}\b[\s\S]{0,400}?\bSET\b[\s\S]{0,200}?\bworkspace_id\s*=`,
    "i"
  );
  return re.test(sql);
}

for (const [name, sql] of sources) {
  const repair = REPAIRED_BY[name];
  const repairSql = repair === undefined ? null : sources.get(repair);
  if (repair !== undefined && repairSql === undefined) {
    problems.push(
      `${name} names ${repair} as its child repair, and no such migration exists. Delete the REPAIRED_BY entry or restore the file.`
    );
  }
  for (const parent of PARENTS) {
    if (!restamps(sql, parent)) continue;
    for (const [child, from] of Object.entries(DERIVES_FROM)) {
      if (from !== parent) continue;
      if (restamps(sql, child)) continue;
      if (repairSql && restamps(repairSql, child)) continue;
      problems.push(
        `${name} re-stamps ${parent}.workspace_id but not ${child}.workspace_id. A child left on the old tenancy is invisible to every list read and 500s the first time something compares the two (F-664) — add the UPDATE to this migration, derived from the parent.`
      );
    }
  }
}

if (problems.length > 0) {
  console.error("Tenancy move gate FAILED:\n");
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

console.log(
  `Tenancy move gate OK — ${Object.keys(DERIVES_FROM).length} child tables declared over ` +
    `${PARENTS.length} tenancy parents; every migration that re-stamps a parent re-stamps its children.`
);
