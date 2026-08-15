/**
 * THE COMPLETENESS GUARD — no tool may promise more than its handler returns.
 * A description saying "every" over a visibility-filtered read makes two agents
 * with different grants believe their differing counts are comparable, and
 * escalate a nonexistent server bug.
 *
 * TWO MECHANICAL GUARDS:
 *   1. THE HEADLINE RULE — a tool's first sentence is the one line every model
 *      reads before calling it, and no headline may contain a completeness
 *      word. ⚠ No allowlist: a claim needing qualification does not belong in
 *      the sentence with no room to qualify it.
 *   2. THE FILTERED-OP LEDGER — for each read op whose handler demonstrably
 *      filters (proved by scanning the tool's own source for the filter
 *      expression, so the ledger cannot describe code that is gone), the op's
 *      bullet must disclose the scope. ⚠ Bidirectional: removing a filter
 *      without updating the prose fails just as loudly, because an under-claim
 *      sends agents to a second tool they did not need.
 *
 * ⚠ PINS PROSE, NOT BEHAVIOUR. Every assertion is a string match on a
 * registered description. Whether a disclosure is TRUE is owned by the filter
 * code (`canSeeSkill` in `src/features/skills/server/service-shared.ts`,
 * `filterTeamVisibleBases` in `src/features/knowledge/server/service-bases.ts`)
 * and this suite is worthless against a change on that side.
 */

import { describe, it, expect } from "vitest";
import type { DoplClient } from "@dopl/client";

import type { RegisterTool } from "./respond";
import { toolGroupSource } from "./tool-group-files";
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
 * The `- "op" — …` bullet for one op, up to the next. `parity.test.ts` already
 * guarantees each enum op HAS a bullet, so a miss is a malformed description,
 * not a missing op — hence the throw.
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

/** Words that turn a scoped view into a promised census. */
const COMPLETENESS = /\b(every|all|complete|entire|whole|full|exhaustive)\b/i;

describe("no tool's headline claims completeness", () => {
  for (const t of TOOLS) {
    it(`${t.name}: the first sentence promises no census`, () => {
      const opening = headline(t.description);
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
    // ⚠ Scoped to the OPENING claim: "every knowledge base" is legitimate
    // further down (it is what `access_matrix` enumerates for an admin), and a
    // blanket ban would forbid the sentence that FIXES this tool.
    expect(COMPLETENESS.test(headline(d))).toBe(false);
    expect(d).not.toContain("manifest of the active workspace — every");
    // ⚠ Must point somewhere — naming the filter without naming what DOES
    // answer the question leaves the agent where it started.
    expect(d).toContain('dopl_members(op="access_matrix")');
    expect(d.toLowerCase()).toContain("not an inventory");
  });

  it("dopl_search does not claim the whole workspace, and names what it skips", () => {
    const d = tool("dopl_search").description;
    expect(d).not.toContain("Search the whole workspace");
    expect(d).toContain("CHAT ARCHIVE");
    expect(d).toContain("dopl_chats");
  });
});

// ── Guard 2: a filtered op discloses its filter ──────────────────────

/**
 * One filtered read op. ⚠ `proof` is a source expression that must still be
 * present in the tool's own files — remove the filter and the row fails, so
 * this table cannot drift into describing code that is gone. `discloses` are
 * substrings the op's bullet must carry.
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
    tool: "dopl_skill",
    op: "list",
    filter: 'status === "active" (skills-ops-read.ts) + canSeeSkill server-side',
    proof: 's.status === "active"',
    discloses: ["drafts are absent", "no grant on", "access_matrix"],
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

      // ⚠ A bullet must not promise a census of the thing it filters.
      for (const phrase of row.discloses) {
        expect(
          text.includes(phrase),
          `${row.tool}(op="${row.op}") applies ${row.filter}, but its bullet ` +
            `does not disclose it — expected to find ${JSON.stringify(phrase)} in:\n${text}`,
        ).toBe(true);
      }
    });

    it(`${row.tool}(op="${row.op}") — the filter it documents still exists in code`, () => {
      // ⚠ The direction that keeps this ledger honest: a removed filter turns
      // the prose above into a different lie, and nothing else would notice.
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
