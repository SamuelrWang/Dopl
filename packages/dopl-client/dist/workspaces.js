"use strict";
/**
 * Workspace-resolution methods for `DoplClient`, plus the MCP status ping
 * that rides the same `/api/user` surface. Free functions over
 * `DoplTransport`; the class-side method group is `client-workspaces.ts`.
 *
 * Bodies moved verbatim out of `client.ts` in the §2 per-domain split —
 * routes, tool names and the `pingMcpStatus` normalisation are unchanged.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listWorkspaces = listWorkspaces;
exports.getWorkspace = getWorkspace;
exports.getActiveWorkspace = getActiveWorkspace;
exports.pingMcpStatus = pingMcpStatus;
const enc = encodeURIComponent;
async function listWorkspaces(t) {
    return t.request("/api/workspaces", {
        toolName: "list_workspaces",
    });
}
async function getWorkspace(t, slug) {
    return t.request(`/api/workspaces/${enc(slug)}`, {
        toolName: "get_workspace",
    });
}
/**
 * Resolve the active workspace — the one currently set on the transport
 * via `setWorkspaceId(...)` or `X-Workspace-Id` — via `GET
 * /api/workspaces/me`. Header-less resolution now depends on the caller's
 * membership count (exactly one auto-targets; 0 or 2+ → 400
 * WORKSPACE_REQUIRED). The MCP server boots off `listWorkspaces()` instead,
 * so this is no longer on the boot path.
 */
async function getActiveWorkspace(t) {
    return t.request("/api/workspaces/me", {
        toolName: "get_active_workspace",
    });
}
/**
 * Liveness + privilege probe. The envelope's `is_admin` / `user_id` are
 * OPTIONAL on the wire, so both are normalised here rather than at the call
 * site — a missing key means "not admin" / "unknown user", never `undefined`
 * leaking into a caller's boolean.
 */
async function pingMcpStatus(t) {
    const res = await t.request("/api/user/mcp-status", {
        method: "POST",
        toolName: "_mcp_status_ping",
        body: {},
    });
    return {
        is_admin: res.is_admin === true,
        user_id: typeof res.user_id === "string" ? res.user_id : null,
    };
}
