/**
 * RESULT-SIDE half of the completeness sweep: a filtered listing must say so ON
 * THE RESULT. `tool-scope-claims.test.ts` pins the descriptions — read once at
 * connection time — while a RESULT is read at the moment the agent forms the
 * belief, which is where the harm happens.
 *
 * ⚠ THE RULE: a footer states the FILTER, never a count needing a second query.
 * "Drafts are not listed" is free; "4 skills were hidden from you" is a round
 * trip on every list call. So `dopl_ontology(op="resolve")` and `dopl_search`
 * DO print "showing N of M" (both numbers already in memory, cap applied
 * locally) while `dopl_skill(op="list")` / `dopl_kb(op="list_bases")` name the
 * filter only.
 */

import { describe, it, expect, vi } from "vitest";

import { registerSkillTools } from "./skills";
import { registerKnowledgeTools } from "./knowledge";
import { registerOntologyTool } from "./ontology";
import { registerMapTool } from "./map";
import { registerSearchTool } from "./search";
import { callTool, stub } from "./narration-fixtures";

// ─── Fixtures ────────────────────────────────────────────────────────

const SKILL = {
  id: "sk-1",
  slug: "ship-it",
  name: "Ship it",
  description: "Ships things.",
  whenToUse: "When shipping.",
  whenNotToUse: null,
  status: "active" as const,
  visibility: "public" as const,
  accessMode: "workspace" as const,
  folder: null,
};

const BASE = {
  id: "kb-1",
  slug: "notes",
  name: "Notes",
  description: null,
  visibility: "public" as const,
};

const OBJECT = (i: number) => ({
  id: `o-${i}`,
  name: `Lead ${i}`,
  subtitle: "a lead",
  childIds: [],
  attributes: [],
  relationships: [],
  methods: [],
  template: [],
});

/** A snapshot with `n` objects that all match "lead". */
function ontologyWith(n: number) {
  const objects: Record<string, ReturnType<typeof OBJECT>> = {};
  for (let i = 1; i <= n; i++) objects[`o-${i}`] = OBJECT(i);
  return { clusters: [], objects };
}

// ─── dopl_skill(op="list") — the op at the centre of the incident ─────

describe("dopl_skill(op='list') carries its own scope", () => {
  it("names both filters and the tool that answers the broader question", async () => {
    const text = await callTool(
      registerSkillTools,
      stub({ listSkills: vi.fn(async () => [SKILL]) }),
      "dopl_skill",
      { op: "list" },
    );

    expect(text).toContain("Showing 1 skill: active, and visible to you.");
    expect(text).toContain("Drafts and other members' private or team-scoped skills are not listed");
    // ⚠ Naming the alternative is half the fix — without it an agent that
    // reads "this is not the total" has nowhere to go, and concludes the
    // server is wrong.
    expect(text).toContain('dopl_members(op="access_matrix")');
  });

  it("does NOT print a hidden count — that would cost a query per list call", async () => {
    const text = await callTool(
      registerSkillTools,
      stub({ listSkills: vi.fn(async () => [SKILL, { ...SKILL, id: "sk-2", slug: "draft", status: "draft" as const }]) }),
      "dopl_skill",
      { op: "list" },
    );
    // ⚠ The footer must not QUANTIFY the filter: a count is knowable only for
    // rows the server already sent, never for ones its visibility filter
    // withheld, so a number is right by accident and wrong as soon as a private
    // skill exists.
    expect(text).not.toMatch(/\d+\s+(hidden|skills? (are|is) hidden|more skills)/i);
    expect(text).toContain("Showing 1 skill");
  });

  it("the EMPTY case stops asserting the workspace has no skills", async () => {
    const text = await callTool(
      registerSkillTools,
      stub({ listSkills: vi.fn(async () => []) }),
      "dopl_skill",
      { op: "list" },
    );
    expect(text).not.toContain("No active skills in this workspace yet");
    expect(text).toContain("No active skills visible to you");
    expect(text).toContain("not proof the workspace has none");
  });
});

// ─── dopl_map — the tool the agents actually compared ────────────────

describe("dopl_map carries its own scope", () => {
  it("says the counts are not workspace totals and names the inventory", async () => {
    const text = await callTool(
      registerMapTool,
      stub({
        listKbBases: vi.fn(async () => [BASE]),
        listSkills: vi.fn(async () => [SKILL]),
        getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
      }),
      "dopl_map",
      {},
    );

    expect(text).toContain("these counts are not workspace totals");
    expect(text).toContain('dopl_members(op="access_matrix")');
    // ⚠ A domain whose read THREW renders as `_None._`, identical to a
    // genuinely empty one — so it is named (`partial-read.test.ts`), and this
    // pins the healthy half: no notice means every section was really read.
    expect(text).toContain("a domain that could not be read is named in a PARTIAL READ notice");
    expect(text).toContain("with no such notice every section above was read");
  });
});

// ─── dopl_kb — bases, tree, search, trash ────────────────────────────

describe("dopl_kb listings carry their own scope", () => {
  it("op=list_bases names the visibility filter, not a count", async () => {
    const text = await callTool(
      registerKnowledgeTools,
      stub({ listKbBases: vi.fn(async () => [BASE]) }),
      "dopl_kb",
      { op: "list_bases" },
    );
    expect(text).toContain("Bases you can READ");
    expect(text).toContain("not the workspace's base count");
    expect(text).not.toMatch(/\d+\s+hidden/i);
  });

  it("op=get_tree says what is complete and what is excluded, even with no next page", async () => {
    const text = await callTool(
      registerKnowledgeTools,
      stub({
        listKbBases: vi.fn(async () => [BASE]),
        getKbTree: vi.fn(async () => ({
          base: { ...BASE, agentWriteEnabled: true },
          folders: [],
          entries: [],
          entryTotal: 0,
          nextEntryCursor: null,
        })),
      }),
      "dopl_kb",
      { op: "get_tree", base: "notes" },
    );
    // ⚠ The paging notice fires only when there IS a next page, so the complete
    // case is the silent one.
    expect(text).toContain("Folders complete");
    expect(text).toContain("entries complete for this base");
  });

  it("op=search says a short result list is not an answer", async () => {
    const text = await callTool(
      registerKnowledgeTools,
      stub({
        listKbBases: vi.fn(async () => [BASE]),
        searchKb: vi.fn(async () => [
          { entryId: "e-1", title: "A note", snippet: "hit", rank: 0.5 },
        ]),
      }),
      "dopl_kb",
      { op: "search", query: "note" },
    );
    expect(text).toContain("ranked SAMPLE");
    expect(text).toContain("not proof of absence");
  });

});

// ─── dopl_ontology(op="resolve") — a cap that printed nothing ────────

describe("dopl_ontology(op='resolve') admits its cap", () => {
  it("prints showing N of M when it truncates — both numbers are already in hand", async () => {
    const text = await callTool(
      registerOntologyTool,
      stub({ getOntology: vi.fn(async () => ontologyWith(25)) }),
      "dopl_ontology",
      { op: "resolve", query: "lead" },
    );
    expect(text).toContain("Showing 20 of 25 matches");
  });

  it("says nothing when it did not truncate — no noise on the common path", async () => {
    const text = await callTool(
      registerOntologyTool,
      stub({ getOntology: vi.fn(async () => ontologyWith(3)) }),
      "dopl_ontology",
      { op: "resolve", query: "lead" },
    );
    expect(text).not.toContain("Showing");
  });

  it("the miss message no longer claims op=map shows everything", async () => {
    const text = await callTool(
      registerOntologyTool,
      stub({ getOntology: vi.fn(async () => ontologyWith(0)) }),
      "dopl_ontology",
      { op: "resolve", query: "nothing-matches-this" },
    );
    expect(text).not.toContain('op="map" shows everything');
    expect(text).toContain("two levels, not the whole graph");
    expect(text).toContain("SUBSTRING match");
  });
});

// ─── dopl_search — four domains, three of them metadata-only ─────────

describe("dopl_search carries its own scope", () => {
  const searchStub = (skillCount: number) =>
    stub({
      searchKb: vi.fn(async () => []),
      listSkills: vi.fn(async () =>
        Array.from({ length: skillCount }, (_, i) => ({
          ...SKILL,
          id: `sk-${i}`,
          slug: `ship-${i}`,
          name: `ship ${i}`,
        })),
      ),
      getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
    });

  it("marks a capped group, and states the metadata-only matching + archive gap", async () => {
    const text = await callTool(registerSearchTool, searchStub(12), "dopl_search", {
      query: "ship",
    });

    expect(text).toContain("Showing 8 of 12 matching skills");
    expect(text).toContain("Scope: max 8 per group");
    expect(text).toContain("CHAT ARCHIVE is not searched at all");
    // ⚠ A broken group still shows "No matches" (failing the whole search over
    // one dead domain is worse), but it must be NAMED — that is what lets the
    // footer say a group not named there was really searched.
    expect(text).toContain('A group whose read failed still shows "No matches"');
    expect(text).toContain("named in a PARTIAL READ notice opening this line");
  });

  it("does not mark a group that did not hit the cap", async () => {
    const text = await callTool(registerSearchTool, searchStub(2), "dopl_search", {
      query: "ship",
    });
    expect(text).not.toContain("matching skills.");
    expect(text).toContain("Scope: max 8 per group");
  });
});
