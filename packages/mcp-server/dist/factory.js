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
exports.packageVersion = exports.clientIdentifier = exports.SERVER_INSTRUCTIONS = exports.createServer = void 0;
exports.bootServer = bootServer;
const server_js_1 = require("./server.js");
var server_js_2 = require("./server.js");
Object.defineProperty(exports, "createServer", { enumerable: true, get: function () { return server_js_2.createServer; } });
Object.defineProperty(exports, "SERVER_INSTRUCTIONS", { enumerable: true, get: function () { return server_js_2.SERVER_INSTRUCTIONS; } });
var version_js_1 = require("./version.js");
Object.defineProperty(exports, "clientIdentifier", { enumerable: true, get: function () { return version_js_1.clientIdentifier; } });
Object.defineProperty(exports, "packageVersion", { enumerable: true, get: function () { return version_js_1.packageVersion; } });
function errText(err) {
    return err instanceof Error ? err.message : String(err);
}
/**
 * Build a fully-registered MCP server for `client`: run the status-ping
 * handshake (admin flag + liveness), resolve the active workspace, and
 * register all tools. Transport-agnostic — the caller attaches stdio or
 * HTTP afterward.
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
    // Workspace handshake — confirm the active canvas + the caller's role.
    // Non-fatal: workspace-targeting tools return clear errors and the caller
    // decides how to surface "no active canvas".
    let handshake = null;
    try {
        handshake = await client.getActiveWorkspace();
    }
    catch (err) {
        diag(`[dopl-mcp] canvas handshake failed: ${errText(err)}`);
        handshake = null;
    }
    if (handshake?.workspace) {
        client.setWorkspaceId(handshake.workspace.id);
    }
    const server = (0, server_js_1.createServer)(client, {
        isAdmin,
        workspace: handshake?.workspace ?? null,
        role: handshake?.role ?? null,
        scopes: opts.scopes,
    });
    const activeWorkspace = handshake?.workspace
        ? {
            id: handshake.workspace.id,
            name: handshake.workspace.name,
            slug: handshake.workspace.slug,
            role: handshake.role ?? "viewer",
        }
        : null;
    return { server, userId, isAdmin, activeWorkspace };
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
