"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInstructions = void 0;
exports.createServer = createServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
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
// `factory.ts` re-exports `buildInstructions` from this module, and four
// suites import it from "./server.js". It moved to `instructions.ts`; the
// re-export keeps every caller unchanged (the `session-io.js` precedent).
var instructions_js_2 = require("./instructions.js");
Object.defineProperty(exports, "buildInstructions", { enumerable: true, get: function () { return instructions_js_2.buildInstructions; } });
function createServer(client, options = {}) {
    // OAuth scope gating. Fail CLOSED: a session gets write/admin capability
    // ONLY if it presents a scope set that explicitly includes `dopl.write`.
    // Absent/empty scopes no longer grant write — the OAuth transport (the only
    // caller) always forwards the token's scopes, so this is a no-op for real
    // sessions, but it closes the prior fail-open default where a scope-less
    // code path would have silently exposed every write/destructive tool.
    const canWrite = Array.isArray(options.scopes) && options.scopes.includes("dopl.write");
    // Session default workspace — resolved once at boot (factory.ts), never
    // mutated (there is no `set_workspace`; per-call `workspace=` scopes a
    // single call via AsyncLocalStorage without touching this). Null when the
    // caller has 0 or 2+ memberships and sent no pin.
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
    // The session default rendered as a footer-ready effective workspace, or
    // null when there is no default. Used by the meta-tools and the no-arg
    // tool path so the footer always names where the response came from (M-4).
    function sessionEffective() {
        if (!activeWorkspace || !sessionSource)
            return null;
        return { ...activeWorkspace, source: sessionSource };
    }
    const directory = (0, workspace_directory_js_1.createWorkspaceDirectory)(client, {
        directory: options.directory,
        directoryLoadFailed: options.directoryLoadFailed,
    });
    const server = new mcp_js_1.McpServer({
        name: "dopl",
        // Source of truth is package.json — read via version.ts so the
        // MCP handshake and any analytics that key on server version stay
        // accurate across publishes (audit fix #24).
        version: version_js_1.packageVersion,
    }, {
        // Thread the boot-resolved header pin so a 2+-membership connection
        // with a pin is told the pin IS its default (not "pass workspace= on
        // every call"). A sole membership needs no pin — the length===1 branch
        // already says "omit workspace=".
        instructions: (0, instructions_js_1.buildInstructions)(options.directory ?? [], {
            pin: options.workspaceSource === "header pin" && options.workspace
                ? { name: options.workspace.name, slug: options.workspace.slug }
                : null,
            directoryLoadFailed: options.directoryLoadFailed ?? false,
        }),
    });
    // The four gates, shared by BOTH registration paths — two at registration,
    // two per call, and the §2b delete refusal first and unconditional inside
    // `opRefusal`. They are built here and passed in rather than defined inside
    // a wrapper, because `registerMetaTool` registers straight onto the SDK
    // server and would otherwise pass through none of them. See `gating.ts`.
    const gates = (0, gating_js_1.createGates)(canWrite);
    const { registerTool, registerMetaTool } = (0, registrar_js_1.createToolRegistrars)({
        server,
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
    // ── Consolidated domain tools ──────────────────────────────────────
    // Each registrar exposes a single `dopl_<domain>` action-tool (plus a
    // `dopl_<domain>_admin` companion where the domain has destructive ops)
    // that dispatches on an `op` arg.
    // This list IS the surface: every published tool is registered here and
    // nowhere else, so `tools/list` is these calls minus `gating.ts ›
    // HIDDEN_TOOLS`. `registerClusterTools` / `registerWorkflowTools` sat here
    // as deliberate no-ops from 2026-08-07 (hidden, not deleted); their tools
    // and this pair of calls were deleted on 2026-08-11.
    (0, knowledge_js_1.registerKnowledgeTools)(registerTool, client, caller); // dopl_kb + dopl_kb_admin (user bases)
    (0, skills_js_1.registerSkillTools)(registerTool, client, caller); // dopl_skill + dopl_skill_admin
    (0, chats_js_1.registerChatTools)(registerTool, client); // dopl_chats + dopl_chats_admin (archive)
    (0, members_js_1.registerMembersTool)(registerTool, client, caller); // dopl_members — membership/teams/access (read-only)
    (0, map_js_1.registerMapTool)(registerTool, client); // dopl_map — compact workspace manifest
    (0, search_js_1.registerSearchTool)(registerTool, client); // dopl_search — cross-domain search
    (0, ontology_js_1.registerOntologyTool)(registerTool, client, caller); // dopl_ontology — routing graph (read-only)
    // The FULL identity, not just the id: `caller.runtime` is what decides
    // whether the wake teaching may claim a pending `await` outlives the turn.
    // This line passed `options.userId` alone while `registerMembersTool` two
    // lines up already took `caller`, so the one tool that needed the runtime
    // was the one tool that never saw it.
    // `isAdmin` (boot status ping) rides through so `op="members"` can scope
    // member email to admins + self (F-100); defaults false ⇒ fail-closed.
    (0, channel_js_1.registerChannelTool)(registerTool, client, caller, options.isAdmin ?? false); // dopl_channel — cross-user collaboration channels
    return server;
}
