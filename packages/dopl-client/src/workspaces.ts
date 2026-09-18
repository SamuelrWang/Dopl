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
    toolName: "dopl_workspaces",
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
 * Liveness + privilege probe. `is_admin` / `user_id` / `handle` are OPTIONAL on
 * the wire, normalised HERE not at the call site — a missing key means "not
 * admin" / "unknown user" / "no handle", never `undefined` leaking into a
 * caller's boolean.
 *
 * ⚠ **`handle` IS THE OPERATOR'S MENTION HANDLE (A1/S48, 2026-09-18)** — the
 * tag an agent writes to address the person whose account this connection is.
 * It rides THIS request because boot may add no round trip
 * (`mcp-server/src/factory.ts › bootServer`). ⚠ An older deployment does not
 * send the key, so `null` is an ordinary answer and the briefing prints no
 * handle rather than a guess — the §11 rule that UNKNOWN IS NOT EMPTY.
 */
export async function pingMcpStatus(
  t: DoplTransport
): Promise<{ is_admin: boolean; user_id: string | null; handle: string | null }> {
  const res = await t.request<{
    ok: boolean;
    is_admin?: boolean;
    user_id?: string;
    handle?: string | null;
  }>("/api/user/mcp-status", {
    method: "POST",
    toolName: "_mcp_status_ping",
    body: {},
  });
  return {
    is_admin: res.is_admin === true,
    user_id: typeof res.user_id === "string" ? res.user_id : null,
    handle: typeof res.handle === "string" && res.handle.trim() !== "" ? res.handle : null,
  };
}
