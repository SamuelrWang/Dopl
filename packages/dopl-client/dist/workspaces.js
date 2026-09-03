"use strict";
/**
 * Workspace-resolution methods for `DoplClient`, plus the MCP status ping that
 * rides the same `/api/user` surface. Free functions over `DoplTransport`; the
 * class-side method group is `client-workspaces.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listWorkspaces = listWorkspaces;
exports.getWorkspace = getWorkspace;
exports.getActiveWorkspace = getActiveWorkspace;
exports.pingMcpStatus = pingMcpStatus;
const enc = encodeURIComponent;
async function listWorkspaces(t) {
    return t.request("/api/workspaces", {
        toolName: "dopl_workspaces",
    });
}
async function getWorkspace(t, slug) {
    return t.request(`/api/workspaces/${enc(slug)}`, {
        toolName: "get_workspace",
    });
}
/**
 * Resolve the workspace set on the transport (`setWorkspaceId(...)` /
 * `X-Workspace-Id`) via `GET /api/workspaces/me`. Header-less resolution
 * depends on the caller's membership count: exactly one auto-targets, 0 or 2+ →
 * 400 WORKSPACE_REQUIRED. Not on the boot path — the MCP server boots off
 * `listWorkspaces()`.
 */
async function getActiveWorkspace(t) {
    return t.request("/api/workspaces/me", {
        toolName: "get_active_workspace",
    });
}
/**
 * Liveness + privilege probe. `is_admin` / `user_id` are OPTIONAL on the wire,
 * normalised HERE not at the call site — a missing key means "not admin" /
 * "unknown user", never `undefined` leaking into a caller's boolean.
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
