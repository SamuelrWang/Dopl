/**
 * Workspace-resolution methods for `DoplClient`, plus the MCP status ping
 * that rides the same `/api/user` surface. Free functions over
 * `DoplTransport`; the class-side method group is `client-workspaces.ts`.
 *
 * Bodies moved verbatim out of `client.ts` in the §2 per-domain split —
 * routes, tool names and the `pingMcpStatus` normalisation are unchanged.
 */
import type { DoplTransport } from "./transport.js";
import type { ResolvedWorkspace, WorkspaceListItem } from "./types.js";
export declare function listWorkspaces(t: DoplTransport): Promise<{
    workspaces: WorkspaceListItem[];
}>;
export declare function getWorkspace(t: DoplTransport, slug: string): Promise<ResolvedWorkspace>;
/**
 * Resolve the active workspace — the one currently set on the transport
 * via `setWorkspaceId(...)` or `X-Workspace-Id` — via `GET
 * /api/workspaces/me`. Header-less resolution now depends on the caller's
 * membership count (exactly one auto-targets; 0 or 2+ → 400
 * WORKSPACE_REQUIRED). The MCP server boots off `listWorkspaces()` instead,
 * so this is no longer on the boot path.
 */
export declare function getActiveWorkspace(t: DoplTransport): Promise<ResolvedWorkspace>;
/**
 * Liveness + privilege probe. The envelope's `is_admin` / `user_id` are
 * OPTIONAL on the wire, so both are normalised here rather than at the call
 * site — a missing key means "not admin" / "unknown user", never `undefined`
 * leaking into a caller's boolean.
 */
export declare function pingMcpStatus(t: DoplTransport): Promise<{
    is_admin: boolean;
    user_id: string | null;
}>;
