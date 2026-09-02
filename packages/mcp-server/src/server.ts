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
 *   delete-policy.ts       the delete refusal AND the description `_admin`
 *                          tools advertise.
 *   registrar.ts           `registerTool` / `registerMetaTool`, workspace arg,
 *                          `strictInput`, ALS routing.
 *   status-footer.ts       the `_dopl_status` footer.
 *   meta-tools.ts          `list_workspaces` + `current_workspace`.
 *   resources.ts           the MCP RESOURCES — today the channels doctrine,
 *                          which is where the prose the tool descriptions and
 *                          write results used to repeat now lives.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DoplClient, isStandardWorkspace } from "@dopl/client";
import type { WorkspaceListItem, WorkspaceRole, WorkspaceSummary } from "@dopl/client";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerChatTools } from "./tools/chats.js";
import { registerMembersTool } from "./tools/members.js";
import { registerMapTool } from "./tools/map.js";
import { registerSearchTool } from "./tools/search.js";
import { registerOntologyTool } from "./tools/ontology.js";
import { registerChannelTool } from "./tools/channel.js";
import { registerAgentTools } from "./tools/agent.js";
import { registerHomeTool } from "./tools/home.js";
import { UNKNOWN_CALLER, type CallerIdentity } from "./tools/identity.js";
import { buildInstructions } from "./instructions.js";
import { createGates } from "./gating.js";
import { createToolRegistrars } from "./registrar.js";
import { registerWorkspaceMetaTools } from "./meta-tools.js";
import { registerResources } from "./resources.js";
import {
  createWorkspaceDirectory,
  type ActiveWorkspaceState,
  type EffectiveWorkspace,
} from "./workspace-directory.js";
import { packageVersion } from "./version.js";

// ⚠ Keep: `factory.ts` and four suites import `buildInstructions` from HERE.
export { buildInstructions } from "./instructions.js";

export function createServer(
  client: DoplClient,
  options: {
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
     * How `workspace` was chosen at boot — `header pin` (X-Workspace-Id) or
     * `sole membership`. Null when there is no session default. Drives the
     * footer source label.
     */
    workspaceSource?: "header pin" | "sole membership" | null;
    /**
     * OAuth scopes for this session. Present and lacking `dopl.write` ⇒
     * write/admin ops gated.
     */
    scopes?: string[];
  } = {},
): McpServer {
  // ⚠ FAIL CLOSED: write/admin capability ONLY on an explicit `dopl.write`
  // scope. Absent/empty scopes must never grant write — a scope-less code path
  // would otherwise silently expose every write/destructive tool.
  const canWrite =
    Array.isArray(options.scopes) && options.scopes.includes("dopl.write");

  // ⚠ Session default resolved once at boot and NEVER mutated — there is no
  // `set_workspace`; per-call `workspace=` scopes one call via AsyncLocalStorage
  // without touching this. Null on 0 or 2+ memberships with no pin.
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

  // Session default rendered footer-ready, or null. Used by the meta-tools and
  // the no-arg tool path so the footer always names where a response came from.
  function sessionEffective(): EffectiveWorkspace | null {
    if (!activeWorkspace || !sessionSource) return null;
    return { ...activeWorkspace, source: sessionSource };
  }

  const directory = createWorkspaceDirectory(client, {
    directory: options.directory,
    directoryLoadFailed: options.directoryLoadFailed,
    lockedTo: options.lockedTo,
  });
  // 🔒 A LOCKED SESSION'S INSTRUCTION TABLE IS EMPTY, and that is the right
  // answer rather than `[lockedTo]`: the table exists to tell an agent what it
  // can TARGET with `workspace=`, and a locked session already has that one
  // workspace as its resolved pin (the briefing says so on the `pin` line
  // below). Listing the container here would additionally put a link
  // container in an advertisement, which §4A forbids everywhere else.
  const listableDirectory = options.lockedTo
    ? []
    : (options.directory ?? []).filter(isStandardWorkspace);

  const server = new McpServer(
    {
      name: "dopl",
      // ⚠ Source of truth is package.json via version.ts, so the MCP handshake
      // and version-keyed analytics stay accurate across publishes.
      version: packageVersion,
    },
    {
      // ⚠ Thread the boot-resolved pin so a 2+-membership connection with a pin
      // is told the pin IS its default, not "pass workspace= on every call".
      // ⚠ LISTABLE directory only — the targeting table an agent reads must not
      // advertise `kind='link'` home-channel containers. The full directory
      // still seeds the cache above, so `workspace=<link>` resolves.
      instructions: buildInstructions(listableDirectory, {
        pin:
          options.workspaceSource === "header pin" && options.workspace
            ? { name: options.workspace.name, slug: options.workspace.slug }
            : null,
        directoryLoadFailed: options.directoryLoadFailed ?? false,
      }),
    },
  );

  // ⚠ PULLED, NOT PUSHED. The channels doctrine is a resource (and
  // `dopl_channel(op="help")`) rather than description prose, so an agent pays
  // for it when it asks and never on connection. See `resources.ts`.
  registerResources(server);

  // ⚠ Four gates shared by BOTH registration paths, built here and passed in
  // rather than defined inside a wrapper: `registerMetaTool` registers straight
  // onto the SDK server and would otherwise pass through none of them.
  const gates = createGates(canWrite);

  const { registerTool, registerMetaTool, chargeCredit } = createToolRegistrars({
    server,
    // One MCP credit per domain-tool call through this client
    // (`registrar.ts › createCreditedRunner`); meta-tools are exempt.
    client,
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
  // ⚠ META PATH, CHARGED — the ONE tool that takes `MetaToolOptions.charged`
  // (Samuel's ruling Q2 (b)). It cannot be a domain tool: that path injects the
  // `workspace=` argument this tool exists to make answerable. 🔒 `directory` is
  // threaded in for the CONTAINER LOCK — `home-scopes.ts` narrows the channel
  // list to it, or a locked session enumerates its operator's other rooms.
  registerHomeTool(registerMetaTool, client, directory); // dopl_home — the caller's home channels

  // ⚠ THIS LIST IS THE SURFACE. Every published tool is registered here and
  // nowhere else, so `tools/list` == these calls minus `gating.ts ›
  // HIDDEN_TOOLS`. Each registrar exposes one `dopl_<domain>` action-tool (plus
  // a `dopl_<domain>_admin` companion where the domain has destructive ops)
  // dispatching on an `op` arg.
  registerKnowledgeTools(registerTool, client, caller); // dopl_kb + dopl_kb_admin (user bases)
  registerSkillTools(registerTool, client, caller); // dopl_skill + dopl_skill_admin
  registerChatTools(registerTool, client); // dopl_chats + dopl_chats_admin (archive)
  registerMembersTool(registerTool, client, caller); // dopl_members — membership/teams/access (read-only)
  registerMapTool(registerTool, client); // dopl_map — compact workspace manifest
  // ⚠ `directory` + `chargeCredit` are what make `scope="everywhere"` possible
  // AT ALL: the leg list must be the LOCKED list (B3), and a fan-out charges
  // per leg (ruling Q3). Built without them the tool answers the single-scope
  // search and says so rather than silently searching one scope.
  registerSearchTool(registerTool, client, directory, chargeCredit); // dopl_search — cross-domain search
  registerOntologyTool(registerTool, client, caller); // dopl_ontology — routing graph (read-only)
  // ⚠ FULL identity, not just the id — `caller.runtime` decides whether the
  // wake teaching may claim a pending `await` outlives the turn. ⚠ `isAdmin`
  // scopes member email to admins + self; defaults false ⇒ fail-closed.
  registerChannelTool(registerTool, client, caller, options.isAdmin ?? false); // dopl_channel — cross-user collaboration channels
  // ⚠ `caller` for TWO reasons here: framing another member's INSTRUCTIONS block
  // as untrusted, and binding a confirm token to the identity that previewed.
  registerAgentTools(registerTool, client, caller); // dopl_agent + dopl_agent_admin — persistent agent identities

  return server;
}
