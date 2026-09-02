/**
 * server.ts — BOOT A SESSION AND WIRE ITS TOOLS. Nothing else: resolve identity
 * and workspace, build the gates, build the two registration helpers, hand them
 * to the domain registrars. Every layer it used to contain is a sibling:
 *
 *   instructions.ts        MCP `instructions` briefing + shared workspace copy
 *                          (`buildInstructions`, re-exported below because
 *                          `factory.ts` and four suites import it from HERE).
 *   workspace-directory.ts membership cache, `workspace=` resolution, the
 *                          fail-closed no-default refusal.
 *   gating.ts              THE FOUR GATES + their tables. ⚠ Read that file's
 *                          header before touching either registration path.
 *   delete-policy.ts       the app-only-deletion rule: the refusal, and the
 *                          table of delete ops no tool may publish.
 *   registrar.ts           `registerTool` / `registerMetaTool`, workspace arg,
 *                          `strictInput`, ALS routing.
 *   status-footer.ts       the `_dopl_status` footer.
 *   meta-tools.ts          `list_workspaces` + `current_workspace`.
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
     * ⚠ THE ONE identity record. `_dopl_status`, `current_workspace`,
     * `dopl_members` and `dopl_ontology` all render FROM THIS — three surfaces
     * answering "who am I" from three sources can disagree within one
     * connection. Defaults to `UNKNOWN_CALLER`, which renders "unresolved"
     * everywhere rather than a confident guess.
     */
    caller?: CallerIdentity;
    /** Session default workspace resolved at boot, or null (0/2+ memberships). */
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
     * How `workspace` was chosen at boot — `header pin` (X-Workspace-Id), the
     * agent's own `session pin` (`session-pin.ts`), or `sole membership`. Null
     * when there is no session default. Drives the footer source label.
     */
    workspaceSource?: WorkspaceSource | null;
    /**
     * 🔒 OPAQUE SESSION KEY for the workspace pin — see
     * `factory.ts › BootOptions.sessionKey`. Threaded to the meta-tools, which
     * are its only writers. Absent ⇒ `current_workspace(op="set")` REFUSES
     * rather than reporting a pin nothing stored.
     */
    sessionKey?: string;
    /**
     * OAuth scopes for this session. Present and lacking `dopl.write` ⇒
     * write ops gated.
     */
    scopes?: string[];
    /**
     * The ROLE this connection says it is running as — the `X-Dopl-Tool-Profile`
     * request header, forwarded verbatim by the transport. `gating.ts ›
     * TOOL_PROFILE_TOOLS` decides what a role means; it is EMPTY today, so every
     * value serves the whole surface and this changes nothing yet (wave B fills
     * the table).
     *
     * ⚠ IT MAY ONLY NARROW, AND IT IS A HINT AND NOT A FENCE. Absent, unknown,
     * or a role with no row all resolve to "serve everything", so a stale
     * desktop can never be locked out; and because it is caller-supplied,
     * nothing may be GRANTED on it. Containment stays the desktop's
     * `disallowedTools` + `grantDecision` and the credential itself.
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
