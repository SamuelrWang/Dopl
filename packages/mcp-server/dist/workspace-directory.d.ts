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
    /**
     * 🔒 THE CONTAINER LOCK (plan §4.4 B3). When set, this session may see and
     * address exactly ONE workspace: this one. `getWorkspaceList()` answers
     * `[lockedTo]` and `resolveWorkspaceRef` answers `null` for every other ref,
     * whatever the cache holds.
     *
     * Set by `factory.ts › bootServer` when the session's pin resolves to a
     * `kind='link'` container with MORE THAN ONE active member — i.e. an agent
     * working in a room a PEER is also in. Its operator's other workspaces are
     * not that peer's business, and neither is their existence.
     *
     * ⚠ IT IS A TRIPWIRE, NOT A FENCE, AND THE DIFFERENCE MUST NOT BE DRESSED
     * AWAY. It narrows what THIS MCP connection will do. A `full`-profile session
     * has Bash and the operator's 90-day device token is on disk, so the same
     * agent can open a SECOND MCP connection with no pin, or issue the loopback
     * HTTP itself, and this object will never see either. What actually refuses
     * those is the credential lock (the token is workspace-scoped, so
     * `with-workspace-auth.ts` 403s a contradicting target) and the audience
     * ceiling in `knowledge/server/service-audience.ts`, both of which live in the
     * server that owns the rows. This lock exists so a WELL-BEHAVED agent is never
     * even shown the door — which is worth having, and is not the same as the door
     * being locked.
     */
    lockedTo?: WorkspaceListItem | null;
}
export interface WorkspaceDirectory {
    /**
     * The caller's LISTABLE memberships, cached for
     * {@link WORKSPACE_CACHE_TTL_MS}. ⚠ `kind='link'` home-channel containers are
     * excluded — they are never advertised to an agent.
     */
    getWorkspaceList(): Promise<WorkspaceListItem[]>;
    /**
     * A slug-or-UUID `workspace=` ref resolved against ALL memberships, links
     * included: explicit addressing is how a home channel is reached.
     */
    resolveWorkspaceRef(ref: string): Promise<WorkspaceListItem | null>;
    /** The isError response for a no-`workspace=` call with no session default. */
    noWorkspaceError(): Promise<ToolResponse>;
}
export declare function createWorkspaceDirectory(client: DoplClient, options?: WorkspaceDirectoryOptions): WorkspaceDirectory;
