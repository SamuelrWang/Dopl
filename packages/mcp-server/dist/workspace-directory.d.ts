/**
 * workspace-directory.ts — the session's view of WHICH workspaces exist and
 * which one a call lands in.
 *
 * Split out of `server.ts` (§2, the layer rule): membership caching,
 * slug→id resolution and the "you must pass `workspace=`" refusal are one
 * responsibility — resolving a target — distinct from registering tools
 * (`registrar.ts`), gating ops (`gating.ts`) or writing the briefing
 * (`instructions.ts`).
 *
 * FAIL-CLOSED IS THE POINT AND IT DID NOT MOVE. A blank `workspace=` is
 * rejected by the caller in `registrar.ts`; a caller with 0 or 2+ memberships
 * and no pin gets {@link WorkspaceDirectory.noWorkspaceError} rather than a
 * guessed workspace; and a boot directory load that FAILED does not seed the
 * cache, so the first resolution retries instead of serving a bogus empty list
 * for a full TTL.
 */
import type { DoplClient, WorkspaceListItem, WorkspaceRole } from "@dopl/client";
import type { ToolResponse } from "./tools/respond.js";
/**
 * Snapshot of the session's default workspace, resolved once at boot from
 * the caller's membership directory (a request X-Workspace-Id pin, else the
 * sole membership). Read by `appendDoplStatus`. Null when the caller has 0
 * or 2+ memberships and sent no pin — in that state a no-arg tool call is
 * refused (the wrapper demands `workspace=`), so nothing is silently
 * routed to a guessed workspace.
 */
export interface ActiveWorkspaceState {
    id: string;
    slug: string;
    name: string;
    role: WorkspaceRole;
}
/**
 * How the workspace a call actually hit was chosen — surfaced verbatim in
 * the `_dopl_status` footer so the agent can positively confirm targeting.
 */
export type WorkspaceSource = "per-call arg" | "sole membership" | "header pin";
export interface EffectiveWorkspace extends ActiveWorkspaceState {
    source: WorkspaceSource;
}
/** The boot-resolved directory state this module is constructed from. */
export interface WorkspaceDirectoryOptions {
    /**
     * The caller's full active-membership directory, from the boot
     * `listWorkspaces()` call. Seeds the cache so per-call `workspace=`
     * resolution needs no extra loopback.
     */
    directory?: WorkspaceListItem[];
    /**
     * True when the boot `listWorkspaces()` call FAILED (transient), as opposed
     * to a genuine empty directory. Steers the refusal copy toward "couldn't
     * load — retry" instead of "you have none", and suppresses seeding the cache
     * with a bogus empty directory so a later `workspace=` resolution retries.
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
