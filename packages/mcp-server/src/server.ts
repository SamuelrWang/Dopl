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
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerClusterTools } from "./tools/cluster.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerChatTools } from "./tools/chats.js";
import { registerMembersTool } from "./tools/members.js";
import { registerMapTool } from "./tools/map.js";
import { registerSearchTool } from "./tools/search.js";
import { registerOntologyTool } from "./tools/ontology.js";
import { registerChannelTool } from "./tools/channel.js";
import { UNKNOWN_CALLER, type CallerIdentity } from "./tools/identity.js";
import { buildInstructions } from "./instructions.js";
import { createGates } from "./gating.js";
import { createToolRegistrars } from "./registrar.js";
import { registerWorkspaceMetaTools } from "./meta-tools.js";
import {
  createWorkspaceDirectory,
  type ActiveWorkspaceState,
  type EffectiveWorkspace,
} from "./workspace-directory.js";
import { packageVersion } from "./version.js";

// `factory.ts` re-exports `buildInstructions` from this module, and four
// suites import it from "./server.js". It moved to `instructions.ts`; the
// re-export keeps every caller unchanged (the `session-io.js` precedent).
export { buildInstructions } from "./instructions.js";

export function createServer(
  client: DoplClient,
  options: {
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
  } = {},
): McpServer {
  // OAuth scope gating. Fail CLOSED: a session gets write/admin capability
  // ONLY if it presents a scope set that explicitly includes `dopl.write`.
  // Absent/empty scopes no longer grant write — the OAuth transport (the only
  // caller) always forwards the token's scopes, so this is a no-op for real
  // sessions, but it closes the prior fail-open default where a scope-less
  // code path would have silently exposed every write/destructive tool.
  const canWrite =
    Array.isArray(options.scopes) && options.scopes.includes("dopl.write");

  // Session default workspace — resolved once at boot (factory.ts), never
  // mutated (there is no `set_workspace`; per-call `workspace=` scopes a
  // single call via AsyncLocalStorage without touching this). Null when the
  // caller has 0 or 2+ memberships and sent no pin.
  const caller: CallerIdentity = options.caller ?? {
    ...UNKNOWN_CALLER,
    userId: options.userId ?? null,
  };
  const activeWorkspace: ActiveWorkspaceState | null = options.workspace
    ? {
        id: options.workspace.id,
        slug: options.workspace.slug,
        name: options.workspace.name,
        role: options.role ?? "viewer",
      }
    : null;
  const sessionSource = options.workspaceSource ?? null;

  // The session default rendered as a footer-ready effective workspace, or
  // null when there is no default. Used by the meta-tools and the no-arg
  // tool path so the footer always names where the response came from (M-4).
  function sessionEffective(): EffectiveWorkspace | null {
    if (!activeWorkspace || !sessionSource) return null;
    return { ...activeWorkspace, source: sessionSource };
  }

  const directory = createWorkspaceDirectory(client, {
    directory: options.directory,
    directoryLoadFailed: options.directoryLoadFailed,
  });

  const server = new McpServer(
    {
      name: "dopl",
      // Source of truth is package.json — read via version.ts so the
      // MCP handshake and any analytics that key on server version stay
      // accurate across publishes (audit fix #24).
      version: packageVersion,
    },
    {
      // Thread the boot-resolved header pin so a 2+-membership connection
      // with a pin is told the pin IS its default (not "pass workspace= on
      // every call"). A sole membership needs no pin — the length===1 branch
      // already says "omit workspace=".
      instructions: buildInstructions(options.directory ?? [], {
        pin:
          options.workspaceSource === "header pin" && options.workspace
            ? { name: options.workspace.name, slug: options.workspace.slug }
            : null,
        directoryLoadFailed: options.directoryLoadFailed ?? false,
      }),
    },
  );

  // The four gates, shared by BOTH registration paths — two at registration,
  // two per call, and the §2b delete refusal first and unconditional inside
  // `opRefusal`. They are built here and passed in rather than defined inside
  // a wrapper, because `registerMetaTool` registers straight onto the SDK
  // server and would otherwise pass through none of them. See `gating.ts`.
  const gates = createGates(canWrite);

  const { registerTool, registerMetaTool } = createToolRegistrars({
    server,
    gates,
    directory,
    activeWorkspace,
    sessionEffective,
    caller,
  });

  registerWorkspaceMetaTools(registerMetaTool, {
    directory,
    activeWorkspace,
    caller,
  });

  // ── Consolidated domain tools ──────────────────────────────────────
  // Each registrar exposes a single `dopl_<domain>` action-tool (plus a
  // `dopl_<domain>_admin` companion where the domain has destructive ops)
  // that dispatches on an `op` arg.
  // RETIRED but still wired: both calls are no-ops because every tool they
  // register is in HIDDEN_TOOLS. Left in place on purpose — "hide, don't
  // delete" — so the feature comes back by editing that one set, and so the
  // parity/scope suites keep checking these tools' schemas against their
  // sources while they sit dormant.
  registerClusterTools(registerTool, client); // dopl_cluster + dopl_cluster_admin (hidden)
  registerWorkflowTools(registerTool, client); // dopl_workflow + dopl_workflow_admin (hidden)
  registerKnowledgeTools(registerTool, client, caller); // dopl_kb + dopl_kb_admin (user bases)
  registerSkillTools(registerTool, client, caller); // dopl_skill + dopl_skill_admin
  registerChatTools(registerTool, client); // dopl_chats + dopl_chats_admin (archive)
  registerMembersTool(registerTool, client, caller); // dopl_members — membership/teams/access (read-only)
  registerMapTool(registerTool, client); // dopl_map — compact workspace manifest
  registerSearchTool(registerTool, client); // dopl_search — cross-domain search
  registerOntologyTool(registerTool, client, caller); // dopl_ontology — routing graph (read-only)
  // The FULL identity, not just the id: `caller.runtime` is what decides
  // whether the wake teaching may claim a pending `await` outlives the turn.
  // This line passed `options.userId` alone while `registerMembersTool` two
  // lines up already took `caller`, so the one tool that needed the runtime
  // was the one tool that never saw it.
  registerChannelTool(registerTool, client, caller); // dopl_channel — cross-user collaboration channels

  return server;
}
