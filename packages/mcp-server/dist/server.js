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
const agent_js_1 = require("./tools/agent.js");
const status_js_1 = require("./tools/status.js");
const identity_js_1 = require("./tools/identity.js");
const instructions_js_1 = require("./instructions.js");
const gating_js_1 = require("./gating.js");
const registrar_js_1 = require("./registrar.js");
const meta_tools_js_1 = require("./meta-tools.js");
const resources_js_1 = require("./resources.js");
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
    // ⚠ The connection's container is resolved once at boot and NEVER mutated —
    // there is no `set_workspace` and no pin; per-call `workspace=` scopes one
    // call via AsyncLocalStorage without touching this.
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
    // The binding rendered footer-ready, or null. Used by the meta tools and the
    // no-arg tool path so the footer names where a response came from.
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
    // can TARGET with `workspace=`, and a locked session is already bound to that
    // one container (the briefing says so on the identity line).
    // ⚠ **IT IS THE WHOLE DIRECTORY OTHERWISE, CONTAINERS INCLUDED** (B10): the
    // briefing's table renders each row's KIND, so listing a container names it
    // for what it is rather than advertising it as a workspace.
    const listableDirectory = options.lockedTo ? [] : (options.directory ?? []);
    const server = new mcp_js_1.McpServer({
        name: "dopl",
        // ⚠ Source of truth is package.json via version.ts, so the MCP handshake
        // and version-keyed analytics stay accurate across publishes.
        version: version_js_1.packageVersion,
    }, {
        // ⚠ Thread the boot-resolved binding so a connection with one is told
        // which container it is in, not "pass workspace= on every call".
        instructions: (0, instructions_js_1.buildInstructions)(listableDirectory, {
            pin: options.workspaceSource === "header pin" && options.workspace
                ? { name: options.workspace.name, slug: options.workspace.slug }
                : null,
            directoryLoadFailed: options.directoryLoadFailed ?? false,
            // ⚠ PER-CONNECTION IDENTITY (A14). Every field is already in hand here
            // — no loopback is added, which `factory.ts › bootServer` forbids.
            identity: {
                userId: caller.userId,
                boundChannelId: (0, identity_js_1.boundChannelId)(caller),
                liveAgents: options.liveAgents,
                posture: options.posture ?? null,
            },
        }),
    });
    // ⚠ PULLED, NOT PUSHED. The channels doctrine is a resource (and
    // `dopl_channel(op="help")`) rather than description prose, so an agent pays
    // for it when it asks and never on connection. See `resources.ts`.
    (0, resources_js_1.registerResources)(server);
    // ⚠ Four gates shared by BOTH registration paths, built here and passed in
    // rather than defined inside a wrapper: `registerMetaTool` registers straight
    // onto the SDK server and would otherwise pass through none of them.
    // ⚠ The profile narrowing is resolved HERE, to a set, so `gating.ts` owns the
    // table and `createGates` owns no vocabulary. `null` ⇒ no narrowing.
    const gates = (0, gating_js_1.createGates)(canWrite, (0, gating_js_1.offeredToolsFor)(options.toolProfile));
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
    }); // dopl_workspaces — every container the caller is in
    // ⚠ META PATH, CHARGED — the ONE tool that takes `MetaToolOptions.charged`
    // since B13 retired `dopl_home` (T20, 2026-09-01).
    // The domain path injects a `workspace=` this tool exists to make unnecessary
    // — it answers ACROSS every workspace at once, so such an argument could only
    // ever be wrong — and it refuses a no-arg call from exactly the 2+-membership
    // orchestrator this is built for. 🔒 `directory` is threaded in for the
    // CONTAINER LOCK: `account-scope.ts` narrows the answer to it, or a locked
    // session enumerates its operator's other rooms.
    (0, status_js_1.registerStatusTool)(registerMetaTool, client, directory); // dopl_status — the whole check-in, one call
    // ⚠ THIS LIST IS THE SURFACE. Every published tool is registered here and
    // nowhere else, so `tools/list` == these calls minus `gating.ts ›
    // HIDDEN_TOOLS` and minus anything outside this session's profile offer.
    // Each registrar exposes ONE `dopl_<domain>` action-tool dispatching on an
    // `op` arg. ⚠ THE FIVE `_admin` COMPANIONS ARE GONE (2026-09-02): every op on
    // all five was refused unconditionally, and the rule they advertised is now
    // enforced by `sessionOnly` on the REST routes — see `delete-policy.ts`.
    // 🔒 `directory` is the FOURTH argument and it is the ONLY thing that resolves
    // `to` on op="grant" — a container id (§4A) resolves, and a locked session
    // resolves nothing but its own container.
    (0, knowledge_js_1.registerKnowledgeTools)(registerTool, client, caller, directory); // dopl_kb — the user's bases
    (0, skills_js_1.registerSkillTools)(registerTool, client, caller); // dopl_skill
    (0, chats_js_1.registerChatTools)(registerTool, client); // dopl_chats — the archive
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
    // 🔒 `directory` resolves `to` on op="grant", the same way it does for
    // `dopl_kb(op="grant")` above.
    (0, agent_js_1.registerAgentTools)(registerTool, client, caller, directory); // dopl_agent — persistent agent identities
    return server;
}
