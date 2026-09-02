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
import { registerStatusTool } from "./tools/status.js";
import { UNKNOWN_CALLER, type CallerIdentity } from "./tools/identity.js";
import { buildInstructions } from "./instructions.js";
import { createGates, offeredToolsFor } from "./gating.js";
import { createToolRegistrars } from "./registrar.js";
import { registerWorkspaceMetaTools } from "./meta-tools.js";
import { registerResources } from "./resources.js";
import {
  createWorkspaceDirectory,
  type ActiveWorkspaceState,
  type EffectiveWorkspace,
  type WorkspaceSource,
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
  // ⚠ The role narrowing is resolved HERE, to a set, so `gating.ts` owns the
  // table and `createGates` owns no vocabulary. `null` ⇒ no narrowing.
  const gates = createGates(canWrite, offeredToolsFor(options.toolProfile));

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
    // 🔒 The pin's store key. Absent here means `op="set"` REFUSES — the
    // fail-closed rule in `session-pin.ts`.
    sessionKey: options.sessionKey,
  });
  // ⚠ META PATH, CHARGED — the ONE tool that takes `MetaToolOptions.charged`
  // (Samuel's ruling Q2 (b)). It cannot be a domain tool: that path injects the
  // `workspace=` argument this tool exists to make answerable. 🔒 `directory` is
  // threaded in for the CONTAINER LOCK — `home-scopes.ts` narrows the channel
  // list to it, or a locked session enumerates its operator's other rooms.
  registerHomeTool(registerMetaTool, client, directory); // dopl_home — the caller's home channels
  // ⚠ META PATH, CHARGED, FOR THE SAME REASON `dopl_home` IS (T20, 2026-09-01).
  // The domain path injects a `workspace=` this tool exists to make unnecessary
  // — it answers ACROSS every workspace at once, so such an argument could only
  // ever be wrong — and it refuses a no-arg call from exactly the 2+-membership
  // orchestrator this is built for. 🔒 `directory` is threaded in for the
  // CONTAINER LOCK: `account-scope.ts` narrows the answer to it, or a locked
  // session enumerates its operator's other rooms.
  registerStatusTool(registerMetaTool, client, directory); // dopl_status — the whole check-in, one call

  // ⚠ THIS LIST IS THE SURFACE. Every published tool is registered here and
  // nowhere else, so `tools/list` == these calls minus `gating.ts ›
  // HIDDEN_TOOLS` and minus anything outside this session's role-scoped offer.
  // Each registrar exposes ONE `dopl_<domain>` action-tool dispatching on an
  // `op` arg. ⚠ THE FIVE `_admin` COMPANIONS ARE GONE (2026-09-02): every op on
  // all five was refused unconditionally, and the rule they advertised is now
  // enforced by `sessionOnly` on the REST routes — see `delete-policy.ts`.
  // 🔒 `directory` is the FOURTH argument and it is the ONLY thing that resolves
  // `to_workspace` on op="copy_base" — a container id (§4A) resolves, and a
  // locked session resolves nothing but its own container.
  registerKnowledgeTools(registerTool, client, caller, directory); // dopl_kb — the user's bases
  registerSkillTools(registerTool, client, caller); // dopl_skill
  registerChatTools(registerTool, client); // dopl_chats — the archive
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
  // 🔒 `directory` is the FIFTH argument and it is what narrows the two
  // ACCOUNT-WIDE reads to the container lock — see `tools/channel-ops-account.ts`.
  registerChannelTool(
    registerTool,
    client,
    caller,
    options.isAdmin ?? false,
    directory,
  ); // dopl_channel — cross-user collaboration channels
  // ⚠ `caller` for TWO reasons here: framing another member's INSTRUCTIONS block
  // as untrusted, and binding a confirm token to the identity that previewed.
  // 🔒 `directory` resolves `to_workspace` on op="copy", the same way it does for
  // `dopl_kb(op="copy_base")` above.
  registerAgentTools(registerTool, client, caller, directory); // dopl_agent — persistent agent identities

  return server;
}
