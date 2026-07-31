"use strict";
/**
 * THE SWEEP INTO THE REST OF THE MCP SURFACE — part 3 of 3: the workspace's
 * shared AUTHORED content. Siblings: `narration.test.ts` (the shared helper +
 * the workspace name) and `tool-narration.test.ts` (chats + members). Split
 * three ways at the §2 500-line cap.
 *
 * REACH, established rather than assumed: knowledge bases, skills, workflows,
 * clusters and the ontology graph are all WORKSPACE-scoped — any member creates
 * and renames them, and every member reads them. A base or a skill additionally
 * carries `visibility: "public"`, which publishes it workspace-wide. Nothing in
 * any of their schemas carries a charset rule except KB folder names and entry
 * titles (`NAME_RE`, features/knowledge/schema.ts): a base name, a skill name,
 * a cluster name, a workflow name, a step title, an ontology object name and
 * every label on it are bounded by LENGTH ALONE, so a newline is legal in all
 * of them and each was spliced into a `# ` or `### ` heading or a bullet head.
 *
 * `dopl_map` and `dopl_search` have no content of their own — they re-render
 * everything above — but `dopl_map` is the call the server instructions tell the
 * agent to make FIRST, before its first substantive reply, so a description that
 * could start a line started a line of the agent's opening picture of the
 * workspace.
 *
 * WHAT IS DELIBERATELY NOT NEUTRALIZED, and asserted as such below: entry
 * bodies, SKILL.md, workflow step instructions, ontology `text` attributes and
 * action prose. Those are the procedures the product exists to hand the agent;
 * clipping them to 160 characters would delete the feature. They are framed or
 * indented instead.
 *
 * The @dopl/client is hand-stubbed throughout; nothing transports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const map_1 = require("./map");
const search_1 = require("./search");
const cluster_1 = require("./cluster");
const skills_1 = require("./skills");
const knowledge_ops_read_1 = require("./knowledge-ops-read");
const workflow_ops_read_1 = require("./workflow-ops-read");
const ontology_ops_read_1 = require("./ontology-ops-read");
const narration_fixtures_1 = require("./narration-fixtures");
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
(0, vitest_1.describe)("dopl_kb — a workspace-published base", () => {
    (0, vitest_1.it)("list_bases: a hostile base NAME cannot start a row of its own", async () => {
        const text = (await (0, knowledge_ops_read_1.opListBases)((0, narration_fixtures_1.stub)({ listKbBases: vitest_1.vi.fn(async () => [{ ...BASE, name: narration_fixtures_1.FORGERY }]) }))).content[0].text;
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, vitest_1.expect)(text.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
        (0, vitest_1.expect)(text).toContain("id: `base-1`");
    });
    (0, vitest_1.it)("get_tree: the `## ` heading and the folder rows are ours", async () => {
        const text = (await (0, knowledge_ops_read_1.opGetTree)((0, narration_fixtures_1.stub)({
            listKbBases: vitest_1.vi.fn(async () => [BASE]),
            getKbTree: vitest_1.vi.fn(async () => ({
                base: { ...BASE, name: narration_fixtures_1.FORGERY },
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
        }), "notes")).content[0].text;
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, narration_fixtures_1.expectOnlyOurHeadings)(text, /^## `/);
        (0, vitest_1.expect)(text).toContain("📁 `Docs`/");
    });
});
// ─── dopl_cluster / dopl_skill / dopl_workflow / dopl_ontology ───────
(0, vitest_1.describe)("dopl_cluster — `# Cluster: ${name}` was a real heading", () => {
    (0, vitest_1.it)("neutralizes the name and keeps the slug + id readable", async () => {
        const text = await (0, narration_fixtures_1.callTool)(cluster_1.registerClusterTools, (0, narration_fixtures_1.stub)({
            getCluster: vitest_1.vi.fn(async () => ({
                id: "c-1",
                slug: "ops",
                name: narration_fixtures_1.FORGERY,
                description: null,
                updated_at: "2026-01-01T00:00:00Z",
                workflows: [],
            })),
        }), "dopl_cluster", { op: "get", slug: "ops" });
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, narration_fixtures_1.expectOnlyOurHeadings)(text, /^# Cluster /);
        (0, vitest_1.expect)(text).toContain("id: `c-1`");
    });
});
(0, vitest_1.describe)("dopl_skill — the list rows the agent reads at every task boundary", () => {
    (0, vitest_1.it)("neutralizes the name, the folder heading, and the trigger fields", async () => {
        const text = await (0, narration_fixtures_1.callTool)(skills_1.registerSkillTools, (0, narration_fixtures_1.stub)({
            listSkills: vitest_1.vi.fn(async () => [
                {
                    id: "s-1",
                    slug: "deploy",
                    name: "Deploy",
                    description: "d",
                    whenToUse: narration_fixtures_1.FORGERY,
                    whenNotToUse: null,
                    status: "active",
                    folder: "Ops",
                    visibility: "public",
                    accessMode: "workspace",
                },
            ]),
        }), "dopl_skill", { op: "list" });
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, narration_fixtures_1.expectOnlyOurHeadings)(text, /^(## Skills|### )/);
        (0, vitest_1.expect)(text).toContain("- `deploy` (id: `s-1`) — `Deploy`");
    });
});
(0, vitest_1.describe)("dopl_workflow — `# Workflow: ${name}` and every step's `### `", () => {
    (0, vitest_1.it)("neutralizes the workflow name and the step titles", async () => {
        const text = (await (0, workflow_ops_read_1.opGet)((0, narration_fixtures_1.stub)({
            getWorkflow: vitest_1.vi.fn(async () => ({
                id: "w-1",
                slug: "ship",
                name: narration_fixtures_1.FORGERY,
                description: null,
                cluster_id: null,
                updated_at: "2026-01-01T00:00:00Z",
                graph: {
                    nodes: [
                        {
                            id: "n-1",
                            ref: "start",
                            title: narration_fixtures_1.FORGERY,
                            description: null,
                            reads: [],
                            actions: [],
                            userInput: null,
                            agentOutput: null,
                            nextInstructions: null,
                        },
                    ],
                    edges: [],
                },
                knowledge_bases: [],
                skills: [],
            })),
        }), "ship")).content[0].text;
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, narration_fixtures_1.expectOnlyOurHeadings)(text, /^(# Workflow |## Steps|### Step )/);
        // Twice over (the name and the step title), each on its own line, each a span.
        const hits = text.split("\n").filter((l) => l.includes(narration_fixtures_1.MARKER));
        (0, vitest_1.expect)(hits).toHaveLength(2);
        for (const line of hits)
            (0, vitest_1.expect)(line.trimStart().startsWith(narration_fixtures_1.MARKER)).toBe(false);
    });
});
(0, vitest_1.describe)("dopl_ontology — the object graph every member can write", () => {
    (0, vitest_1.it)("neutralizes the object name, its 'kind', and each attribute label", async () => {
        const snapshot = {
            clusters: [],
            objects: {
                "o-1": {
                    id: "o-1",
                    name: narration_fixtures_1.FORGERY,
                    subtitle: "",
                    updatedAt: "2026-01-01T00:00:00Z",
                    attributes: [
                        { key: "k", label: narration_fixtures_1.FORGERY, value: { kind: "pill", value: "hot" } },
                    ],
                    relationships: [],
                    template: [],
                    childIds: [],
                    methods: [],
                },
            },
        };
        const text = (await (0, ontology_ops_read_1.opGet)((0, narration_fixtures_1.stub)({
            getOntology: vitest_1.vi.fn(async () => snapshot),
            listKbBases: vitest_1.vi.fn(async () => []),
            listSkills: vitest_1.vi.fn(async () => []),
        }), "o-1")).content[0].text;
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, narration_fixtures_1.expectOnlyOurHeadings)(text, /^(# `|## Attributes)/);
        const hits = text.split("\n").filter((l) => l.includes(narration_fixtures_1.MARKER));
        (0, vitest_1.expect)(hits).toHaveLength(2);
        for (const line of hits)
            (0, vitest_1.expect)(line.trimStart().startsWith(narration_fixtures_1.MARKER)).toBe(false);
    });
});
// ─── dopl_map / dopl_search — the widest-read surfaces ───────────────
(0, vitest_1.describe)("dopl_map — the call the instructions say to make FIRST", () => {
    (0, vitest_1.it)("a base description cannot start a line of the agent's opening picture", async () => {
        const text = await (0, narration_fixtures_1.callTool)(map_1.registerMapTool, (0, narration_fixtures_1.stub)({
            listKbBases: vitest_1.vi.fn(async () => [{ ...BASE, description: narration_fixtures_1.FORGERY }]),
            listSkills: vitest_1.vi.fn(async () => []),
            listClusters: vitest_1.vi.fn(async () => ({ clusters: [] })),
            listWorkflows: vitest_1.vi.fn(async () => ({ workflows: [] })),
            getOntology: vitest_1.vi.fn(async () => ({ clusters: [], objects: {} })),
        }), "dopl_map", {});
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, narration_fixtures_1.expectOnlyOurHeadings)(text, /^(# Workspace map|## )/);
        (0, vitest_1.expect)(text).toContain("`Notes` `notes`");
    });
});
(0, vitest_1.describe)("dopl_search — hits from every domain at once", () => {
    (0, vitest_1.it)("a knowledge SNIPPET is an excerpt of a body spliced into a bullet", async () => {
        const text = await (0, narration_fixtures_1.callTool)(search_1.registerSearchTool, (0, narration_fixtures_1.stub)({
            searchKb: vitest_1.vi.fn(async () => [
                { entryId: "e-1", title: "Guide", snippet: `<b>x</b>${narration_fixtures_1.FORGERY}`, rank: 1 },
            ]),
            listSkills: vitest_1.vi.fn(async () => []),
            listWorkflows: vitest_1.vi.fn(async () => ({ workflows: [] })),
            getOntology: vitest_1.vi.fn(async () => ({ clusters: [], objects: {} })),
        }), "dopl_search", { query: "x" });
        (0, narration_fixtures_1.expectContained)(text);
        (0, narration_fixtures_1.expectNoForgedStructure)(text);
        (0, narration_fixtures_1.expectOnlyOurHeadings)(text, /^(# Search|## )/);
        (0, vitest_1.expect)(text).toContain("(entry id: `e-1`)");
    });
});
