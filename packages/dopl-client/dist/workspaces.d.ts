/**
 * Workspace-resolution methods for `DoplClient`, plus the MCP status ping that
 * rides the same `/api/user` surface. Free functions over `DoplTransport`; the
 * class-side method group is `client-workspaces.ts`.
 */
import type { DoplTransport } from "./transport.js";
import type { ResolvedWorkspace, WorkspaceListItem } from "./types.js";
export declare function listWorkspaces(t: DoplTransport): Promise<{
    workspaces: WorkspaceListItem[];
}>;
export declare function getWorkspace(t: DoplTransport, slug: string): Promise<ResolvedWorkspace>;
/**
 * Resolve the workspace set on the transport (`setWorkspaceId(...)` /
 * `X-Workspace-Id`) via `GET /api/workspaces/me`. Header-less resolution
 * depends on the caller's membership count: exactly one auto-targets, 0 or 2+ →
 * 400 WORKSPACE_REQUIRED. Not on the boot path — the MCP server boots off
 * `listWorkspaces()`.
 */
export declare function getActiveWorkspace(t: DoplTransport): Promise<ResolvedWorkspace>;
/**
 * Liveness + privilege probe. `is_admin` / `user_id` are OPTIONAL on the wire,
 * normalised HERE not at the call site — a missing key means "not admin" /
 * "unknown user", never `undefined` leaking into a caller's boolean.
 */
export declare function pingMcpStatus(t: DoplTransport): Promise<{
    is_admin: boolean;
    user_id: string | null;
}>;
