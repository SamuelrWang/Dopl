/**
 * THE RESULT-SIDE HALF of the completeness sweep: a filtered listing must say
 * so ON THE RESULT, not only in a description the calling agent may never have
 * read closely.
 *
 * WHY BOTH HALVES. `tool-scope-claims.test.ts` pins the descriptions. A
 * description is read once, at connection time, ahead of every tool in the set;
 * a RESULT is read at the moment the agent forms the belief. The incident this
 * sweep exists for happened in the second place: two agents compared "6 skills"
 * against "1 skill" and neither output carried a word about why they could
 * differ. The footers below are what they would have hit.
 *
 * THE RULE EVERY LINE HERE OBEYS — and it is what the tests actually check:
 * a footer states the FILTER, never a count it would need a second query to
 * obtain. "Drafts are not listed" is free. "4 skills were hidden from you" is a
 * round trip on every list call, which is a worse tool than the one it fixes.
 * So `dopl_ontology(op="resolve")` and `dopl_search` DO print "showing N of M"
 * — both numbers are already in memory, the cap is applied locally — while
 * `dopl_skill(op="list")` and `dopl_kb(op="list_bases")` name the filter only.
 *
 * Driven through the real registrars with the shared harness from
 * `narration-fixtures.ts`; the @dopl/client is hand-stubbed and nothing
 * transports.
 */

import { describe, it, expect, vi } from "vitest";

import { registerSkillTools } from "./skills";
import { registerKnowledgeTools } from "./knowledge";
import { registerWorkflowTools } from "./workflow";
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
    // Naming the alternative is half the fix. Without it an agent that reads
    // "this is not the total" still has nowhere to go for the total, and the
    // most likely next move is to conclude the server is wrong — which is
    // precisely what happened.
    expect(text).toContain('dopl_members(op="access_matrix")');
  });

  it("does NOT print a hidden count — that would cost a query per list call", async () => {
    const text = await callTool(
      registerSkillTools,
      stub({ listSkills: vi.fn(async () => [SKILL, { ...SKILL, id: "sk-2", slug: "draft", status: "draft" as const }]) }),
      "dopl_skill",
      { op: "list" },
    );
    // One draft was filtered here and the footer must not quantify it: the
    // count is only knowable for the rows the SERVER already sent, never for
    // the ones its own visibility filter withheld, so a number here would be
    // right by accident and wrong the moment a private skill exists.
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
        listClusters: vi.fn(async () => ({ clusters: [] })),
        listWorkflows: vi.fn(async () => ({ workflows: [] })),
        getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
      }),
      "dopl_map",
      {},
    );

    expect(text).toContain("these counts are not workspace totals");
    expect(text).toContain('dopl_members(op="access_matrix")');
    // The fail-silent catch WAS the other half an agent could not see: a domain
    // whose read threw rendered as `_None._`, identical to a genuinely empty
    // one. Now it is named (see `partial-read.test.ts`), and the footer's job
    // here is the healthy half of that promise — no notice means every section
    // was really read, which is only worth saying if it is stated.
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
    // The pre-existing paging notice only fired when there WAS a next page, so
    // the complete case was the silent one.
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

// ─── dopl_workflow — the list and the entry-index truncation ─────────

describe("dopl_workflow carries its own scope", () => {
  it("op=list names the team filter and the trash", async () => {
    const text = await callTool(
      registerWorkflowTools,
      stub({
        listWorkflows: vi.fn(async () => ({
          workflows: [{ name: "Onboard", slug: "onboard", step_count: 2 }],
        })),
      }),
      "dopl_workflow",
      { op: "list" },
    );
    expect(text).toContain("Workflows you can read");
    expect(text).toContain("not the workspace's workflow count");
  });

  it("op=get no longer announces a total it then truncates", async () => {
    // 60 indexed entries, 50 rendered. The header read `Entries (60)` and then
    // listed 50 with nothing between them — a count and a list that disagreed,
    // in the same block, with no way to tell which was the answer.
    const entries = Array.from({ length: 60 }, (_, i) => ({
      entry_id: `e-${i}`,
      title: `Entry ${i}`,
      folder_path: null,
    }));
    const text = await callTool(
      registerWorkflowTools,
      stub({
        getWorkflow: vi.fn(async () => ({
          id: "wf-1",
          slug: "onboard",
          name: "Onboard",
          description: null,
          cluster_id: null,
          updated_at: "2026-08-01T00:00:00Z",
          graph: { nodes: [], edges: [] },
          knowledge_bases: [
            {
              knowledge_base_id: "kb-1",
              slug: "notes",
              name: "Notes",
              description: null,
              entries_index: entries,
            },
          ],
          skills: [],
        })),
      }),
      "dopl_workflow",
      { op: "get", slug: "onboard" },
    );

    expect(text).toContain("Entries (60 indexed)");
    expect(text).toContain("Listing 50 of 60 INDEXED entries");
    // And it must point at the surface that DOES have the base's contents,
    // because the index is capped server-side before it ever gets here.
    expect(text).toContain('dopl_kb(op="get_tree", base="notes")');
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
      listWorkflows: vi.fn(async () => ({ workflows: [] })),
      getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
    });

  it("marks a capped group, and states the metadata-only matching + archive gap", async () => {
    const text = await callTool(registerSearchTool, searchStub(12), "dopl_search", {
      query: "ship",
    });

    expect(text).toContain("Showing 8 of 12 matching skills");
    expect(text).toContain("Scope: max 8 per group");
    expect(text).toContain("CHAT ARCHIVE is not searched at all");
    // The fail-silent catch: a broken group still shows "No matches" (failing
    // the whole search over one dead domain is the worse tool), but it is named
    // now — so the footer can say a group NOT named there was really searched.
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
