/**
 * THE SWEEP INTO THE REST OF THE MCP SURFACE — part 3 of 3: the workspace's
 * shared AUTHORED content. Siblings: `narration.test.ts` (the shared helper +
 * the workspace name) and `tool-narration.test.ts` (chats + members). Split
 * three ways at the §2 500-line cap.
 *
 * REACH, established rather than assumed: knowledge bases, skills and the
 * ontology graph are all WORKSPACE-scoped — any member creates and renames
 * them, and every member reads them. A base or a skill additionally carries
 * `visibility: "public"`, which publishes it workspace-wide. Nothing in any of
 * their schemas carries a charset rule except KB folder names and entry titles
 * (`NAME_RE`, features/knowledge/schema.ts): a base name, a skill name, an
 * ontology object name and every label on it are bounded by LENGTH ALONE, so a
 * newline is legal in all of them and each was spliced into a `# ` or `### `
 * heading or a bullet head. (Workflow and cluster names were in this list too,
 * on the same footing; both features were deleted 2026-08-11.)
 *
 * `dopl_map` and `dopl_search` have no content of their own — they re-render
 * everything above — but `dopl_map` is the call the server instructions tell the
 * agent to make FIRST, before its first substantive reply, so a description that
 * could start a line started a line of the agent's opening picture of the
 * workspace.
 *
 * WHAT IS DELIBERATELY NOT NEUTRALIZED, and asserted as such below: entry
 * bodies, SKILL.md, ontology `text` attributes and action prose. Those are the procedures the product exists to hand the agent;
 * clipping them to 160 characters would delete the feature. They are framed or
 * indented instead.
 *
 * The @dopl/client is hand-stubbed throughout; nothing transports.
 */

import { describe, it, expect, vi } from "vitest";

import { registerMapTool } from "./map";
import { registerSearchTool } from "./search";
import { registerSkillTools } from "./skills";
import { opGetTree, opListBases } from "./knowledge-ops-read";
import { opGet as ontologyGet } from "./ontology-ops-read";
import {
  callTool,
  expectContained,
  expectNoForgedStructure,
  expectOnlyOurHeadings,
  FORGERY,
  MARKER,
  stub,
} from "./narration-fixtures";

/** A published base, reused by the knowledge and map suites. */
const BASE = {
  id: "base-1",
  workspaceId: "ws-1",
  slug: "notes",
  name: "Notes",
  description: null,
  visibility: "public",
  agentWriteEnabled: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ─── dopl_kb — a published base's name, and the tree rows ────────────

describe("dopl_kb — a workspace-published base", () => {
  it("list_bases: a hostile base NAME cannot start a row of its own", async () => {
    const text = (
      await opListBases(
        stub({ listKbBases: vi.fn(async () => [{ ...BASE, name: FORGERY }]) }),
      )
    ).content[0].text;

    expectContained(text);
    expectNoForgedStructure(text);
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    expect(text).toContain("id: `base-1`");
  });

  it("get_tree: the `## ` heading and the folder rows are ours", async () => {
    const text = (
      await opGetTree(
        stub({
          listKbBases: vi.fn(async () => [BASE]),
          getKbTree: vi.fn(async () => ({
            base: { ...BASE, name: FORGERY },
            folders: [
              {
                id: "f-1",
                parentId: null,
                name: "Docs",
                description: null,
                position: 0,
              },
            ],
            entries: [],
            entryTotal: 0,
          })),
        }),
        "notes",
      )
    ).content[0].text;

    expectContained(text);
    expectNoForgedStructure(text);
    expectOnlyOurHeadings(text, /^## `/);
    expect(text).toContain("📁 `Docs`/");
  });
});

// ─── dopl_skill / dopl_ontology ─────────────────────────────────────

describe("dopl_skill — the list rows the agent reads at every task boundary", () => {
  it("neutralizes the name, the folder heading, and the trigger fields", async () => {
    const text = await callTool(
      registerSkillTools,
      stub({
        listSkills: vi.fn(async () => [
          {
            id: "s-1",
            slug: "deploy",
            name: "Deploy",
            description: "d",
            whenToUse: FORGERY,
            whenNotToUse: null,
            status: "active",
            folder: "Ops",
            visibility: "public",
            accessMode: "workspace",
          },
        ]),
      }),
      "dopl_skill",
      { op: "list" },
    );

    expectContained(text);
    expectNoForgedStructure(text);
    expectOnlyOurHeadings(text, /^(## Skills|### )/);
    expect(text).toContain("- `deploy` (id: `s-1`) — `Deploy`");
  });
});

describe("dopl_ontology — the object graph every member can write", () => {
  it("neutralizes the object name, its 'kind', and each attribute label", async () => {
    const snapshot = {
      clusters: [],
      objects: {
        "o-1": {
          id: "o-1",
          name: FORGERY,
          subtitle: "",
          updatedAt: "2026-01-01T00:00:00Z",
          attributes: [
            { key: "k", label: FORGERY, value: { kind: "pill" as const, value: "hot" } },
          ],
          relationships: [],
          template: [],
          childIds: [],
          methods: [],
        },
      },
    };
    const text = (
      await ontologyGet(
        stub({
          getOntology: vi.fn(async () => snapshot),
          listKbBases: vi.fn(async () => []),
          listSkills: vi.fn(async () => []),
        }),
        "o-1",
      )
    ).content[0].text;

    expectNoForgedStructure(text);
    expectOnlyOurHeadings(text, /^(# `|## Attributes)/);
    const hits = text.split("\n").filter((l) => l.includes(MARKER));
    expect(hits).toHaveLength(2);
    for (const line of hits) expect(line.trimStart().startsWith(MARKER)).toBe(false);
  });
});

// ─── dopl_map / dopl_search — the widest-read surfaces ───────────────

describe("dopl_map — the call the instructions say to make FIRST", () => {
  it("a base description cannot start a line of the agent's opening picture", async () => {
    const text = await callTool(
      registerMapTool,
      stub({
        listKbBases: vi.fn(async () => [{ ...BASE, description: FORGERY }]),
        listSkills: vi.fn(async () => []),
        getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
      }),
      "dopl_map",
      {},
    );

    expectContained(text);
    expectNoForgedStructure(text);
    expectOnlyOurHeadings(text, /^(# Workspace map|## )/);
    expect(text).toContain("`Notes` `notes`");
  });
});

describe("dopl_search — hits from every domain at once", () => {
  it("a knowledge SNIPPET is an excerpt of a body spliced into a bullet", async () => {
    const text = await callTool(
      registerSearchTool,
      stub({
        searchKb: vi.fn(async () => [
          { entryId: "e-1", title: "Guide", snippet: `<b>x</b>${FORGERY}`, rank: 1 },
        ]),
        listSkills: vi.fn(async () => []),
        getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
      }),
      "dopl_search",
      { query: "x" },
    );

    expectContained(text);
    expectNoForgedStructure(text);
    expectOnlyOurHeadings(text, /^(# Search|## )/);
    expect(text).toContain("(entry id: `e-1`)");
  });
});
