/**
 * THE PAIR GATE — every `canSee*` TS predicate has a NAMED policy twin.
 *
 * Wave B B7's interim guard while RLS is phased in table by table (Samuel's
 * ruling B5: "RLS is the fence"). Until a table's policy has been proved by a
 * redteam test AND the flag has run a release, the TS predicate is still the
 * fence — so the two must at least EXIST in pairs. What this catches is the
 * shape that has bitten twice already: a visibility rule that lives in TS with
 * no policy behind it at all, which is invisible until the day a read moves off
 * the service role and the table turns out to have no fence in the database.
 *
 * TWO DIRECTIONS, and the first is the one that matters:
 *
 *   1. **A NEW `canSee*` FAILS THE BUILD until it declares its twin here.** The
 *      discovered set of exported predicates must EQUAL the declared map — the
 *      same "equals, not includes" shape `tool-profile.test.ts` uses, because a
 *      subset check is how the sixth predicate ships unnoticed.
 *   2. **Every named policy must be alive after replay.** Policies are OR-ed and
 *      a `DROP` in a later migration is as load-bearing as the `CREATE`, so the
 *      check runs over the replayed final state, not over one file.
 *
 * ⚠ IT DOES NOT CLAIM THE TWO AGREE. Equality of MEANING is what the redteam
 * suites prove, per table, one table at a time (`{knowledge,skills,chats,
 * agent-templates}/server/rls-redteam.test.ts` and
 * `shared/supabase/rls-redteam-resource-grants.test.ts`). This gate proves only
 * that nothing is unpaired. Say it that way in any doc that cites it.
 *
 * ⚠ AND A COVERED TABLE NEED NOT HAVE A PREDICATE TO HAVE A ROW. Six of the ten
 * tables phases 1–2 cover are fenced by a PARENT's rule (`knowledge_folders`,
 * `knowledge_entries`, `skill_files`, `chat_messages`,
 * `agent_template_knowledge_bases`) or by no TS predicate at all
 * (`resource_grants`), so `TWINS` alone would leave them unwatched — see
 * `POLICY_ONLY`.
 *
 * Run: `npx tsx scripts/check-rls-pair-gate.ts`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/**
 * predicate → the SELECT policies that fence the same rows.
 * ⚠ `canSeeBaseRow` is a HAND COPY of `canSeeBase` (F-278) and shares its twin;
 * it disappears when the five predicates become one (B16), and this map is one
 * of the places that will notice.
 */
const TWINS: Record<string, { table: string; policies: string[] }> = {
  canSeeBase: {
    table: "knowledge_bases",
    policies: ["knowledge_bases_member_select"],
  },
  canSeeBaseRow: {
    table: "knowledge_bases",
    policies: ["knowledge_bases_member_select"],
  },
  canSeeChat: {
    table: "chats",
    // Two permissive SELECT policies, OR-ed: owner, and the team-aware member
    // arm. ⚠ `chats_member_select_public` is NOT in this list and must not be
    // re-added: `20260716150000_chats_team_aware_rls.sql` REPLACED it — the
    // public arm was the leak that migration exists to record.
    policies: ["chats_owner_select", "chats_member_select"],
  },
  canSeeSkill: { table: "skills", policies: ["skills_member_select"] },
  canSeeTemplate: {
    table: "agent_templates",
    policies: ["agent_templates_member_select"],
  },
};

/**
 * COVERED TABLE -> its SELECT policies, for the tables no `canSee*` names.
 *
 * ⚠ THE SECOND DIRECTION OF THE CHECK IS WHAT THESE ARE FOR. A child table
 * fenced by its parent's rule has no predicate of its own, so nothing in
 * `TWINS` would notice its policy being dropped — and a child policy is exactly
 * where the 2026-08-26 entry-body leak lived (INVARIANTS §4). `resource_grants`
 * has no TS twin for a different reason: it is the GRANT table every other
 * policy resolves the teams axis through, and its own read rule was written as
 * a policy first.
 */
const POLICY_ONLY: Record<string, string[]> = {
  knowledge_folders: ["knowledge_folders_member_select"],
  knowledge_entries: ["knowledge_entries_member_select"],
  skill_files: ["skill_files_member_select"],
  chat_messages: ["chat_messages_select"],
  agent_template_knowledge_bases: ["agent_template_knowledge_bases_member_select"],
  resource_grants: ["resource_grants_member_select"],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/** Exported `canSee*` predicates across `src/`. */
function discoverPredicates(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/export function (canSee[A-Za-z0-9_]*)\s*\(/g)) {
      found.set(m[1], file.slice(ROOT.length + 1));
    }
  }
  return found;
}

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** `<table>.<policy>` alive after replaying every migration in apply order. */
function livePolicies(): Set<string> {
  const live = new Set<string>();
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const name of files) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8"));
    const events: Array<{ at: number; run: () => void }> = [];
    for (const m of sql.matchAll(
      /CREATE\s+POLICY\s+"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi
    )) {
      const key = `${m[2]}.${m[1]}`;
      events.push({ at: m.index, run: () => live.add(key) });
    }
    for (const m of sql.matchAll(
      /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi
    )) {
      const key = `${m[2]}.${m[1]}`;
      events.push({ at: m.index, run: () => live.delete(key) });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) e.run();
  }
  return live;
}

const problems: string[] = [];
const predicates = discoverPredicates();
const declared = new Set(Object.keys(TWINS));

for (const [name, file] of predicates) {
  if (!declared.has(name)) {
    problems.push(
      `${name} (${file}) has no declared policy twin. Add it to TWINS in scripts/check-rls-pair-gate.ts, naming the SELECT policy that fences the same rows — or say in the entry why the table has none.`
    );
  }
}
for (const name of declared) {
  if (!predicates.has(name)) {
    problems.push(
      `${name} is declared in TWINS but no longer exists in src/. Delete the entry in the same change that deleted the predicate.`
    );
  }
}

const live = livePolicies();
const NEVER_DROP =
  "A policy is the record of a leak that was once possible — correct it, never drop it (tenancy risk 1).";

for (const [name, twin] of Object.entries(TWINS)) {
  if (!predicates.has(name)) continue;
  for (const policy of twin.policies) {
    if (!live.has(`${twin.table}.${policy}`)) {
      problems.push(
        `${name}'s twin ${twin.table}.${policy} is not alive after replaying supabase/migrations. ${NEVER_DROP}`
      );
    }
  }
}
for (const [table, policies] of Object.entries(POLICY_ONLY)) {
  for (const policy of policies) {
    if (!live.has(`${table}.${policy}`)) {
      problems.push(
        `${table}.${policy} — an RLS-covered table's SELECT policy — is not alive after replaying supabase/migrations. ${NEVER_DROP}`
      );
    }
  }
}

if (problems.length > 0) {
  console.error("RLS pair gate FAILED:\n");
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

const coveredTables = new Set([
  ...Object.values(TWINS).map((t) => t.table),
  ...Object.keys(POLICY_ONLY),
]);
console.log(
  `RLS pair gate OK — ${predicates.size} canSee* predicates, each paired with a live SELECT policy, ` +
    `over ${coveredTables.size} covered tables.`
);
