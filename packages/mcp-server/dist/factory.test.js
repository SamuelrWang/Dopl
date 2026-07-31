"use strict";
/**
 * NET-NEW — bootServer workspace resolution + directory-load failure.
 *
 * The SDK `McpServer` is mocked (like server.test.ts) so `createServer`
 * registers tools without touching a real transport. We drive `bootServer`
 * over a stubbed `DoplClient` and assert what it wires onto the client
 * (`setWorkspaceId` — the on-the-wire default) and what it reports back
 * (`activeWorkspace`, `directoryLoadFailed`).
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
vitest_1.vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
    McpServer: class {
        tool() { }
    },
}));
const factory_js_1 = require("./factory.js");
function wsItem(id, slug, name, role) {
    return {
        id,
        ownerId: "owner",
        name,
        slug,
        publicId: `pub-${id}`,
        description: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        role,
    };
}
const WS1 = wsItem("id-1", "alpha", "Alpha", "owner");
const WS2 = wsItem("id-2", "beta", "Beta", "member");
function mockClient(opts) {
    return {
        pingMcpStatus: vitest_1.vi
            .fn()
            .mockResolvedValue({ is_admin: false, user_id: "user-1" }),
        listWorkspaces: opts.listThrows
            ? vitest_1.vi.fn().mockRejectedValue(new Error("backend down"))
            : vitest_1.vi.fn().mockResolvedValue({ workspaces: opts.directory ?? [] }),
        getWorkspaceId: vitest_1.vi.fn(() => opts.pin ?? null),
        setWorkspaceId: vitest_1.vi.fn(),
    };
}
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.clearAllMocks();
});
(0, vitest_1.describe)("bootServer workspace resolution", () => {
    (0, vitest_1.it)("single membership → auto-targets it on the wire (setWorkspaceId with its id)", async () => {
        const client = mockClient({ directory: [WS1], pin: null });
        const res = await (0, factory_js_1.bootServer)(client);
        (0, vitest_1.expect)(client.setWorkspaceId).toHaveBeenCalledWith("id-1");
        (0, vitest_1.expect)(res.activeWorkspace).toMatchObject({ id: "id-1", slug: "alpha" });
        (0, vitest_1.expect)(res.directoryLoadFailed).toBe(false);
    });
    (0, vitest_1.it)("2+ memberships, no pin → no default (setWorkspaceId null)", async () => {
        const client = mockClient({ directory: [WS1, WS2], pin: null });
        const res = await (0, factory_js_1.bootServer)(client);
        (0, vitest_1.expect)(client.setWorkspaceId).toHaveBeenCalledWith(null);
        (0, vitest_1.expect)(res.activeWorkspace).toBeNull();
        (0, vitest_1.expect)(res.directoryLoadFailed).toBe(false);
    });
    (0, vitest_1.it)("valid pin among 2+ → targets the pinned workspace", async () => {
        const client = mockClient({ directory: [WS1, WS2], pin: "id-2" });
        const res = await (0, factory_js_1.bootServer)(client);
        (0, vitest_1.expect)(client.setWorkspaceId).toHaveBeenCalledWith("id-2");
        (0, vitest_1.expect)(res.activeWorkspace).toMatchObject({ id: "id-2", slug: "beta" });
    });
    (0, vitest_1.it)("invalid/non-member pin among 2+ → cleared to null default and logged", async () => {
        const onDiag = vitest_1.vi.fn();
        const client = mockClient({ directory: [WS1, WS2], pin: "ghost" });
        const res = await (0, factory_js_1.bootServer)(client, { onDiag });
        (0, vitest_1.expect)(client.setWorkspaceId).toHaveBeenCalledWith(null);
        (0, vitest_1.expect)(res.activeWorkspace).toBeNull();
        // The dropped pin must be observable, not silent (FIX 2).
        (0, vitest_1.expect)(onDiag).toHaveBeenCalledWith(vitest_1.expect.stringContaining("ghost"));
    });
    (0, vitest_1.it)("invalid pin with a sole membership → falls back to sole-membership auto-target", async () => {
        const client = mockClient({ directory: [WS1], pin: "ghost" });
        const res = await (0, factory_js_1.bootServer)(client);
        (0, vitest_1.expect)(client.setWorkspaceId).toHaveBeenCalledWith("id-1");
        (0, vitest_1.expect)(res.activeWorkspace).toMatchObject({ id: "id-1" });
    });
    (0, vitest_1.it)("listWorkspaces throws → directoryLoadFailed surfaced, no default", async () => {
        const client = mockClient({ listThrows: true, pin: null });
        const res = await (0, factory_js_1.bootServer)(client);
        (0, vitest_1.expect)(res.directoryLoadFailed).toBe(true);
        (0, vitest_1.expect)(res.activeWorkspace).toBeNull();
        (0, vitest_1.expect)(client.setWorkspaceId).toHaveBeenCalledWith(null);
    });
});
// ── Identity: ONE record for the whole session ─────────────────────────
//
// Two sources for the same fact is how two tools on one connection came to
// disagree about who was calling. The transport's id is read off the credential
// that is authorizing THIS request; the status ping's is a second loopback that
// fails independently. When both exist, the credential wins.
(0, vitest_1.describe)("bootServer caller identity", () => {
    (0, vitest_1.it)("prefers the transport's user id over the status ping's", async () => {
        const res = await (0, factory_js_1.bootServer)(mockClient({ directory: [WS1] }), {
            caller: { userId: "from-credential" },
        });
        (0, vitest_1.expect)(res.userId).toBe("from-credential");
    });
    (0, vitest_1.it)("falls back to the ping when the transport supplied none", async () => {
        const res = await (0, factory_js_1.bootServer)(mockClient({ directory: [WS1] }), {
            caller: { runtime: "desktop-session" },
        });
        (0, vitest_1.expect)(res.userId).toBe("user-1");
    });
    (0, vitest_1.it)("reports no id at all when both sources are silent", async () => {
        const client = mockClient({ directory: [WS1] });
        vitest_1.vi.mocked(client.pingMcpStatus).mockRejectedValue(new Error("ping down"));
        const res = await (0, factory_js_1.bootServer)(client, { onDiag: () => { } });
        (0, vitest_1.expect)(res.userId).toBeNull();
    });
});
