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

import type { DoplTransport } from "./transport.js";
import type { ResolvedWorkspace } from "./types.js";
import type {
  AccessMatrix,
  EffectiveAccessRow,
  MyAccess,
  MyMembership,
  WorkspaceMember,
  WorkspaceTeam,
} from "./member-types.js";

const enc = encodeURIComponent;

export async function getMyMembership(t: DoplTransport): Promise<MyMembership> {
  const data = await t.request<ResolvedWorkspace & { userId?: string }>(
    "/api/workspaces/me",
    { toolName: "members_whoami" }
  );
  return {
    workspace: data.workspace,
    role: data.role,
    userId: data.userId ?? null,
  };
}

export async function listMembers(t: DoplTransport): Promise<WorkspaceMember[]> {
  const segment = await workspaceSegment(t);
  const data = await t.request<{ members: WorkspaceMember[] }>(
    `/api/workspaces/${segment}/members`,
    { toolName: "members_list" }
  );
  return data.members;
}

export async function listTeams(t: DoplTransport): Promise<WorkspaceTeam[]> {
  const segment = await workspaceSegment(t);
  const data = await t.request<{ teams: WorkspaceTeam[] }>(
    `/api/workspaces/${segment}/teams`,
    { toolName: "members_teams" }
  );
  return data.teams;
}

export async function getAccessMatrix(t: DoplTransport): Promise<AccessMatrix> {
  const segment = await workspaceSegment(t);
  return t.request<AccessMatrix>(`/api/workspaces/${segment}/access-matrix`, {
    toolName: "members_access_matrix",
  });
}

export async function getMyAccess(t: DoplTransport): Promise<MyAccess> {
  const segment = await workspaceSegment(t);
  return t.request<MyAccess>(`/api/workspaces/${segment}/my-access`, {
    toolName: "members_my_access",
  });
}

/**
 * A member's server-resolved effective access. Admins may ask about
 * anyone; regular members only about themselves (the server 404s other
 * targets so member existence isn't an oracle).
 */
export async function getMemberAccess(
  t: DoplTransport,
  targetUserId: string
): Promise<EffectiveAccessRow[]> {
  const segment = await workspaceSegment(t);
  const data = await t.request<{ rows: EffectiveAccessRow[] }>(
    `/api/workspaces/${segment}/members/${enc(targetUserId)}/access`,
    { toolName: "members_member_access" }
  );
  return data.rows;
}

/** Canonical `{slug}-{publicId}` segment for the active workspace. */
async function workspaceSegment(t: DoplTransport): Promise<string> {
  const { workspace } = await t.request<ResolvedWorkspace>(
    "/api/workspaces/me",
    { toolName: "members_resolve_workspace" }
  );
  return enc(`${workspace.slug}-${workspace.publicId}`);
}
