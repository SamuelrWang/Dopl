/**
 * THE COMPLETENESS GUARD — no tool may promise more than its handler returns.
 *
 * WHY THIS SUITE EXISTS, in one incident. `dopl_map`'s description opened
 * "Compact manifest of the active workspace — EVERY knowledge base, skill,
 * workflow cluster, and ontology cluster". It returns none of those four in
 * full: skills are filtered to `status === "active"` in `map.ts` itself, and
 * `listSkills` / `listWorkflows` / `listKbBases` are each visibility-filtered
 * server-side before the rows arrive. Two agents on two machines called it,
 * got "10 knowledge bases, 6 skills" against "4 KBs, 1 skill", and did
 * everything right from there: they formed a permissions hypothesis, tested it
 * with `access_matrix`, disproved it, tested workspace targeting, disproved
 * that, and escalated a confirmed server-side `dopl_map` bug to the operator.
 *
 * There was no bug. One caller was the owner; five of the six skills were
 * owner-private. Three questions, three correct answers — and one word, "every",
 * that told both agents the answers were comparable. They believed the tool.
 * That is the correct behaviour for an agent and it is the tool's job not to
 * abuse it.
 *
 * TWO GUARDS, both mechanical:
 *
 *   1. THE HEADLINE RULE. A tool's first sentence is the one line every model
 *      reads before deciding whether to call it, and it is where `dopl_map` and
 *      `dopl_search` both put their overclaim. No headline may contain a
 *      completeness word. There is no allowlist: a headline never needs one,
 *      because a claim that needs qualifying does not belong in the sentence
 *      that has no room to qualify it.
 *
 *   2. THE FILTERED-OP LEDGER. For each read op whose handler demonstrably
 *      applies a filter — proved here by scanning the tool's own source for the
 *      filter expression, so the ledger cannot quietly describe code that no
 *      longer exists — the op's bullet must disclose the scope. Bidirectional
 *      on purpose: removing a filter without updating the prose fails just as
 *      loudly as adding one, because a description that under-claims sends
 *      agents to a second tool they did not need.
 *
 * LIKE `channel-law.test.ts`, THIS PINS PROSE, NOT BEHAVIOUR. Every assertion
 * is a string match on a registered description. Whether a disclosure is TRUE
 * is checked against the code that owns each filter — `canSeeSkill` in
 * `src/features/skills/server/service-shared.ts`, `listWorkflows` in
 * `src/features/workflows/server/service.ts` — and this suite is worthless
 * against a change on that side. What it is worth is that the class cannot
 * return silently: the next "every" is a red test, not a false escalation.
 */

import { describe, it, expect } from "vitest";
import type { DoplClient } from "@dopl/client";

import type { RegisterTool } from "./respond";
import { toolGroupSource } from "./tool-group-files";
import { registerClusterTools } from "./cluster";
import { registerWorkflowTools } from "./workflow";
import { registerKnowledgeTools } from "./knowledge";
import { registerSkillTools } from "./skills";
import { registerChatTools } from "./chats";
import { registerMembersTool } from "./members";
import { registerMapTool } from "./map";
import { registerSearchTool } from "./search";
import { registerOntologyTool } from "./ontology";
import { registerChannelTool } from "./channel";

const REGISTRARS: Array<{
  file: string;
  register: (r: RegisterTool, c: DoplClient) => void;
}> = [
  { file: "cluster.ts", register: registerClusterTools },
  { file: "workflow.ts", register: registerWorkflowTools },
  { file: "knowledge.ts", register: registerKnowledgeTools },
  { file: "skills.ts", register: registerSkillTools },
  { file: "chats.ts", register: registerChatTools },
  { file: "members.ts", register: registerMembersTool },
  { file: "map.ts", register: registerMapTool },
  { file: "search.ts", register: registerSearchTool },
  { file: "ontology.ts", register: registerOntologyTool },
  { file: "channel.ts", register: registerChannelTool },
];

interface Captured {
  name: string;
  description: string;
  /** The registrar file, for the source scan that proves a filter still exists. */
  file: string;
}

function captureTools(): Captured[] {
  const tools: Captured[] = [];
  const stub = {} as DoplClient;
  for (const { file, register } of REGISTRARS) {
    const cap: RegisterTool = ((name: string, description: string) => {
      tools.push({ name, description, file });
    }) as RegisterTool;
    register(cap, stub);
  }
  return tools;
}

const TOOLS = captureTools();
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function tool(name: string): Captured {
  const t = BY_NAME.get(name);
  if (!t) throw new Error(`${name} was not registered`);
  return t;
}

/**
 * The `- "op" — …` bullet for one op, up to the next bullet. Ops are documented
 * one per line in every tool here, and `parity.test.ts` already guarantees each
 * op in the enum HAS such a bullet — so a miss is a malformed description, not
 * a missing op, and throwing says which.
 */
function bullet(toolName: string, op: string): string {
  const line = tool(toolName)
    .description.split("\n")
    .find((l) => l.trimStart().startsWith(`- "${op}"`));
  if (!line) {
    throw new Error(`${toolName}: no documented bullet for op="${op}"`);
  }
  return line;
}

/** A tool's opening claim: everything up to the first sentence break. */
function headline(description: string): string {
  const firstLine = description.split("\n")[0];
  const stop = firstLine.search(/\.(\s|$)/);
  return stop === -1 ? firstLine : firstLine.slice(0, stop + 1);
}

// ── Guard 1: the headline may not claim completeness ─────────────────

/**
 * The words that turn a scoped view into a promised census. `full` is here
 * because "full folder/entry tree" was one of the claims this sweep corrected,
 * and `whole` because "Search the whole workspace at once" was another.
 */
const COMPLETENESS = /\b(every|all|complete|entire|whole|full|exhaustive)\b/i;

describe("no tool's headline claims completeness", () => {
  for (const t of TOOLS) {
    it(`${t.name}: the first sentence promises no census`, () => {
      const opening = headline(t.description);
      // The failure message carries the sentence, because the fix is always to
      // rewrite it and the reader should not have to go find it.
      expect(
        COMPLETENESS.test(opening),
        `${t.name} opens with a completeness claim: "${opening}"\n` +
          `Every listing tool here is visibility-filtered, and several are ` +
          `status-filtered or capped on top. Say what the op returns and name ` +
          `the authoritative alternative instead.`,
      ).toBe(false);
    });
  }
});

describe("the two headlines that caused the incident stay corrected", () => {
  it("dopl_map does not say it returns every anything", () => {
    const d = tool("dopl_map").description;
    // Scoped to the OPENING claim, deliberately. The phrase "every knowledge
    // base" is legitimate further down — it is what `access_matrix` genuinely
    // enumerates for an admin, and banning the words outright would forbid the
    // sentence that FIXES this tool. What must never come back is dopl_map
    // attributing a census to itself, which is the headline's job to state.
    expect(COMPLETENESS.test(headline(d))).toBe(false);
    expect(d).not.toContain("manifest of the active workspace — every");
    // It must also point somewhere: naming the filter without naming what DOES
    // answer the question leaves the agent exactly where it started.
    expect(d).toContain('dopl_members(op="access_matrix")');
    expect(d.toLowerCase()).toContain("not an inventory");
  });

  it("dopl_search does not claim the whole workspace, and names what it skips", () => {
    const d = tool("dopl_search").description;
    expect(d).not.toContain("Search the whole workspace");
    // The archive is the domain an agent is most likely to assume is covered.
    expect(d).toContain("CHAT ARCHIVE");
    expect(d).toContain("dopl_chats");
  });
});

// ── Guard 2: a filtered op discloses its filter ──────────────────────

/**
 * One filtered read op. `proof` is a source expression that must still be
 * present in the tool's own files — remove the filter and the ledger row fails,
 * so this table can never drift into describing code that is gone. `discloses`
 * are substrings the op's bullet must carry.
 */
interface FilteredOp {
  tool: string;
  op: string;
  /** Why the op is in this ledger, for whoever the failure lands on. */
  filter: string;
  proof: string;
  discloses: string[];
}

const LEDGER: FilteredOp[] = [
  {
    // The op that was in this ledger's blind spot: its bullet used to DISCLOSE
    // an overcount ("unfiltered ... they include team-scoped workflows you
    // cannot open"), which was an honest description of a real disclosure bug.
    // The rollup is filtered server-side now (filterTeamVisibleWorkflows), so
    // the bullet states a filter like every other row here — and this row is
    // what stops it from drifting back to describing an unfiltered listing.
    tool: "dopl_cluster",
    op: "list",
    filter: "teams-mode workflows without a grant dropped from the rollup (clusters/server/service.ts)",
    proof: "client.listClusters()",
    discloses: ["YOU CAN READ", "not its total"],
  },
  {
    tool: "dopl_cluster",
    op: "get",
    filter: "same rollup filter; the cluster itself stays visible to every member",
    proof: "client.getCluster(slug)",
    discloses: ["YOU CAN READ", "empty list rather than as not-found"],
  },
  {
    tool: "dopl_skill",
    op: "list",
    filter: 'status === "active" (skills-ops-read.ts) + canSeeSkill server-side',
    proof: 's.status === "active"',
    discloses: ["drafts are absent", "no grant on", "access_matrix"],
  },
  {
    tool: "dopl_workflow",
    op: "list",
    filter: "teams-mode rows without a grant dropped (workflows/server/service.ts)",
    proof: "client.listWorkflows()",
    discloses: ["YOU CAN READ", "Team-scoped workflows", 'op="list_trash"'],
  },
  {
    tool: "dopl_workflow",
    op: "list_trash",
    filter: "trashed teams-mode workflows are invisible to grantees",
    proof: "client.listWorkflowTrash()",
    discloses: ["YOU CAN SEE"],
  },
  {
    tool: "dopl_kb",
    op: "list_bases",
    filter: "canSeeBase + filterTeamVisibleBases",
    proof: "client.listKbBases()",
    discloses: ["can READ", "private", "no grant on"],
  },
  {
    tool: "dopl_kb",
    op: "get_tree",
    filter: "TREE_ENTRY_CAP: entries paged at 400 per call",
    proof: "const TREE_ENTRY_CAP = 400",
    discloses: ["ENTRIES are paged", "400", "entry_cursor"],
  },
  {
    tool: "dopl_kb",
    op: "search",
    filter: "recall-capped RPC + post-ranking visibility drop + default limit",
    proof: "client.searchKb(query",
    discloses: ["you can read", "not an exhaustive scan", "not proof of absence"],
  },
  {
    tool: "dopl_ontology",
    op: "map",
    filter: "opMap walks clusters -> columns -> one level of childIds and stops",
    proof: "for (const columnId of c.columnIds)",
    discloses: ["TWO LEVELS ONLY", "no column"],
  },
  {
    tool: "dopl_ontology",
    op: "resolve",
    filter: "RESOLVE_CAP: hits.slice(0, 20)",
    proof: "const RESOLVE_CAP = 20",
    discloses: ["capped at 20", "NAME or SUBTITLE"],
  },
  {
    tool: "dopl_chats",
    op: "list",
    filter: "free-plan 90-day history window + owner/shared scoping",
    proof: "hiddenCount",
    discloses: ["90-day history window", "nothing is deleted", "TITLE and OVERVIEW"],
  },
  {
    tool: "dopl_members",
    op: "access_matrix",
    filter: "re-filtered to reachable resources for a non-admin",
    proof: "client.getAccessMatrix()",
    discloses: ["ADMIN OR OWNER", "NON-ADMIN", "only"],
  },
  {
    tool: "dopl_members",
    op: "my_access",
    filter: "admins/owners get an empty override list by design",
    proof: "client.getMyAccess()",
    discloses: ["NO PER-RESOURCE ROWS"],
  },
];

describe("every filtered read op discloses its filter in its own bullet", () => {
  for (const row of LEDGER) {
    it(`${row.tool}(op="${row.op}") — ${row.filter}`, () => {
      const text = bullet(row.tool, row.op);

      // A bullet must not promise a census of the thing it filters. Scoped
      // uses of these words are legitimate ("EVERY membership row, INCLUDING
      // …"), which is why the blanket ban is the headline's rule and this one
      // is the positive disclosure requirement below.
      for (const phrase of row.discloses) {
        expect(
          text.includes(phrase),
          `${row.tool}(op="${row.op}") applies ${row.filter}, but its bullet ` +
            `does not disclose it — expected to find ${JSON.stringify(phrase)} in:\n${text}`,
        ).toBe(true);
      }
    });

    it(`${row.tool}(op="${row.op}") — the filter it documents still exists in code`, () => {
      // The other direction, and the one that keeps this ledger honest: if the
      // filter is ever removed, the prose above becomes a DIFFERENT kind of
      // lie (sending agents to access_matrix for something the list op now
      // returns), and nothing else in the suite would notice.
      const source = toolGroupSource(BY_NAME.get(row.tool)!.file);
      expect(
        source.includes(row.proof),
        `${row.tool}(op="${row.op}") documents ${row.filter}, but ` +
          `${JSON.stringify(row.proof)} is gone from its source. Either the ` +
          `filter moved (update \`proof\`) or it was removed — in which case ` +
          `the description now under-claims and must be corrected too.`,
      ).toBe(true);
    });
  }
});
