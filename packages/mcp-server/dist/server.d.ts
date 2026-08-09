/**
 * server.ts — BOOT A SESSION AND WIRE ITS TOOLS. Nothing else.
 *
 * SPLIT 2026-08-08 (§2). This file was 1045 lines — the largest hand-written
 * file in the tree and the table's longest-standing overdue split. It is now
 * the thin registrar the 2026-07-20 op-dispatch precedent asks for: resolve the
 * session's identity and workspace, build the gates, build the two registration
 * helpers, hand them to the ten domain registrars. Every layer it used to
 * contain is a sibling:
 *
 *   instructions.ts        the MCP `instructions` briefing + the shared
 *                          workspace copy (`buildInstructions`, re-exported
 *                          below because `factory.ts` and four suites import
 *                          it from HERE).
 *   workspace-directory.ts membership cache, `workspace=` resolution, and the
 *                          fail-closed M-3 refusal.
 *   gating.ts              THE FOUR GATES + their three tables. Two fire at
 *                          registration, two per call; the §2b delete refusal
 *                          is first and unconditional. Read that file's header
 *                          before touching either registration path.
 *   delete-policy.ts       §2b itself — the refusal AND the description the
 *                          `_admin` tools advertise. Pre-existing; the
 *                          precedent this split followed.
 *   registrar.ts           `registerTool` / `registerMetaTool`, the workspace
 *                          arg, `strictInput`, the ALS routing.
 *   status-footer.ts       the `_dopl_status` footer (M-4).
 *   meta-tools.ts          `list_workspaces` + `current_workspace`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DoplClient } from "@dopl/client";
import type { WorkspaceListItem, WorkspaceRole, WorkspaceSummary } from "@dopl/client";
import { type CallerIdentity } from "./tools/identity.js";
export { buildInstructions } from "./instructions.js";
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
    /**
     * The caller's identity + locus, resolved once at boot (factory.ts). The
     * `_dopl_status` footer, `current_workspace`, `dopl_members` and
     * `dopl_ontology` all render FROM THIS ONE RECORD — that is the fix: three
     * surfaces used to answer "who am I" from three sources that could
     * disagree inside a single connection. Defaults to `UNKNOWN_CALLER`, which
     * renders as "unresolved" everywhere rather than as a confident guess.
     */
    caller?: CallerIdentity;
    /** Session default workspace resolved at boot, or null (0/2+ memberships). */
    workspace?: WorkspaceSummary | null;
    role?: WorkspaceRole | null;
    /**
     * The caller's full active-membership directory, from the boot
     * `listWorkspaces()` call. Bakes the workspace table into the
     * instructions (M-2) and seeds the workspace-directory cache so per-call
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
