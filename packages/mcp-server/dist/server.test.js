"use strict";
/**
 * NET-NEW (MCP-2) — createServer workspace targeting + footer.
 *
 * The SDK `McpServer` is mocked so we can capture each tool's wrapped
 * handler and drive it directly. Covers the wrapper enforcement (M-3) and
 * the mandatory-effective `_dopl_status` footer with source label (M-4)
 * across 0 / 1 / 2+ memberships, plus `buildInstructions` (M-2).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const registry = vitest_1.vi.hoisted(() => ({
    tools: new Map(),
    instructions: "",
}));
vitest_1.vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
    McpServer: class {
        constructor(_info, opts) {
            registry.instructions = opts?.instructions ?? "";
        }
        tool(name, _d, _s, handler) {
            registry.tools.set(name, handler);
        }
    },
}));
const server_js_1 = require("./server.js");
function wsItem(id, slug, name, role, description = null) {
    return {
        id,
        ownerId: "owner",
        name,
        slug,
        publicId: `pub-${id}`,
        description,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        role,
    };
}
const WS1 = wsItem("id-1", "alpha", "Alpha", "owner", "first ws");
const WS2 = wsItem("id-2", "beta", "Beta", "member", "second ws");
function mockClient(directory) {
    return {
        listWorkspaces: vitest_1.vi.fn().mockResolvedValue({ workspaces: directory }),
        getWorkspaceId: vitest_1.vi.fn(() => null),
        setWorkspaceId: vitest_1.vi.fn(),
        listKbBases: vitest_1.vi.fn().mockResolvedValue([]),
        listSkills: vitest_1.vi.fn().mockResolvedValue([]),
        listClusters: vitest_1.vi.fn().mockResolvedValue({ clusters: [] }),
        listWorkflows: vitest_1.vi.fn().mockResolvedValue({ workflows: [] }),
        getOntology: vitest_1.vi.fn().mockResolvedValue({ clusters: [], objects: {} }),
    };
}
function build(options) {
    registry.tools.clear();
    const client = mockClient(options?.directory ?? []);
    (0, server_js_1.createServer)(client, { scopes: ["dopl.read", "dopl.write"], ...options });
    const map = registry.tools.get("dopl_map");
    if (!map)
        throw new Error("dopl_map was not registered");
    return { map, client };
}
const textOf = (res) => res.content.map((c) => c.text).join("");
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)("buildInstructions (M-2)", () => {
    (0, vitest_1.it)("0 memberships → tells the agent it has none", () => {
        (0, vitest_1.expect)((0, server_js_1.buildInstructions)([])).toContain("not an active member of any workspace");
    });
    (0, vitest_1.it)("1 membership → may omit workspace=, bakes the workspace in", () => {
        const out = (0, server_js_1.buildInstructions)([WS1]);
        (0, vitest_1.expect)(out).toContain("exactly one workspace");
        (0, vitest_1.expect)(out).toMatch(/omit .*workspace=/);
        (0, vitest_1.expect)(out).toContain("`alpha`");
    });
    (0, vitest_1.it)("2+ memberships → MUST pass workspace= on every call, lists all with descriptions", () => {
        const out = (0, server_js_1.buildInstructions)([WS1, WS2]);
        (0, vitest_1.expect)(out).toContain("member of 2 workspaces");
        (0, vitest_1.expect)(out).toContain("EVERY tool call");
        (0, vitest_1.expect)(out).toContain("`alpha`");
        (0, vitest_1.expect)(out).toContain("`beta`");
        (0, vitest_1.expect)(out).toContain("second ws");
    });
    (0, vitest_1.it)("2+ memberships WITH a resolved pin → says pinned-by-default, not 'pass on every call'", () => {
        const out = (0, server_js_1.buildInstructions)([WS1, WS2], {
            pin: { name: "Beta", slug: "beta" },
        });
        (0, vitest_1.expect)(out).toContain("pinned to **Beta**");
        (0, vitest_1.expect)(out).toContain("no-arg tool call targets it");
        (0, vitest_1.expect)(out).not.toContain("NO default");
    });
    (0, vitest_1.it)("0 memberships with a transient load failure → 'couldn't load', not 'you have none'", () => {
        const out = (0, server_js_1.buildInstructions)([], { directoryLoadFailed: true });
        (0, vitest_1.expect)(out).toContain("couldn't load");
        (0, vitest_1.expect)(out).not.toContain("not an active member of any workspace");
    });
});
(0, vitest_1.describe)("no-arg call (M-3 wrapper enforcement)", () => {
    (0, vitest_1.it)("2+ memberships, no default → refuses and lists the workspaces (handler never runs)", async () => {
        const { map, client } = build({
            directory: [WS1, WS2],
            workspace: null,
            role: null,
            workspaceSource: null,
        });
        const res = await map({});
        (0, vitest_1.expect)(res.isError).toBe(true);
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain("no default workspace");
        (0, vitest_1.expect)(text).toContain("`alpha`");
        (0, vitest_1.expect)(text).toContain("`beta`");
        // The real handler must not have executed.
        (0, vitest_1.expect)(client.listKbBases).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("0 memberships, no default → refuses with a 'not a member' message", async () => {
        const { map } = build({
            directory: [],
            workspace: null,
            role: null,
            workspaceSource: null,
        });
        const res = await map({});
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(textOf(res)).toContain("not an active member of any workspace");
    });
    (0, vitest_1.it)("sole membership → runs and footers `sole membership`", async () => {
        const { map, client } = build({
            directory: [WS1],
            workspace: WS1,
            role: "owner",
            workspaceSource: "sole membership",
        });
        const res = await map({});
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        (0, vitest_1.expect)(client.listKbBases).toHaveBeenCalled();
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain('active_workspace: "Alpha"');
        (0, vitest_1.expect)(text).toContain("workspace_source: sole membership");
    });
    (0, vitest_1.it)("header pin → footers `header pin`", async () => {
        const { map } = build({
            directory: [WS1, WS2],
            workspace: WS2,
            role: "member",
            workspaceSource: "header pin",
        });
        const res = await map({});
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain('active_workspace: "Beta"');
        (0, vitest_1.expect)(text).toContain("workspace_source: header pin");
    });
});
(0, vitest_1.describe)("per-call workspace= (M-4 footer)", () => {
    (0, vitest_1.it)("resolves the ref, runs, and footers `per-call arg`", async () => {
        const { map } = build({
            directory: [WS1, WS2],
            workspace: null,
            role: null,
            workspaceSource: null,
        });
        const res = await map({ workspace: "beta" });
        (0, vitest_1.expect)(res.isError).toBeFalsy();
        const text = textOf(res);
        (0, vitest_1.expect)(text).toContain('active_workspace: "Beta"');
        (0, vitest_1.expect)(text).toContain("workspace_source: per-call arg");
    });
    (0, vitest_1.it)("rejects a blank workspace= without running the handler", async () => {
        const { map, client } = build({
            directory: [WS1, WS2],
            workspace: null,
            role: null,
            workspaceSource: null,
        });
        const res = await map({ workspace: "   " });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(textOf(res)).toContain("blank");
        (0, vitest_1.expect)(client.listKbBases).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)("errors on an unknown workspace ref", async () => {
        const { map } = build({
            directory: [WS1, WS2],
            workspace: null,
            role: null,
            workspaceSource: null,
        });
        const res = await map({ workspace: "does-not-exist" });
        (0, vitest_1.expect)(res.isError).toBe(true);
        (0, vitest_1.expect)(textOf(res)).toContain("Workspace not found");
    });
});
