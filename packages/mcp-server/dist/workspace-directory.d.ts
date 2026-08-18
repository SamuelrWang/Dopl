/**
 * workspace-directory.ts — the session's view of WHICH workspaces exist and
 * which one a call lands in: membership caching, slug→id resolution, and the
 * "you must pass `workspace=`" refusal.
 *
 * ⚠ FAIL-CLOSED throughout. A blank `workspace=` is rejected by the caller in
 * `registrar.ts`; 0 or 2+ memberships with no pin gets
 * {@link WorkspaceDirectory.noWorkspaceError}, never a guessed workspace; and a
 * FAILED boot directory load does not seed the cache, so the first resolution
 * retries instead of serving a bogus empty list for a full TTL.
 */
import type { DoplClient, WorkspaceListItem, WorkspaceRole } from "@dopl/client";
import type { ToolResponse } from "./tools/respond.js";
/**
 * Session default workspace, resolved once at boot (X-Workspace-Id pin, else
 * the sole membership). Read by `appendDoplStatus`. ⚠ Null on 0 or 2+
 * memberships with no pin — a no-arg tool call is then REFUSED, so nothing is
 * silently routed to a guessed workspace.
 */
export interface ActiveWorkspaceState {
    id: string;
    slug: string;
    name: string;
    role: WorkspaceRole;
}
/**
 * How the workspace a call hit was chosen — surfaced verbatim in the
 * `_dopl_status` footer so the agent can confirm targeting.
 */
export type WorkspaceSource = "per-call arg" | "sole membership" | "header pin";
export interface EffectiveWorkspace extends ActiveWorkspaceState {
    source: WorkspaceSource;
}
/** The boot-resolved directory state this module is constructed from. */
export interface WorkspaceDirectoryOptions {
    /**
     * Caller's full active-membership directory from the boot `listWorkspaces()`.
     * Seeds the cache so per-call `workspace=` needs no extra loopback.
     */
    directory?: WorkspaceListItem[];
    /**
     * ⚠ True when the boot `listWorkspaces()` FAILED, as opposed to a genuine
     * empty directory: steers the copy to "couldn't load — retry", and suppresses
     * seeding a bogus empty cache so a later resolution retries.
     */
    directoryLoadFailed?: boolean;
}
export interface WorkspaceDirectory {
    /** The caller's memberships, cached for {@link WORKSPACE_CACHE_TTL_MS}. */
    getWorkspaceList(): Promise<WorkspaceListItem[]>;
    /** A slug-or-UUID `workspace=` ref resolved against those memberships. */
    resolveWorkspaceRef(ref: string): Promise<WorkspaceListItem | null>;
    /** The isError response for a no-`workspace=` call with no session default. */
    noWorkspaceError(): Promise<ToolResponse>;
}
export declare function createWorkspaceDirectory(client: DoplClient, options?: WorkspaceDirectoryOptions): WorkspaceDirectory;
