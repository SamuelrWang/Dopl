/**
 * THE PAIR GATE — every `canSee*` TS predicate has a policy twin, and every
 * covered table's SELECT surface is exactly the one declared here.
 *
 * Wave B B7's interim guard while RLS is phased in table by table (Samuel's
 * ruling B5: "RLS is the fence"). Until a table's policy has been proved by a
 * redteam test AND the flag has run a release, the TS predicate is still the
 * fence — so the two must at least EXIST in pairs. What this catches is the
 * shape that has bitten twice already: a visibility rule that lives in TS with
 * no policy behind it at all, which is invisible until the day a read moves off
 * the service role and the table turns out to have no fence in the database.
 *
 * FOUR CHECKS, and the first is the one this gate was built for:
 *
 *   1. **A NEW `canSee*` FAILS THE BUILD until it declares its table here.** The
 *      discovered set of exported predicates must EQUAL the declared set — the
 *      same "equals, not includes" shape `tool-profile.test.ts` uses, because a
 *      subset check is how the sixth predicate ships unnoticed.
 *   2. **RLS IS STILL ENABLED** on every covered table after replay. A
 *      `DISABLE ROW LEVEL SECURITY` retires every policy on a table at once and
 *      leaves all their names standing, which is invisible to a name check.
 *   3. **THE LIVE SELECT-POLICY SET EQUALS THE DECLARED SET**, per table.
 *      Permissive policies are OR-ed, so an EXTRA one is a widening that no
 *      per-policy assertion can see: the declared policies all still exist and
 *      still say what they said. Equality is the only reading that catches it.
 *   4. **EACH DECLARED POLICY IS `FOR SELECT` AND REACHES ITS PREDICATE.** A
 *      policy that keeps its name and becomes `USING (true)`, or flips to
 *      `FOR INSERT` (leaving the table's SELECT surface empty), passes a name
 *      check unchanged. So the `cmd` is asserted explicitly and the body must
 *      call the function named in `via`.
 *
 * ⚠ **THE FIRST THREE OF THOSE ARRIVED 2026-09-02, IN REVIEW, AND THE GATE HAD
 * SHIPPED WITHOUT THEM (F-585).** It asserted that a policy NAME survived the
 * replay and nothing else — so `USING (true)`, a second permissive policy, a
 * `DISABLE ROW LEVEL SECURITY` and a `FOR SELECT` → `FOR INSERT` flip were all
 * green. A gate whose failure mode is "the fence is still called a fence" is
 * the failure it exists to catch, one level up.
 *
 * ⚠ IT STILL DOES NOT CLAIM THE TWO AGREE. Equality of MEANING is what the
 * redteam suites prove, per table, one table at a time
 * (`{knowledge,skills,chats,agent-templates}/server/rls-redteam.test.ts` and
 * `shared/supabase/rls-redteam-resource-grants.test.ts`). This gate proves that
 * nothing is unpaired and that the SELECT surface is the declared one. Say it
 * that way in any doc that cites it.
 *
 * ⚠ AND A COVERED TABLE NEED NOT HAVE A PREDICATE. Five of the nine tables
 * phases 1–2 cover are fenced by a PARENT's rule (`knowledge_folders`,
 * `knowledge_entries`, `chat_messages`, `agent_template_knowledge_bases`) or by
 * no TS predicate at all (`resource_grants`) — hence `predicates: []`.
 *
 * ⚠ **`skill_files` IS NOT ONE OF THEM AND NEVER WAS (F-586).** It was declared
 * here and given a phase-2 policy, and the table has not existed since
 * `20260716064733_collapse_skill_files_into_skills.sql` dropped it CASCADE in
 * July 2026 — so the policy would have aborted the apply. Check 2 is what found
 * it: a `DROP TABLE`-aware replay plus "is RLS still on". A gate that reads only
 * policy NAMES cannot tell a fence from an epitaph.
 *
 * Run: `npx tsx scripts/check-rls-pair-gate.ts`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");

interface Covered {
  /** The `canSee*` predicates that fence these rows. `[]` = fenced by a parent,
   *  or by no TS predicate at all. */
  predicates: string[];
  /** EVERY SELECT policy this table may carry → the predicate function its
   *  `USING` clause must reach. The map is exhaustive: a live SELECT policy
   *  absent from it fails the gate. */
  select: Record<string, string>;
}

/**
 * ⚠ ONE DECLARATION, KEYED BY TABLE. It used to be two maps — predicate→policy
 * and table→policy — which meant the tables with a predicate and the tables
 * without were checked by different code and only one half grew the checks.
 *
 * ⚠ `canSeeBaseRow` is a HAND COPY of `canSeeBase` (F-278) and shares its
 * table; it disappears when the five predicates become one (B16), and this map
 * is one of the places that will notice.
 */
const COVERED: Record<string, Covered> = {
  knowledge_bases: {
    predicates: ["canSeeBase", "canSeeBaseRow"],
    select: { knowledge_bases_member_select: "dopl_knowledge_base_readable" },
  },
  knowledge_folders: {
    predicates: [],
    select: { knowledge_folders_member_select: "dopl_knowledge_base_readable" },
  },
  knowledge_entries: {
    predicates: [],
    select: { knowledge_entries_member_select: "dopl_knowledge_base_readable" },
  },
  skills: {
    predicates: ["canSeeSkill"],
    select: { skills_member_select: "dopl_skill_readable" },
  },
  chats: {
    predicates: ["canSeeChat"],
    // Two permissive SELECT policies, OR-ed: owner, and the team-aware member
    // arm. ⚠ `chats_member_select_public` is NOT here and must not be re-added:
    // `20260716150000_chats_team_aware_rls.sql` REPLACED it — the public arm was
    // the leak that migration exists to record. Check 3 now enforces that.
    select: {
      chats_owner_select: "dopl_chat_readable",
      chats_member_select: "dopl_chat_readable",
    },
  },
  chat_messages: {
    predicates: [],
    select: { chat_messages_select: "dopl_chat_readable" },
  },
  agent_templates: {
    predicates: ["canSeeTemplate"],
    select: {
      agent_templates_member_select: "can_current_user_read_agent_template",
    },
  },
  agent_template_knowledge_bases: {
    predicates: [],
    select: {
      agent_template_knowledge_bases_member_select:
        "can_current_user_read_agent_template",
    },
  },
  resource_grants: {
    // No TS twin, and not for a child table's reason: this is the GRANT table
    // every other policy resolves the teams axis through, and its own read rule
    // was written as a policy first. So `via` names the membership helper
    // rather than a predicate function — the rule is stated inline, here only.
    predicates: [],
    select: { resource_grants_member_select: "is_current_workspace_member" },
  },
};

// ⚠ **`knowledge_entry_chunks` IS DELIBERATELY ABSENT — F-575, still open.**
// RLS is ENABLED on it with no policy at all, which fails CLOSED: the cost is
// an EMPTY search the day a chunk read moves to `readClient()`, never a leak.
// Phase 2 briefly gave it its parent's policy and that arm was WITHDRAWN in
// review: every other change in that file narrows, this one widened a table
// from "nobody" to "every viewer", and a policy is not behind the phase flag.
// The policy lands in phase 3, in the same change as the reader it unblocks.
// ⚠ Adding a row here without a live policy is what turns this gate red.

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

/** The statement starting at `from`, to the first `;` at paren depth 0. */
function statementAt(sql: string, from: number): string {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (sql[i] === ";" && depth === 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

interface Replay {
  /** `<table>.<policy>` → the whole `CREATE POLICY` statement, after replay. */
  policies: Map<string, string>;
  /** Tables whose last `… ROW LEVEL SECURITY` statement was `ENABLE`. */
  rlsEnabled: Set<string>;
}

/**
 * REPLAY every migration in filename (= apply) order and answer with the FINAL
 * state. Policies are OR-ed and a `DROP` in a later migration is as load-bearing
 * as the `CREATE`, so nothing here may read one file.
 */
function replay(): Replay {
  const policies = new Map<string, string>();
  const rlsEnabled = new Set<string>();
  for (const name of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8"));
    const events: Array<{ at: number; run: () => void }> = [];
    for (const m of sql.matchAll(
      /CREATE\s+POLICY\s+"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi
    )) {
      const key = `${m[2]}.${m[1]}`;
      const body = statementAt(sql, m.index);
      events.push({ at: m.index, run: () => policies.set(key, body) });
    }
    for (const m of sql.matchAll(
      /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-z0-9_]+)"?/gi
    )) {
      const key = `${m[2]}.${m[1]}`;
      events.push({ at: m.index, run: () => policies.delete(key) });
    }
    // ⚠ A `DROP TABLE` takes its policies with it, silently — without this arm
    // the replay reports the policies of a table that no longer exists.
    for (const m of sql.matchAll(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi
    )) {
      const table = m[1];
      events.push({
        at: m.index,
        run: () => {
          for (const key of [...policies.keys()]) {
            if (key.startsWith(`${table}.`)) policies.delete(key);
          }
          rlsEnabled.delete(table);
        },
      });
    }
    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY/gi
    )) {
      const [, table, verb] = m;
      events.push({
        at: m.index,
        run: () =>
          verb.toUpperCase() === "ENABLE" ? rlsEnabled.add(table) : rlsEnabled.delete(table),
      });
    }
    for (const e of events.sort((a, b) => a.at - b.at)) e.run();
  }
  return { policies, rlsEnabled };
}

const problems: string[] = [];
const found = discoverPredicates();
const declaredPredicates = new Map<string, string>();
for (const [table, { predicates }] of Object.entries(COVERED)) {
  for (const name of predicates) declaredPredicates.set(name, table);
}

for (const [name, file] of found) {
  if (!declaredPredicates.has(name)) {
    problems.push(
      `${name} (${file}) has no declared policy twin. Add it to the COVERED entry for the table it fences in scripts/check-rls-pair-gate.ts, naming the SELECT policy and the predicate function that policy reaches — or say in the entry why the table has none.`
    );
  }
}
for (const name of declaredPredicates.keys()) {
  if (!found.has(name)) {
    problems.push(
      `${name} is declared in COVERED but no longer exists in src/. Delete the entry in the same change that deleted the predicate.`
    );
  }
}

const { policies, rlsEnabled } = replay();
const NEVER_DROP =
  "A policy is the record of a leak that was once possible — correct it, never drop it (tenancy risk 1).";

for (const [table, { select }] of Object.entries(COVERED)) {
  if (!rlsEnabled.has(table)) {
    problems.push(
      `${table} does not have ROW LEVEL SECURITY enabled after replaying supabase/migrations. Every policy on it is inert and every policy NAME still reads as a fence. ${NEVER_DROP}`
    );
  }

  // ⚠ EQUALITY, NOT CONTAINMENT. Permissive policies are OR-ed, so an EXTRA
  // SELECT policy widens the table while every declared one still passes.
  const liveSelect = [...policies.entries()]
    .filter(([key, body]) => key.startsWith(`${table}.`) && isSelectPolicy(body))
    .map(([key]) => key.slice(table.length + 1))
    .sort();
  const declaredSelect = Object.keys(select).sort();
  for (const name of liveSelect) {
    if (!(name in select)) {
      problems.push(
        `${table}.${name} is a live SELECT policy that COVERED does not declare. Permissive policies are OR-ed, so this widens the table's read. Declare it with the predicate it reaches, or drop it in the migration that added it.`
      );
    }
  }
  for (const name of declaredSelect) {
    if (!liveSelect.includes(name)) {
      // Either it is gone, or it is no longer a SELECT policy at all.
      const stillThere = policies.has(`${table}.${name}`);
      problems.push(
        stillThere
          ? `${table}.${name} survives but is no longer FOR SELECT, so the table's read is fenced by one policy fewer while the name still reads as a fence.`
          : `${table}.${name} — an RLS-covered table's SELECT policy — is not alive after replaying supabase/migrations. ${NEVER_DROP}`
      );
    }
  }

  for (const [name, via] of Object.entries(select)) {
    const body = policies.get(`${table}.${name}`);
    if (body === undefined || !isSelectPolicy(body)) continue; // already reported
    if (!new RegExp(String.raw`\b${via}\s*\(`).test(body)) {
      problems.push(
        `${table}.${name} no longer reaches ${via}(). A policy that keeps its name and loses its predicate is the exact shape this gate exists to catch.`
      );
    }
    if (/USING\s*\(\s*true\s*\)/i.test(body)) {
      problems.push(`${table}.${name} is USING (true) — the fence is a formality.`);
    }
  }
}

/** `FOR SELECT` explicitly. ⚠ A policy with NO `FOR` clause is `FOR ALL`, which
 *  is a WRITE surface as well as a read one and is never a declared twin. */
function isSelectPolicy(body: string): boolean {
  return /\bFOR\s+SELECT\b/i.test(body);
}

if (problems.length > 0) {
  console.error("RLS pair gate FAILED:\n");
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}

const policyCount = Object.values(COVERED).reduce(
  (n, { select }) => n + Object.keys(select).length,
  0
);
console.log(
  `RLS pair gate OK — ${found.size} canSee* predicates, each paired with a live SELECT policy, ` +
    `over ${Object.keys(COVERED).length} covered tables (${policyCount} SELECT policies, RLS on, ` +
    `each reaching its declared predicate).`
);
