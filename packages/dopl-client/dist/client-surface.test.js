"use strict";
/**
 * THE GUARD ON THE §2 PER-DOMAIN SPLIT.
 *
 * `client.ts` was one 720-line class; it is now a terminal link on a chain of
 * `client-<domain>.ts` method groups (see `client-base.ts`). That refactor is
 * only correct if NOTHING about `DoplClient` changed for a caller — and the
 * package's other three test files never touched most of the surface, so a
 * method silently lost in the move, or a route that drifted when its body left
 * the class, would have gone green.
 *
 * Two checks, for the two ways the split could lie:
 *
 *  1. THE SURFACE. `PUBLIC_SURFACE` is the frozen method list — the exact
 *     public API that `@dopl/mcp-server` and the app compile against. (Read
 *     off the declaration emit, minus the trash-teardown methods that left the
 *     class in a separate change; see the note on the constant itself, which
 *     is where the seven-method gap against HEAD is accounted for.) Checked in
 *     BOTH directions: every frozen name still resolves to a function on an
 *     instance, and the prototype chain exposes nothing that is not on the
 *     list. Adding a method to a link means adding it here, deliberately.
 *
 *  2. THE ROUTES THAT MOVED. Only the cluster / workflow / workspace bodies
 *     actually relocated (into `clusters.ts`, `workflows.ts`, `workspaces.ts`);
 *     every other domain already delegated to a module this refactor never
 *     touched. Those are the ones whose path, verb, and tool header are pinned
 *     here — including the `encodeURIComponent` on every interpolated segment,
 *     which is the detail a move is most likely to drop. TWO of the three are
 *     now gone: `clusters.ts` and `workflows.ts` were DELETED with their
 *     features on 2026-08-11, so what remains pinned is `workspaces.ts`. The
 *     `encodeURIComponent` assertion survives on `getWorkspace`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const client_js_1 = require("./client.js");
const BASE = "https://api.example.test";
/**
 * Every public method of `DoplClient`, extracted mechanically from a `.d.ts`
 * rather than typed by hand.
 *
 * PROVENANCE, stated exactly, because "the pre-split surface" is what this
 * used to say and it was off by seven. The chain of edits, in order:
 *
 *   92 — HEAD's `client.d.ts` at the §2 split (93 members, less constructor)
 *   85 — less the SEVEN the trash teardown removed in the same working tree
 *        (`listChatsTrash`, `listKbTrash`, `restoreChat`, `restoreKbBase`,
 *        `restoreKbEntry`, `restoreKbFolder`, `restoreOntologyCluster`). The
 *        SPLIT itself moved declarations between files and dropped none.
 *   67 — less the EIGHTEEN that went with the workflows + clusters deletion
 *        on 2026-08-11 (five `*Cluster` + thirteen `*Workflow*`), along with
 *        `clusters.ts`, `workflows.ts` and both of their chain links.
 *
 * Stating the arithmetic is the whole value of the check: read as one number
 * with no history, a diff of seven — or of eighteen — looks like the class
 * silently eating methods rather than three deliberate changes.
 */
const PUBLIC_SURFACE = [
    "appendChatMessages",
    "awaitChannelMessages",
    "claimOntologyAnchor",
    "closeChannelThread",
    "createChannel",
    "createChannelThread",
    "createChatFolder",
    "createKbBase",
    "createKbFolderByPath",
    "createOntologyCluster",
    "createOntologyObject",
    "createSkill",
    "deleteChat",
    "deleteChatFolder",
    "deleteKbBase",
    "deleteKbByPath",
    "deleteOntologyCluster",
    "deleteOntologyObject",
    "deleteSkill",
    "exportChat",
    "getAccessMatrix",
    "getActiveWorkspace",
    "getBaseUrl",
    "getChannel",
    "getChannelThread",
    "getChat",
    "getKbBase",
    "getKbTree",
    "getMemberAccess",
    "getMyAccess",
    "getMyMembership",
    "getOntology",
    "getOntologyAnchor",
    "getSkill",
    "getWorkspace",
    "getWorkspaceId",
    "inviteToChannel",
    "listChannelMembers",
    "listChannelSessions",
    "listChannelThreads",
    "listChannels",
    "listChatFolders",
    "listChats",
    "listKbBases",
    "listKbDirByPath",
    "listSkills",
    "listWorkspaceMembers",
    "listWorkspaceTeams",
    "listWorkspaces",
    "moveKbByPath",
    "pingMcpStatus",
    "postChannelMessage",
    "proposeChannelThreadClose",
    "readChannelMessages",
    "readKbFileByPath",
    "readSkillBody",
    "searchKb",
    "setChannelThreadMode",
    "setWorkspaceId",
    "updateChat",
    "updateChatFolder",
    "updateKbBase",
    "updateOntologyCluster",
    "updateOntologyObject",
    "updateSkill",
    "writeKbFileByPath",
    "writeSkillBody",
];
/** Every method name reachable on an instance, across the whole chain. */
function prototypeChainMethods(instance) {
    const names = new Set();
    let proto = Object.getPrototypeOf(instance);
    while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name === "constructor")
                continue;
            names.add(name);
        }
        proto = Object.getPrototypeOf(proto);
    }
    return [...names].sort();
}
(0, vitest_1.describe)("DoplClient public surface (frozen across the §2 split)", () => {
    const client = new client_js_1.DoplClient(BASE, "k");
    (0, vitest_1.it)("still exposes every method the pre-split class declared", () => {
        const missing = PUBLIC_SURFACE.filter((name) => typeof client[name] !== "function");
        (0, vitest_1.expect)(missing).toEqual([]);
    });
    (0, vitest_1.it)("exposes NOTHING beyond that list (the chain adds no surface)", () => {
        (0, vitest_1.expect)(prototypeChainMethods(client)).toEqual([...PUBLIC_SURFACE].sort());
    });
    (0, vitest_1.it)("is a single flat class — no sub-client namespaces were introduced", () => {
        // The split had one tempting shortcut that would have broken every
        // caller: `client.kb.listBases()` instead of `client.listKbBases()`.
        for (const ns of ["workspaces", "kb", "channels", "skills"]) {
            (0, vitest_1.expect)(client[ns]).toBeUndefined();
        }
    });
    (0, vitest_1.it)("keeps the constructor's three-argument shape", () => {
        const withOpts = new client_js_1.DoplClient(BASE, "k", { clientIdentifier: "x@1" });
        (0, vitest_1.expect)(withOpts.getBaseUrl()).toBe(BASE);
        (0, vitest_1.expect)(withOpts.getWorkspaceId()).toBeNull();
        withOpts.setWorkspaceId("ws-1");
        (0, vitest_1.expect)(withOpts.getWorkspaceId()).toBe("ws-1");
    });
});
/** Captures the single request a method makes, as path / verb / tool header. */
function captureWire() {
    const wires = [];
    const original = global.fetch;
    global.fetch = (async (...args) => {
        const [input, init] = args;
        const headers = (init?.headers ?? {});
        wires.push({
            path: String(input).replace(BASE, ""),
            method: init?.method ?? "GET",
            tool: headers["X-MCP-Tool"],
        });
        return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    });
    return {
        wires,
        restore: () => {
            global.fetch = original;
        },
    };
}
(0, vitest_1.describe)("routes that MOVED out of client.ts", () => {
    let cap;
    (0, vitest_1.afterEach)(() => cap?.restore());
    /** Runs one call and returns the single request it put on the wire. */
    async function wireOf(call) {
        cap = captureWire();
        await call(new client_js_1.DoplClient(BASE, "k"));
        (0, vitest_1.expect)(cap.wires).toHaveLength(1);
        return cap.wires[0];
    }
    const cases = [
        // ── workspaces.ts ────────────────────────────────────────────────
        ["listWorkspaces", (c) => c.listWorkspaces(), { path: "/api/workspaces", method: "GET", tool: "list_workspaces" }],
        ["getWorkspace", (c) => c.getWorkspace("s p"), { path: "/api/workspaces/s%20p", method: "GET", tool: "get_workspace" }],
        ["getActiveWorkspace", (c) => c.getActiveWorkspace(), { path: "/api/workspaces/me", method: "GET", tool: "get_active_workspace" }],
        ["pingMcpStatus", (c) => c.pingMcpStatus(), { path: "/api/user/mcp-status", method: "POST", tool: "_mcp_status_ping" }],
    ];
    for (const [name, call, expected] of cases) {
        (0, vitest_1.it)(`${name} hits ${expected.method} ${expected.path}`, async () => {
            (0, vitest_1.expect)(await wireOf(call)).toEqual(expected);
        });
    }
    (0, vitest_1.it)("pingMcpStatus still normalises a missing envelope to false / null", async () => {
        cap = captureWire();
        const res = await new client_js_1.DoplClient(BASE, "k").pingMcpStatus();
        (0, vitest_1.expect)(res).toEqual({ is_admin: false, user_id: null });
    });
});
