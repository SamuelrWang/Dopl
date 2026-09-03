/**
 * 🔒 **THE CHILDREN FOLLOW THE ROW** — a migration that re-stamps a parent's
 * `workspace_id` must re-stamp every child that denormalises it (F-664).
 *
 * ⚠ **THE DEFECT THIS EXISTS TO CATCH, AND IT SHIPPED.**
 * `20260920120000_workspace_kind_personal.sql` moved every personal knowledge
 * base and agent template into its author's container with two
 * `UPDATE … SET workspace_id` statements, and left `knowledge_folders`,
 * `knowledge_entries`, `knowledge_entry_chunks` and
 * `agent_template_knowledge_bases` stamped with the OLD tenancy. Nothing
 * compares the two until a caller resolves a path inside the moved base
 * (`path.ts › assertSameWorkspace`), so the move measured as clean and the
 * contents of one base were unreadable — F-604's shape a second time.
 * `20260924120000_personal_container_child_rows.sql` is the repair; this is
 * what stops the third time.
 *
 * TWO CHECKS, and the second is the one that survives a new table:
 *
 *   1. **EVERY MIGRATION THAT RE-STAMPS A PARENT RE-STAMPS ITS CHILDREN.** Not
 *      "mentions them" — carries an `UPDATE <child> … SET workspace_id`.
 *   2. **THE DECLARED CHILD SET EQUALS THE DISCOVERED ONE**, per parent, derived
 *      from the `CREATE TABLE` bodies in `supabase/migrations`. Equality, not
 *      containment — the same argument `check-rls-pair-gate.ts` makes about its
 *      policy map: a subset check is how the fifth child ships unnoticed, and
 *      the fifth child is exactly what this gate is for.
 *
 * ⚠ **IT PROVES NOTHING ABOUT DATA.** A statement being present is not a
 * statement being correct; `20260924120000`'s own `DO` block is what asserts
 * zero stragglers after a replay, and `personal-container-schema.test.ts` is
 * what asserts the repair is derived from the PARENT rather than recomputed.
 * Say it that way in any doc that cites this.
 *
 * Run: `npx tsx scripts/check-tenancy-move-gate.ts`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/**
 * The tables whose `workspace_id` IS the tenancy — a move of one of these is a
 * tenancy change, and everything hanging off it has to follow.
 *
 * ⚠ `workspaces` itself is absent: it has no `workspace_id`, it has an `id`.
 * ⚠ A THIRD PARENT belongs here the day a row type gains children that copy its
 * tenancy; check 2 will not tell you (it only measures the parents named here),
 * so the addition is a judgement and this comment is where it is recorded.
 */
const PARENTS = ["knowledge_bases", "agent_templates"] as const;
type Parent = (typeof PARENTS)[number];

/**
 * Child table → the parent it derives its `workspace_id` from.
 *
 * ⚠ `agent_template_knowledge_bases` HAS TWO PARENTS AND ONLY ONE OF THEM IS
 * THIS ONE. It references `knowledge_bases` as well, but the junction is the
 * TEMPLATE's attachment list — that is the key `repository-knowledge-links.ts`
 * reads and writes it by — and an attached base may legitimately live in
 * another container, because an attachment is a reference and not a copy. So
 * the ambiguity is resolved HERE, once, rather than by whichever `UPDATE` a
 * future migration happens to write.
 */
const DERIVES_FROM: Record<string, Parent> = {
  knowledge_folders: "knowledge_bases",
  knowledge_entries: "knowledge_bases",
  knowledge_entry_chunks: "knowledge_bases",
  agent_template_knowledge_bases: "agent_templates",
};

/**
 * Tables that reference a parent and carry a `workspace_id`, yet do NOT copy the
 * parent's tenancy — each with the reason, because an unexplained absence from
 * {@link DERIVES_FROM} is indistinguishable from an oversight.
 */
const NOT_DERIVED: Record<string, string> = {
  // A grant row is filed under the RESOURCE's container while the caller
  // reaches it through the SCOPE's (`20260914120000` rule 3), and
  // `dopl_grant_admits` has no `workspace_id` term for exactly that reason.
  resource_grants: "filed under the resource's container by rule, not copied",
  // A cluster's membership row is the CLUSTER's, and a cluster never moves.
  cluster_knowledge_bases: "keyed on the cluster, which has its own tenancy",
};

/**
 * 🔒 **A MIGRATION ALREADY APPLIED IN PRODUCTION IS NEVER EDITED, SO A MOVE THAT
 * SHIPPED WITHOUT ITS CHILDREN IS DISCHARGED BY A LATER FILE — NAMED HERE.**
 *
 * ⚠ **THIS MAP IS HISTORY, NOT AN ESCAPE HATCH.** One entry, and it records the
 * defect rather than excusing it: `20260920120000` applied to production on
 * 2026-09-03 (release doc §6) and moved 3 rows without their children. The
 * repair is a new file, and the gate still checks it — the exemption is only
 * accepted when the named repair actually re-stamps every child of that parent,
 * so a stale entry is a failure and not a silence.
 *
 * ⚠ **A NEW MIGRATION MAY NOT ADD ITSELF HERE.** The reason this entry exists is
 * that the file was uneditable; a file that has not shipped is editable, and the
 * fix is the `UPDATE`, in the same change, where a reader will find it.
 */
const REPAIRED_BY: Record<string, string> = {
  "20260920120000_workspace_kind_personal.sql":
    "20260924120000_personal_container_child_rows.sql",
};

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

const sources = new Map(
  files.map((name) => [name, stripComments(readFileSync(join(MIGRATIONS, name), "utf8"))])
);

const problems: string[] = [];

/* ── check 2 — the declared child set is the discovered one ────────────── */

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
      // ⚠ FIRST MATCH WINS ONLY BECAUSE `DERIVES_FROM` OVERRIDES IT BELOW — the
      // discovery half answers "does this table copy a parent's tenancy at
      // all", never "which of two parents".
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

/* ── check 1 — a move of a parent moves its children ───────────────────── */

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
      // ⚠ The exemption is CHECKED, not trusted: the named repair must carry the
      // very statement this file is missing.
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
