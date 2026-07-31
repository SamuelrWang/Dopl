import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DoplClient } from "@dopl/client";
import type { WorkspaceListItem, WorkspaceRole, WorkspaceSummary } from "@dopl/client";
/** A resolved header pin (`X-Workspace-Id`) that becomes the no-arg default. */
interface WorkspacePin {
    name: string;
    slug: string;
}
export declare function buildInstructions(directory: WorkspaceListItem[], guidance?: {
    pin?: WorkspacePin | null;
    directoryLoadFailed?: boolean;
}): string;
export declare function createServer(client: DoplClient, options?: {
    isAdmin?: boolean;
    /**
     * The authenticated caller's own user id, from the boot status ping. Read
     * by `dopl_channel` so a channel read can render "· to you" instead of a
     * uuid the agent cannot match against itself — the difference between an
     * agent knowing a message is FOR IT and only knowing it is for someone.
     * Boot-resolved, never per call: `await` is a poll loop and an identity
     * lookup per read would be a round-trip on the hottest path in the tool.
     * Null when the ping failed; the tool then renders ids and claims nothing.
     */
    userId?: string | null;
    /** Session default workspace resolved at boot, or null (0/2+ memberships). */
    workspace?: WorkspaceSummary | null;
    role?: WorkspaceRole | null;
    /**
     * The caller's full active-membership directory, from the boot
     * `listWorkspaces()` call. Bakes the workspace table into the
     * instructions (M-2) and seeds `workspaceListCache` so per-call
     * `workspace=` resolution needs no extra loopback.
     */
    directory?: WorkspaceListItem[];
    /**
     * True when the boot `listWorkspaces()` call FAILED (transient), as
     * opposed to a genuine empty directory. Steers the refusal / instructions
     * copy toward "couldn't load — retry" instead of "you have none", and
     * suppresses seeding the cache with a bogus empty directory so a later
     * `workspace=` resolution retries the load.
     */
    directoryLoadFailed?: boolean;
    /**
     * How `workspace` was chosen at boot — `header pin` (request
     * X-Workspace-Id) or `sole membership` (auto-targeted single workspace).
     * Null when there is no session default. Drives the footer source label.
     */
    workspaceSource?: "header pin" | "sole membership" | null;
    /**
     * OAuth scopes granted for this session. Reserved for Stage 3 (OAuth):
     * when present and lacking `dopl.write`, write/admin tool ops are gated.
     * Absent ⇒ full access (stdio + bearer-key callers), so no behavior
     * change today.
     */
    scopes?: string[];
}): McpServer;
export {};
