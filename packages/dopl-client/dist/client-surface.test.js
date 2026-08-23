"use strict";
/**
 * THE GUARD ON THE PER-DOMAIN CLIENT SPLIT — `DoplClient` must look identical
 * to a caller however its methods are distributed across the
 * `client-<domain>.ts` chain (see `client-base.ts`). The package's other test
 * files touch almost none of the surface, so a method lost in a move would go
 * green without this.
 *
 *  1. THE SURFACE. `PUBLIC_SURFACE` is the frozen method list — the API
 *     `@dopl/mcp-server` and the app compile against. Checked BOTH ways: every
 *     frozen name resolves to a function on an instance, and the prototype
 *     chain exposes nothing off the list. Adding a method to a link means
 *     adding it here, deliberately.
 *
 *  2. THE ROUTES THAT MOVED — path, verb, tool header, and the
 *     `encodeURIComponent` on every interpolated segment (the detail a move is
 *     most likely to drop). Only `workspaces.ts` remains pinned; the
 *     `encodeURIComponent` assertion survives on `getWorkspace`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const client_js_1 = require("./client.js");
const BASE = "https://api.example.test";
/**
 * Every public method of `DoplClient`, extracted mechanically from a `.d.ts`,
 * not typed by hand. docs/ENGINEERING.md defers to this arithmetic — keep it
 * stated, so a diff of seven or eighteen reads as a deliberate change rather
 * than the class silently eating methods:
 *
 *   92 — HEAD's `client.d.ts` at the split (93 members, less constructor)
 *   85 — less the SEVEN the trash teardown removed in the same working tree
 *        (`listChatsTrash`, `listKbTrash`, `restoreChat`, `restoreKbBase`,
 *        `restoreKbEntry`, `restoreKbFolder`, `restoreOntologyCluster`). The
 *        split itself moved declarations between files and dropped none.
 *   67 — less the EIGHTEEN that went with the workflows + clusters deletion
 *        (five `*Cluster` + thirteen `*Workflow*`), along with `clusters.ts`,
 *        `workflows.ts` and both of their chain links.
 *   68 — PLUS ONE: `consumeCredits`, added with the `BillingMethods` link
 *        (`client-billing.ts`). First ADDITION this list has recorded — every
 *        prior delta was a removal — so stated as one, not folded in.
 *   66 — less the TWO that went with thread closing (wiring plan Phase 4,
 *        2026-08-18): `closeChannelThread` and `proposeChannelThreadClose`.
 *        The `PATCH /tasks/[id]` route arms behind them are deleted too, so
 *        restoring either binding would 400 rather than fail quietly.
 */
const PUBLIC_SURFACE = [
    "appendChatMessages",
    "awaitChannelMessages",
    // WORKSPACE-WIDE hold (2026-08-22) — one cursor across every channel the
    // caller is a MEMBER of. A SIBLING of the per-channel await, never a flag on
    // it: different fence, different stop rule.
    "awaitWorkspaceMessages",
    "claimOntologyAnchor",
    "consumeCredits",
    "createChannel",
    "createLaunchDirective",
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
    // LAUNCH-OVER-MCP (2026-08-22): file a directive, then poll the row. ⚠ EXACTLY
    // TWO METHODS, and the omissions are the point — CLAIM, DECIDE and the
    // pending-directives LIST are the DESKTOP's lane, reached from
    // `main/launch-directives.js` over its own authenticated fetch. Publishing
    // them here would put "claim another machine's directive" and "enumerate my
    // operator's launch queue" on the SDK every MCP tool holds.
    "getLaunchDirective",
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
/** Every method reachable on an instance, across the whole chain. */
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
        // The tempting shortcut that would break every caller:
        // `client.kb.listBases()` instead of `client.listKbBases()`.
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
/** Captures the single request a method makes: path / verb / tool header. */
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
    /**
     * Not a moved route — pinned because what makes it correct is invisible at
     * the call site: the charged workspace rides an EXPLICIT per-request
     * override (the registrar calls it outside the handler's AsyncLocalStorage
     * scope on one of its two paths), and POST is outside `IDEMPOTENT_METHODS`
     * so the transport never retries a spend.
     */
    (0, vitest_1.it)("consumeCredits POSTs the consume route with an explicit workspace header", async () => {
        cap = captureWire();
        const original = global.fetch;
        const headers = [];
        global.fetch = (async (...args) => {
            headers.push((args[1]?.headers ?? {}));
            return original(...args);
        });
        await new client_js_1.DoplClient(BASE, "k").consumeCredits("ws-42");
        global.fetch = original;
        (0, vitest_1.expect)(cap.wires).toEqual([
            {
                path: "/api/mcp/credits/consume",
                method: "POST",
                tool: "_mcp_credits_consume",
            },
        ]);
        (0, vitest_1.expect)(headers[0]["X-Workspace-Id"]).toBe("ws-42");
    });
    (0, vitest_1.it)("pingMcpStatus still normalises a missing envelope to false / null", async () => {
        cap = captureWire();
        const res = await new client_js_1.DoplClient(BASE, "k").pingMcpStatus();
        (0, vitest_1.expect)(res).toEqual({ is_admin: false, user_id: null });
    });
});
