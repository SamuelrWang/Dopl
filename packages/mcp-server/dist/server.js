"use strict";
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
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInstructions = void 0;
exports.createServer = createServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const client_1 = require("@dopl/client");
const knowledge_js_1 = require("./tools/knowledge.js");
const skills_js_1 = require("./tools/skills.js");
const chats_js_1 = require("./tools/chats.js");
const members_js_1 = require("./tools/members.js");
const map_js_1 = require("./tools/map.js");
const search_js_1 = require("./tools/search.js");
const ontology_js_1 = require("./tools/ontology.js");
const channel_js_1 = require("./tools/channel.js");
const agent_js_1 = require("./tools/agent.js");
const home_js_1 = require("./tools/home.js");
const status_js_1 = require("./tools/status.js");
const identity_js_1 = require("./tools/identity.js");
const instructions_js_1 = require("./instructions.js");
const gating_js_1 = require("./gating.js");
const registrar_js_1 = require("./registrar.js");
const meta_tools_js_1 = require("./meta-tools.js");
const workspace_directory_js_1 = require("./workspace-directory.js");
const version_js_1 = require("./version.js");
// ⚠ Keep: `factory.ts` and four suites import `buildInstructions` from HERE.
var instructions_js_2 = require("./instructions.js");
Object.defineProperty(exports, "buildInstructions", { enumerable: true, get: function () { return instructions_js_2.buildInstructions; } });
function createServer(client, options = {}) {
    // ⚠ FAIL CLOSED: write/admin capability ONLY on an explicit `dopl.write`
    // scope. Absent/empty scopes must never grant write — a scope-less code path
    // would otherwise silently expose every write/destructive tool.
    const canWrite = Array.isArray(options.scopes) && options.scopes.includes("dopl.write");
    // ⚠ Session default resolved once at boot and NEVER mutated — there is no
    // `set_workspace`; per-call `workspace=` scopes one call via AsyncLocalStorage
    // without touching this. Null on 0 or 2+ memberships with no pin.
    const caller = options.caller ?? {
        ...identity_js_1.UNKNOWN_CALLER,
        userId: options.userId ?? null,
    };
    const activeWorkspace = options.workspace
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
    function sessionEffective() {
        if (!activeWorkspace || !sessionSource)
            return null;
        return { ...activeWorkspace, source: sessionSource };
    }
    const directory = (0, workspace_directory_js_1.createWorkspaceDirectory)(client, {
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
        : (options.directory ?? []).filter(client_1.isStandardWorkspace);
    const server = new mcp_js_1.McpServer({
        name: "dopl",
        // ⚠ Source of truth is package.json via version.ts, so the MCP handshake
        // and version-keyed analytics stay accurate across publishes.
        version: version_js_1.packageVersion,
    }, {
        // ⚠ Thread the boot-resolved pin so a 2+-membership connection with a pin
        // is told the pin IS its default, not "pass workspace= on every call".
        // ⚠ LISTABLE directory only — the targeting table an agent reads must not
        // advertise `kind='link'` home-channel containers. The full directory
        // still seeds the cache above, so `workspace=<link>` resolves.
        instructions: (0, instructions_js_1.buildInstructions)(listableDirectory, {
            pin: options.workspaceSource === "header pin" && options.workspace
                ? { name: options.workspace.name, slug: options.workspace.slug }
                : null,
            directoryLoadFailed: options.directoryLoadFailed ?? false,
        }),
    });
    // ⚠ Four gates shared by BOTH registration paths, built here and passed in
    // rather than defined inside a wrapper: `registerMetaTool` registers straight
    // onto the SDK server and would otherwise pass through none of them.
    const gates = (0, gating_js_1.createGates)(canWrite);
    const { registerTool, registerMetaTool, chargeCredit } = (0, registrar_js_1.createToolRegistrars)({
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
    (0, meta_tools_js_1.registerWorkspaceMetaTools)(registerMetaTool, {
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
    (0, home_js_1.registerHomeTool)(registerMetaTool, client, directory); // dopl_home — the caller's home channels
    // ⚠ META PATH, CHARGED, FOR THE SAME REASON `dopl_home` IS (T20, 2026-09-01).
    // The domain path injects a `workspace=` this tool exists to make unnecessary
    // — it answers ACROSS every workspace at once, so such an argument could only
    // ever be wrong — and it refuses a no-arg call from exactly the 2+-membership
    // orchestrator this is built for. 🔒 `directory` is threaded in for the
    // CONTAINER LOCK: `account-scope.ts` narrows the answer to it, or a locked
    // session enumerates its operator's other rooms.
    (0, status_js_1.registerStatusTool)(registerMetaTool, client, directory); // dopl_status — the whole check-in, one call
    // ⚠ THIS LIST IS THE SURFACE. Every published tool is registered here and
    // nowhere else, so `tools/list` == these calls minus `gating.ts ›
    // HIDDEN_TOOLS`. Each registrar exposes one `dopl_<domain>` action-tool (plus
    // a `dopl_<domain>_admin` companion where the domain has destructive ops)
    // dispatching on an `op` arg.
    (0, knowledge_js_1.registerKnowledgeTools)(registerTool, client, caller); // dopl_kb + dopl_kb_admin (user bases)
    (0, skills_js_1.registerSkillTools)(registerTool, client, caller); // dopl_skill + dopl_skill_admin
    (0, chats_js_1.registerChatTools)(registerTool, client); // dopl_chats + dopl_chats_admin (archive)
    (0, members_js_1.registerMembersTool)(registerTool, client, caller); // dopl_members — membership/teams/access (read-only)
    (0, map_js_1.registerMapTool)(registerTool, client); // dopl_map — compact workspace manifest
    // ⚠ `directory` + `chargeCredit` are what make `scope="everywhere"` possible
    // AT ALL: the leg list must be the LOCKED list (B3), and a fan-out charges
    // per leg (ruling Q3). Built without them the tool answers the single-scope
    // search and says so rather than silently searching one scope.
    (0, search_js_1.registerSearchTool)(registerTool, client, directory, chargeCredit); // dopl_search — cross-domain search
    (0, ontology_js_1.registerOntologyTool)(registerTool, client, caller); // dopl_ontology — routing graph (read-only)
    // ⚠ FULL identity, not just the id — `caller.runtime` decides whether the
    // wake teaching may claim a pending `await` outlives the turn. ⚠ `isAdmin`
    // scopes member email to admins + self; defaults false ⇒ fail-closed.
    // 🔒 `directory` is the FIFTH argument and it is what narrows the two
    // ACCOUNT-WIDE reads to the container lock — see `tools/channel-ops-account.ts`.
    (0, channel_js_1.registerChannelTool)(registerTool, client, caller, options.isAdmin ?? false, directory); // dopl_channel — cross-user collaboration channels
    // ⚠ `caller` for TWO reasons here: framing another member's INSTRUCTIONS block
    // as untrusted, and binding a confirm token to the identity that previewed.
    (0, agent_js_1.registerAgentTools)(registerTool, client, caller); // dopl_agent + dopl_agent_admin — persistent agent identities
    return server;
}
