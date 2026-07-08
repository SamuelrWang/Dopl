"use strict";
/**
 * Members / teams / access READ methods for `DoplClient`.
 *
 * Strictly read-only by design: membership, team, and access changes
 * are human decisions made in the Dopl web UI. These methods let an
 * agent answer "who's in this workspace, who's on which team, and who
 * can access what" — never change it.
 *
 * The membership routes are addressed by workspace slug, so every call
 * first resolves the active workspace (one extra loopback request).
 * The result is deliberately NOT cached: the active workspace can
 * change per call (X-Workspace-Id / workspaceContext), and a stale
 * segment would silently read the wrong workspace.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyMembership = getMyMembership;
exports.listMembers = listMembers;
exports.listTeams = listTeams;
exports.getAccessMatrix = getAccessMatrix;
exports.getMyAccess = getMyAccess;
exports.getMemberAccess = getMemberAccess;
const enc = encodeURIComponent;
async function getMyMembership(t) {
    const data = await t.request("/api/workspaces/me", { toolName: "members_whoami" });
    return {
        workspace: data.workspace,
        role: data.role,
        userId: data.userId ?? null,
    };
}
async function listMembers(t) {
    const segment = await workspaceSegment(t);
    const data = await t.request(`/api/workspaces/${segment}/members`, { toolName: "members_list" });
    return data.members;
}
async function listTeams(t) {
    const segment = await workspaceSegment(t);
    const data = await t.request(`/api/workspaces/${segment}/teams`, { toolName: "members_teams" });
    return data.teams;
}
async function getAccessMatrix(t) {
    const segment = await workspaceSegment(t);
    return t.request(`/api/workspaces/${segment}/access-matrix`, {
        toolName: "members_access_matrix",
    });
}
async function getMyAccess(t) {
    const segment = await workspaceSegment(t);
    return t.request(`/api/workspaces/${segment}/my-access`, {
        toolName: "members_my_access",
    });
}
/**
 * A member's server-resolved effective access. Admins may ask about
 * anyone; regular members only about themselves (the server 404s other
 * targets so member existence isn't an oracle).
 */
async function getMemberAccess(t, targetUserId) {
    const segment = await workspaceSegment(t);
    const data = await t.request(`/api/workspaces/${segment}/members/${enc(targetUserId)}/access`, { toolName: "members_member_access" });
    return data.rows;
}
/** Canonical `{slug}-{publicId}` segment for the active workspace. */
async function workspaceSegment(t) {
    const { workspace } = await t.request("/api/workspaces/me", { toolName: "members_resolve_workspace" });
    return enc(`${workspace.slug}-${workspace.publicId}`);
}
