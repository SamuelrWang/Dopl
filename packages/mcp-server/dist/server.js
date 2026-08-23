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
    });
    const listableDirectory = (options.directory ?? []).filter(client_1.isStandardWorkspace);
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
    const { registerTool, registerMetaTool } = (0, registrar_js_1.createToolRegistrars)({
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
    });
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
    (0, search_js_1.registerSearchTool)(registerTool, client); // dopl_search — cross-domain search
    (0, ontology_js_1.registerOntologyTool)(registerTool, client, caller); // dopl_ontology — routing graph (read-only)
    // ⚠ FULL identity, not just the id — `caller.runtime` decides whether the
    // wake teaching may claim a pending `await` outlives the turn. ⚠ `isAdmin`
    // scopes member email to admins + self; defaults false ⇒ fail-closed.
    (0, channel_js_1.registerChannelTool)(registerTool, client, caller, options.isAdmin ?? false); // dopl_channel — cross-user collaboration channels
    return server;
}
