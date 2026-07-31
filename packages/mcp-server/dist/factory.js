"use strict";
/**
 * factory.ts — side-effect-free entry for constructing a Dopl MCP server.
 *
 * Importable by BOTH the stdio binary (`index.ts`) and the remote HTTP
 * route in the web app, WITHOUT triggering `main()`, `process.argv`
 * parsing, or a stdio transport. The stdio-specific bits (arg parsing,
 * config-file workspace resolution, orphan-skill cleanup) stay in
 * `index.ts`; everything transport-agnostic lives here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageVersion = exports.clientIdentifier = exports.buildInstructions = exports.createServer = void 0;
exports.bootServer = bootServer;
const server_js_1 = require("./server.js");
var server_js_2 = require("./server.js");
Object.defineProperty(exports, "createServer", { enumerable: true, get: function () { return server_js_2.createServer; } });
Object.defineProperty(exports, "buildInstructions", { enumerable: true, get: function () { return server_js_2.buildInstructions; } });
var version_js_1 = require("./version.js");
Object.defineProperty(exports, "clientIdentifier", { enumerable: true, get: function () { return version_js_1.clientIdentifier; } });
Object.defineProperty(exports, "packageVersion", { enumerable: true, get: function () { return version_js_1.packageVersion; } });
function errText(err) {
    return err instanceof Error ? err.message : String(err);
}
/**
 * Build a fully-registered MCP server for `client`: run the status-ping
 * handshake (admin flag + liveness), resolve the session default workspace
 * from the caller's membership directory, and register all tools.
 * Transport-agnostic — the caller attaches stdio or HTTP afterward.
 */
async function bootServer(client, opts = {}) {
    const diag = opts.onDiag ?? (() => { });
    // Status ping → admin flag + user id. Safe default on failure: non-admin.
    // (No tools are admin-gated currently; the flag is retained for future use.)
    let isAdmin = false;
    let userId = null;
    try {
        const ping = await pingWithRetry(client, opts.pingRetries ?? 0);
        isAdmin = ping.is_admin;
        userId = ping.user_id;
    }
    catch (err) {
        diag(`[dopl-mcp] status ping failed (continuing as non-admin): ${errText(err)}`);
    }
    // Workspace directory (M-1): the caller's ACTIVE memberships in one call.
    // Replaces the old getActiveWorkspace handshake, so boot never hits the
    // header-less `resolveActiveWorkspace` path. The result seeds the server's
    // workspace cache (createServer), so no re-fetch is needed — HTTP boots
    // once per request; do NOT add loopbacks, the net count must not increase.
    let directory = [];
    let directoryLoadFailed = false;
    try {
        const result = await client.listWorkspaces();
        directory = result.workspaces;
    }
    catch (err) {
        diag(`[dopl-mcp] workspace directory load failed: ${errText(err)}`);
        directory = [];
        directoryLoadFailed = true;
    }
    // Resolve the session default from the directory:
    //   - a request-level X-Workspace-Id pin (the client's constructor
    //     workspaceId) that names a membership wins → treat like single;
    //   - else exactly one membership auto-targets;
    //   - else (0 or 2+ with no pin) NO transport default — the wrapper
    //     demands `workspace=` per call, so no header-less loopback can fire.
    const pin = client.getWorkspaceId();
    let active = null;
    let source = null;
    if (pin) {
        active = directory.find((w) => w.id === pin || w.slug === pin) ?? null;
        if (active) {
            source = "header pin";
        }
        else {
            // Keep the fallback (the stale pin is cleared below), but make the
            // silent drop observable: a request X-Workspace-Id that names no
            // active membership is otherwise invisible in logs.
            diag(`[dopl-mcp] X-Workspace-Id pin "${pin}" matched no active membership${directoryLoadFailed ? " (directory load had failed)" : ""}; ignoring it and resolving from memberships`);
        }
    }
    if (!active && directory.length === 1) {
        active = directory[0];
        source = "sole membership";
    }
    // Clear a stale/garbage constructor pin that didn't resolve so loopback
    // calls never carry a bogus X-Workspace-Id.
    client.setWorkspaceId(active ? active.id : null);
    const server = (0, server_js_1.createServer)(client, {
        isAdmin,
        // The ping's user id is not just diagnostic: `dopl_channel` needs it to tell
        // a reader that a message is addressed to IT rather than to some other
        // member. It was already resolved here and thrown away.
        userId,
        directory,
        directoryLoadFailed,
        workspace: active,
        role: active?.role ?? null,
        workspaceSource: source,
        scopes: opts.scopes,
    });
    const activeWorkspace = active
        ? {
            id: active.id,
            name: active.name,
            slug: active.slug,
            role: active.role,
        }
        : null;
    return { server, userId, isAdmin, activeWorkspace, directoryLoadFailed };
}
async function pingWithRetry(client, retries) {
    const delays = [1000, 2000, 4000].slice(0, Math.max(0, retries));
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            return await client.pingMcpStatus();
        }
        catch (err) {
            if (attempt === delays.length)
                throw err;
            await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        }
    }
    // Unreachable — the loop either returns or throws on the last attempt.
    return { is_admin: false, user_id: null };
}
