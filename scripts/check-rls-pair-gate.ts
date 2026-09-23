/**
 * The pair gate: every `canSee*` TS predicate has a policy twin, and every covered table's SELECT
 * surface is exactly the one declared here. Four checks:
 *  1. the discovered `canSee*` exports EQUAL the declared set (a new predicate fails until declared);
 *  2. RLS is still enabled on every covered table after replay (a `DISABLE` keeps every name);
 *  3. the live SELECT-policy set EQUALS the declared set — permissive policies are OR-ed, so an
 *     extra one widens the table while every declared one still passes;
 *  4. each declared policy is `FOR SELECT` and reaches its predicate function (`via`).
 * It does not claim predicate and policy AGREE — the per-table redteam suites prove that (F-523).
 * The replay is `shared/supabase/rls-policy-scan.ts`: forward-renamed, and a `DROP TABLE` takes
 * its policies with it (F-586). A covered table may have no predicate (`predicates: []`): fenced
 * by a parent's rule, or by none in TS.
 * Run: `npx tsx scripts/check-rls-pair-gate.ts`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { livePolicies, liveRlsEnabled } from "../src/shared/supabase/rls-policy-scan";

const ROOT = process.cwd();

interface Covered {
  /** The `canSee*` predicates that fence these rows. `[]` = fenced by a parent,
   *  or by no TS predicate at all. */
  predicates: string[];
  /** EVERY SELECT policy this table may carry → the predicate function its
   *  `USING` clause must reach. The map is exhaustive: a live SELECT policy
   *  absent from it fails the gate. */
  select: Record<string, string>;
}

/** One declaration, keyed by table. `canSeeBaseRow` is a hand copy of `canSeeBase` (F-278) and
 *  shares its table. */
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
    // Two permissive policies, OR-ed. `chats_member_select_public` was the leak
    // `20260716150000` replaced; never re-add it.
    select: {
      chats_owner_select: "dopl_chat_readable",
      chats_member_select: "dopl_chat_readable",
    },
  },
  chat_messages: {
    predicates: [],
    select: { chat_messages_select: "dopl_chat_readable" },
  },
  agent_identities: {
    predicates: ["canSeeIdentity"],
    select: {
      agent_identities_member_select: "can_current_user_read_agent_identity",
    },
  },
  agent_identity_knowledge_bases: {
    predicates: [],
    select: {
      agent_identity_knowledge_bases_member_select:
        "can_current_user_read_agent_identity",
    },
  },
  // ── ontology: only the parent has a predicate; the child tables reach the cluster through
  // `ontology_memberships` and end at the parent's function. Each policy keeps its workspace
  // `viewer` arm (this only ever widens). The `*_editor_*` write policies are not declared: check 3
  // counts `FOR SELECT` only, and their `editor` SELECT arm is subsumed by `viewer`.
  ontology_clusters: {
    predicates: ["canSeeOntology"],
    select: { ontology_clusters_member_select: "dopl_ontology_readable" },
  },
  ontology_objects: {
    predicates: [],
    select: { ontology_objects_member_select: "dopl_ontology_readable" },
  },
  ontology_memberships: {
    predicates: [],
    select: { ontology_memberships_member_select: "dopl_ontology_readable" },
  },
  ontology_relationships: {
    predicates: [],
    select: { ontology_relationships_member_select: "dopl_ontology_readable" },
  },
  ontology_channel_shares: {
    // The share row is the owner's settings (read in the owner's container); a channel reaches
    // the ontology through SECURITY DEFINER `dopl_ontology_readable`. `via` = the membership helper.
    predicates: [],
    select: {
      ontology_channel_shares_member_select: "is_current_workspace_member",
    },
  },
  // ── revisions: the predicate defers to the resource's own rule, as `dopl_revision_readable`'s
  // `CASE` does, so `via` names the deferring function. No write policy: writes are REVOKED from
  // the login roles (an audit log a subject can edit is not one).
  revisions: {
    predicates: ["canSeeRevision"],
    select: { revisions_member_select: "dopl_revision_readable" },
  },
  resource_grants: {
    // No TS twin: the grant table every other policy resolves through; its rule is the policy.
    predicates: [],
    select: { resource_grants_member_select: "is_current_workspace_member" },
  },
};

// `knowledge_entry_chunks` is deliberately absent (F-575): RLS on with no policy fails closed.
// Its policy lands with the reader it unblocks; adding a row here without one turns this red.

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

/** Exported `canSee*` predicates (function or const) across `src/`. */
function discoverPredicates(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(
      /export\s+(?:async\s+)?function\s+(canSee\w*)\s*[<(]|export\s+const\s+(canSee\w*)\s*[:=]/g
    )) {
      found.set(m[1] ?? m[2], file.slice(ROOT.length + 1));
    }
  }
  return found;
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

const policies = livePolicies();
const rlsEnabled = liveRlsEnabled();
const NEVER_DROP =
  "A policy is the record of a leak that was once possible — correct it, never drop it (tenancy risk 1).";

for (const [table, { select }] of Object.entries(COVERED)) {
  if (!rlsEnabled.has(table)) {
    problems.push(
      `${table} does not have ROW LEVEL SECURITY enabled after replaying supabase/migrations. Every policy on it is inert and every policy NAME still reads as a fence. ${NEVER_DROP}`
    );
  }

  // Equality, not containment (check 3).
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

/** `FOR SELECT` explicitly: a policy with no `FOR` clause is `FOR ALL`, a write surface too. */
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
