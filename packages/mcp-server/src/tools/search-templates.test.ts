/**
 * `dopl_search`'s FOURTH group — agent templates (Samuel's ruling Q6,
 * 2026-08-28). "Use my research agent" is exactly the reference the find
 * requirement is about, so a find surface that cannot find a template the user
 * names by nickname is the requirement half-met.
 *
 * ⚠ Three things this suite pins that a fourth group is easy to get wrong:
 *   1. The group COUNT moved with the reads — a stale denominator makes the
 *      partial-read notice claim more coverage than the call had.
 *   2. The group matches NAME + DESCRIPTION only, never `instructions`. That
 *      omission is deliberate: the instructions block is a system prompt another
 *      member wrote, and folding it into the haystack lets one member's prose
 *      decide which identity a stranger's agent surfaces.
 *   3. The "what this does not cover" sentence MOVED WITH the group. Widening
 *      the domain axis without widening the disclaimer is how a scoped search
 *      starts reading as a census.
 */

import { describe, it, expect, vi } from "vitest";

import { registerSearchTool } from "./search";
import { callTool, stub } from "./narration-fixtures";

const TEMPLATE = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "ws-1",
  name: "Research agent",
  description: "Digs up sources.",
  instructions: "SECRETWORD lives only in here.",
  model: null,
  fields: [],
  visibility: "workspace" as const,
  teamIds: [],
  knowledgeBases: [],
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const searchStub = (templates: unknown[], over: Record<string, unknown> = {}) =>
  stub({
    searchKb: vi.fn(async () => []),
    listSkills: vi.fn(async () => []),
    getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
    listAgentTemplates: vi.fn(async () => templates),
    ...over,
  });

describe("dopl_search finds agent templates", () => {
  it("matches on the NAME the user would say, and hands back the id to read it", async () => {
    const text = await callTool(
      registerSearchTool,
      searchStub([TEMPLATE]),
      "dopl_search",
      { query: "research agent" },
    );
    expect(text).toContain("## Agent templates");
    expect(text).toContain("`Research agent`");
    expect(text).toContain("`11111111-1111-4111-8111-111111111111`");
    // ⚠ Visibility rides the row for the same reason the ambiguity refusal
    // carries it: it is what makes two same-named hits distinguishable.
    expect(text).toContain("workspace");
  });

  it("matches on the DESCRIPTION too", async () => {
    const text = await callTool(
      registerSearchTool,
      searchStub([TEMPLATE]),
      "dopl_search",
      { query: "sources" },
    );
    expect(text).toContain("`Research agent`");
  });

  it("NEVER matches on the instructions block, and the footer says so", async () => {
    const text = await callTool(
      registerSearchTool,
      searchStub([TEMPLATE]),
      "dopl_search",
      { query: "SECRETWORD" },
    );
    const group = text.slice(text.indexOf("## Agent templates"));
    expect(group).toContain("_No matches._");
    expect(text).toContain("inside a template's instructions is not findable here");
  });

  it("asks for BOTH shelves — a find surface must not need the shelf up front", async () => {
    const list = vi.fn(async () => []);
    await callTool(
      registerSearchTool,
      searchStub([], { listAgentTemplates: list }),
      "dopl_search",
      { query: "x" },
    );
    expect(list).toHaveBeenCalledWith();
  });

  it("marks a CAPPED template group, the same way the other groups do", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...TEMPLATE,
      id: `t-${i}`,
      name: `Research agent ${i}`,
    }));
    const text = await callTool(
      registerSearchTool,
      searchStub(many),
      "dopl_search",
      { query: "research" },
    );
    expect(text).toContain("Showing 8 of 12 matching agent templates");
  });

  it("a FAILED template read is NAMED, and the denominator says FOUR groups", async () => {
    // ⚠ The group still renders "No matches" (one dead domain must not fail the
    // search), so the notice is the only thing separating "asked, nothing" from
    // "could not ask".
    const text = await callTool(
      registerSearchTool,
      searchStub([], {
        listAgentTemplates: vi.fn(async () => {
          throw Object.assign(new Error("HTTP 500"), {
            name: "DoplApiError",
            status: 500,
          });
        }),
      }),
      "dopl_search",
      { query: "research" },
    );
    expect(text).toContain("Agent templates (`HTTP 500`)");
    expect(text).toContain("1 of 4 groups could NOT be read");
  });

  it("the description advertises FOUR domains and routes to dopl_agent", async () => {
    let description = "";
    registerSearchTool(
      ((name: string, d: string) => {
        if (name === "dopl_search") description = d;
      }) as never,
      stub({}),
    );
    expect(description).toContain("FOUR domains");
    expect(description).toContain('dopl_agent(op="get")');
    expect(description).not.toContain("THREE domains");
    // ⚠ **THE CLAIM IS PINNED, NOT THE SENTENCE (A14, 2026-09-02).** It used to
    // read "agent templates are matched on names and short metadata only" —
    // one of four clauses enumerating what each group matches on. The house
    // style states the same limit ONCE and from the other direction ("only
    // ENTRIES match on bodies"), which is shorter and strictly more
    // informative: it tells the agent what the exception IS rather than
    // repeating the rule per group. What must not weaken is the consequence,
    // and that is what these two assert — a term living only inside a template
    // is not findable here.
    expect(description).toContain("only ENTRIES match on bodies");
    expect(description).toContain("INSTRUCTIONS");
  });
});
