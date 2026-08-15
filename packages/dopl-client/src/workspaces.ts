/**
 * Workspace-resolution methods for `DoplClient`, plus the MCP status ping that
 * rides the same `/api/user` surface. Free functions over `DoplTransport`; the
 * class-side method group is `client-workspaces.ts`.
 */

import type { DoplTransport } from "./transport.js";
import type { ResolvedWorkspace, WorkspaceListItem } from "./types.js";

const enc = encodeURIComponent;

export async function listWorkspaces(
  t: DoplTransport
): Promise<{ workspaces: WorkspaceListItem[] }> {
  return t.request<{ workspaces: WorkspaceListItem[] }>("/api/workspaces", {
    toolName: "list_workspaces",
  });
}

export async function getWorkspace(
  t: DoplTransport,
  slug: string
): Promise<ResolvedWorkspace> {
  return t.request<ResolvedWorkspace>(`/api/workspaces/${enc(slug)}`, {
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
export async function getActiveWorkspace(
  t: DoplTransport
): Promise<ResolvedWorkspace> {
  return t.request<ResolvedWorkspace>("/api/workspaces/me", {
    toolName: "get_active_workspace",
  });
}

/**
 * Liveness + privilege probe. `is_admin` / `user_id` are OPTIONAL on the wire,
 * normalised HERE not at the call site — a missing key means "not admin" /
 * "unknown user", never `undefined` leaking into a caller's boolean.
 */
export async function pingMcpStatus(
  t: DoplTransport
): Promise<{ is_admin: boolean; user_id: string | null }> {
  const res = await t.request<{
    ok: boolean;
    is_admin?: boolean;
    user_id?: string;
  }>("/api/user/mcp-status", {
    method: "POST",
    toolName: "_mcp_status_ping",
    body: {},
  });
  return {
    is_admin: res.is_admin === true,
    user_id: typeof res.user_id === "string" ? res.user_id : null,
  };
}
