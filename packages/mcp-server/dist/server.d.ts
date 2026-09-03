/**
 * server.ts — BOOT A SESSION AND WIRE ITS TOOLS. Nothing else: resolve identity
 * and workspace, build the gates, build the two registration helpers, hand them
 * to the domain registrars. Every layer it used to contain is a sibling:
 *
 *   instructions.ts        MCP `instructions` briefing + shared workspace copy
 *                          (`buildInstructions`, re-exported below because
 *                          `factory.ts` and four suites import it from HERE).
 *   workspace-directory.ts membership cache, `workspace=` resolution, the
 *                          container lock, and the search fan-out's legs.
 *   gating.ts              THE FOUR GATES + their tables. ⚠ Read that file's
 *                          header before touching either registration path.
 *   delete-policy.ts       the app-only-deletion rule: the refusal, and the
 *                          table of delete ops no tool may publish.
 *   registrar.ts           `registerTool` / `registerMetaTool`, workspace arg,
 *                          `strictInput`, ALS routing.
 *   status-footer.ts       the `_dopl_status` footer.
 *   meta-tools.ts          `dopl_workspaces` — the one orientation tool.
 *   resources.ts           the MCP RESOURCES — today the channels doctrine,
 *                          which is where the prose the tool descriptions and
 *                          write results used to repeat now lives.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DoplClient } from "@dopl/client";
import type { WorkspaceListItem, WorkspaceRole, WorkspaceSummary } from "@dopl/client";
import { type CallerIdentity } from "./tools/identity.js";
import { type WorkspaceSource } from "./workspace-directory.js";
export { buildInstructions } from "./instructions.js";
export declare function createServer(client: DoplClient, options?: {
    isAdmin?: boolean;
    /**
     * Caller's own user id from the boot status ping. Lets `dopl_channel`
     * render "· to you" instead of a uuid the agent cannot match against
     * itself. ⚠ Boot-resolved, never per call — `await` is a poll loop. Null
     * when the ping failed; the tool then renders ids and claims nothing.
     */
    userId?: string | null;
    /**
     * ⚠ THE ONE identity record. `_dopl_status`, `dopl_workspaces`,
     * `dopl_members` and `dopl_ontology` all render FROM THIS — three surfaces
     * answering "who am I" from three sources can disagree within one
     * connection. Defaults to `UNKNOWN_CALLER`, which renders "unresolved"
     * everywhere rather than a confident guess.
     */
    caller?: CallerIdentity;
    /**
     * The container this connection is BOUND to (`X-Workspace-Id`), or null.
     * ⚠ Null is ORDINARY since B13 and is never a refusal — the server resolves
     * the caller's own container when a call names none.
     */
    workspace?: WorkspaceSummary | null;
    role?: WorkspaceRole | null;
    /**
     * Caller's full active-membership directory from the boot
     * `listWorkspaces()`. Bakes the workspace table into the instructions and
     * seeds the directory cache so per-call `workspace=` needs no loopback.
     */
    directory?: WorkspaceListItem[];
    /**
     * ⚠ True when the boot `listWorkspaces()` FAILED, as opposed to a genuine
     * empty directory. Steers copy to "couldn't load — retry" instead of "you
     * have none", and suppresses seeding a bogus empty cache so a later
     * `workspace=` resolution retries the load.
     */
    directoryLoadFailed?: boolean;
    /**
     * 🔒 The container lock, resolved by `factory.ts › bootServer`. Threaded
     * verbatim into `createWorkspaceDirectory` (whose option docblock carries
     * the rule and the tripwire-not-fence caveat) and, separately, into the
     * INSTRUCTIONS table below — the two must agree, or the briefing advertises
     * workspaces the tools then refuse.
     */
    lockedTo?: WorkspaceListItem | null;
    /**
     * How `workspace` was chosen at boot — `header pin` (X-Workspace-Id) is the
     * only way since B13. Null when the connection is unbound. Drives the
     * footer source label.
     */
    workspaceSource?: WorkspaceSource | null;
    /**
     * OAuth scopes for this session. Present and lacking `dopl.write` ⇒
     * write ops gated.
     */
    scopes?: string[];
    /**
     * The CONTAINMENT PROFILE this connection reports — the
     * `X-Dopl-Tool-Profile` request header, forwarded verbatim by the transport.
     * `gating.ts › TOOL_PROFILES` is the vocabulary and `PROFILE_TOOLS` decides
     * what each one is offered.
     *
     * ⚠ IT MAY ONLY NARROW, AND IT IS A HINT AND NOT A FENCE. Absent (`null` /
     * `undefined`, the only "no claim" values) serves the whole surface; a
     * profile this server cannot place is narrowed to the NARROWEST one, because
     * the desktop stamps the containment a session is already under and an offer
     * wider than that is a tool the machine refuses. Because it is
     * caller-supplied, nothing may be GRANTED on it: containment stays the
     * desktop's `disallowedTools` + `grantDecision`, the credential's scopes and
     * `gating.ts › WRITE_OPS`.
     */
    toolProfile?: string | null;
    /**
     * The caller's own LIVE AGENT HANDLES, when the transport already knows
     * them — the desktop spawned them, so it does. ⚠ ADVISORY AND OPTIONAL: the
     * server cannot learn them at boot without a loopback `bootServer` forbids,
     * and an ABSENT list renders as a pointer to `dopl_status` rather than as a
     * claim of none. See `instructions.ts › ConnectionIdentity.liveAgents`.
     */
    liveAgents?: readonly string[];
    /**
     * The posture this session was spawned under (`<tools>/<messages> chain=…`),
     * when the transport stamped one. ⚠ Same terms as {@link liveAgents}: the
     * desktop CLAMPS a requested posture and is the only layer that knows the
     * resolved value, so absent means unreported and renders as nothing.
     */
    posture?: string | null;
}): McpServer;
