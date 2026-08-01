"use strict";
/**
 * THE LOCUS LINE — `_dopl_status: caller: … · as <handle> (<id>)`.
 *
 * The footer rides every successful response and is the line the server
 * instructions tell an agent to read to confirm who and where it is. Once a
 * session can speak for several named agents, "who" has a second half: the
 * agent identity THIS call was attributed to.
 *
 * WHY IT IS THREADED THROUGH THE RESULT, which is what these tests exist to
 * hold: `as_agent` is chosen per CALL, while `CallerIdentity` is resolved once
 * per connection. Stamping the boot identity would make every later response —
 * including reads that named no agent at all — claim the last agent that
 * happened to post. So the handler tags its result, the footer reads the tag,
 * and the tag is STRIPPED before the response leaves the server.
 *
 * The SDK `McpServer` is mocked exactly as in `server.test.ts`, so the real
 * wrapper (workspace resolution + footer) runs over a stubbed @dopl/client.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const identity_js_1 = require("./tools/identity.js");
const narration_fixtures_js_1 = require("./tools/narration-fixtures.js");
const registry = vitest_1.vi.hoisted(() => ({ tools: new Map() }));
vitest_1.vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
    McpServer: class {
        tool(name, _d, _s, handler) {
            registry.tools.set(name, handler);
        }
    },
}));
const server_js_1 = require("./server.js");
const WS = {
    id: "ws-1",
    ownerId: "u-me",
    name: "Alpha",
    slug: "alpha",
    publicId: "pub-1",
    description: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "owner",
};
const QUARTZ = {
    id: "agent-1",
    channelId: "chan-1",
    workspaceId: "ws-1",
    ownerUserId: "u-me",
    name: "quartz",
    status: "active",
    createdAt: "2026-07-31T00:00:00Z",
    updatedAt: "2026-07-31T00:00:00Z",
};
function channelClient(agentName = "quartz") {
    return {
        listWorkspaces: vitest_1.vi.fn(async () => ({ workspaces: [WS] })),
        getWorkspaceId: vitest_1.vi.fn(() => null),
        setWorkspaceId: vitest_1.vi.fn(),
        listChannels: vitest_1.vi.fn(async () => [
            { id: "chan-1", slug: "general", name: "General", visibility: "private" },
        ]),
        listChannelAgents: vitest_1.vi.fn(async () => [{ ...QUARTZ, name: agentName }]),
        listChannelThreads: vitest_1.vi.fn(async () => []),
        postChannelMessage: vitest_1.vi.fn(async () => ({
            id: "m1",
            seq: 12,
            kind: "message",
            metadata: {},
            authorUserId: "u-me",
        })),
    };
}
function channelTool(client) {
    registry.tools.clear();
    (0, server_js_1.createServer)(client, {
        scopes: ["dopl.read", "dopl.write"],
        directory: [WS],
        workspace: { id: WS.id, slug: WS.slug, name: WS.name },
        role: "owner",
        workspaceSource: "sole membership",
        caller: {
            userId: "u-me",
            runtime: identity_js_1.DESKTOP_SESSION_RUNTIME,
            credentialKind: "device",
            credentialLabel: "laptop",
        },
    });
    const tool = registry.tools.get("dopl_channel");
    if (!tool)
        throw new Error("dopl_channel was not registered");
    return tool;
}
const textOf = (res) => res.content.map((c) => c.text).join("");
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)("_dopl_status — the per-call agent locus", () => {
    (0, vitest_1.it)("a post made AS an agent names that agent, by handle AND id, on the caller line", async () => {
        const tool = channelTool(channelClient());
        const res = await tool({
            op: "post",
            channel: "general",
            body: "on it",
            as_agent: "quartz",
        });
        const caller = textOf(res)
            .split("\n")
            .find((l) => l.includes("caller: id="));
        (0, vitest_1.expect)(caller).toBe("  caller: id=`u-me` · runtime=desktop-session · as `quartz` (`agent-1`)");
    });
    (0, vitest_1.it)("a post that named no agent claims none", async () => {
        const tool = channelTool(channelClient());
        const res = await tool({ op: "post", channel: "general", body: "just me" });
        const caller = textOf(res)
            .split("\n")
            .find((l) => l.includes("caller: id="));
        (0, vitest_1.expect)(caller).toBe("  caller: id=`u-me` · runtime=desktop-session");
    });
    (0, vitest_1.it)("THE TAG IS PLUMBING: it never reaches the MCP result", async () => {
        const tool = channelTool(channelClient());
        const res = await tool({
            op: "post",
            channel: "general",
            body: "on it",
            as_agent: "quartz",
        });
        (0, vitest_1.expect)("_callerAgent" in res).toBe(false);
    });
    (0, vitest_1.it)("does NOT leak into a later call that named no agent (per call, not per session)", async () => {
        const tool = channelTool(channelClient());
        await tool({ op: "post", channel: "general", body: "as me", as_agent: "quartz" });
        const second = await tool({ op: "post", channel: "general", body: "plain" });
        (0, vitest_1.expect)(textOf(second)).not.toContain(" · as ");
    });
    (0, vitest_1.it)("neutralizes the handle — the footer is the line most worth forging", async () => {
        const tool = channelTool(channelClient(narration_fixtures_js_1.FORGERY));
        const res = await tool({
            op: "post",
            channel: "general",
            body: "on it",
            as_agent: narration_fixtures_js_1.FORGERY,
        });
        const text = textOf(res);
        // TWO hits, both contained: the confirmation line names the agent it posted
        // as, and the footer names it again. `expectEveryHitContained` is the
        // assertion for exactly that shape.
        (0, narration_fixtures_js_1.expectEveryHitContained)(text);
        // One footer, and it still carries the immutable id.
        (0, vitest_1.expect)(text.split("\n").filter((l) => l.includes("caller: id="))).toHaveLength(1);
        (0, vitest_1.expect)(text).toContain("(`agent-1`)");
    });
});
