"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_INSTRUCTIONS = void 0;
exports.createServer = createServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const knowledge_js_1 = require("./tools/knowledge.js");
const skills_js_1 = require("./tools/skills.js");
const cluster_js_1 = require("./tools/cluster.js");
const workflow_js_1 = require("./tools/workflow.js");
const canvas_js_1 = require("./tools/canvas.js");
const chats_js_1 = require("./tools/chats.js");
const members_js_1 = require("./tools/members.js");
const packs_js_1 = require("./tools/packs.js");
const map_js_1 = require("./tools/map.js");
const search_js_1 = require("./tools/search.js");
const ontology_js_1 = require("./tools/ontology.js");
const respond_js_1 = require("./tools/respond.js");
const skill_authoring_guide_js_1 = require("./prompts/skill-authoring-guide.js");
const version_js_1 = require("./version.js");
exports.SERVER_INSTRUCTIONS = `You are connected to **Dopl** — the user's workspace of knowledge bases, skills, and clusters for AI/automation work.

## How to use this

Use the Dopl tools to read and organize the user's workspace: their knowledge bases (notes/docs), skills (procedural prompt templates), and workflows (agent-followable node graphs, grouped into clusters). Ground your answers in the user's real workspace state, not in stale local files.

## Session start — preload the user's workspace

At the very start of every new session, before your first substantive reply, call dopl_map (one cheap call: every knowledge base, skill, workflow, and ontology cluster with one-liners). For "my/me" requests also call dopl_ontology(op='anchor') to learn who the caller is in the workspace graph. Ground answers in that real state, not stale local files.

You do NOT need to re-run these on every turn. Once per session is enough, except:

- User asks about their workspace ("what's on my canvas?", "which clusters do I have?") -> re-query first; they may have changed things via the web UI.
- After your own write ops (dopl_cluster create/update, dopl_kb / dopl_skill writes) -> trust the tool response; it already reflects the new state.

Workspace beats local files as source of truth. If a user's CLAUDE.md or a skills file implies a different set of clusters than dopl_cluster(op='list') returns, trust the MCP result and flag the drift.

## Workspaces — targeting a specific workspace

This MCP server can target any workspace the authenticated user is a member of. The active (default) workspace appears in the _dopl_status footer of every response. Controls:

1. list_workspaces — see every workspace the user is in, with role. Cached ~60s.
2. workspace=<slug_or_id> arg on any tool — target that workspace for that ONE call. This connection is stateless (each call is independent), so this per-call arg is the reliable way to act in a non-default workspace.
3. set_workspace(workspace=<slug_or_id>) — validates a workspace ref but does NOT persist across calls on this connection. Prefer the per-call workspace= arg; don't rely on set_workspace to change which workspace later calls hit.

## Decision tree — which tool

- See what workflows exist -> dopl_workflow(op='list'); inspect one (ordered steps + node ids + the knowledge bases / skills it references) -> dopl_workflow(op='get'). A workflow is a header + its connected node graph — the agent-followable unit.
- AUTHOR a workflow end-to-end over MCP (appears live on an open canvas): dopl_workflow(op='create') then op='set_graph' (declarative: send the whole {nodes, edges} and it's made to match) — or build incrementally with op='add_node'/'connect'/'update_node'/'remove_node'/'disconnect'. Node reads/actions reference dopl_kb / dopl_skill ids and auto-attach. Finish with op='get' to verify.
- Rename / describe a workflow -> dopl_workflow(op='update'); delete one -> dopl_workflow_admin(op='delete_workflow').
- Clusters are non-spatial CONTAINERS that group workflows. See what clusters exist -> dopl_cluster(op='list'); inspect one (its workflows) -> dopl_cluster(op='get').
- Read a knowledge-base entry -> dopl_kb(op='read_file'); read a skill's full body -> dopl_skill(op='get'). A workflow's attached KBs/skills are listed by dopl_workflow(op='get').
- Create / rename a cluster -> dopl_cluster(op='create' | 'update'); delete one -> dopl_cluster_admin(op='delete_cluster').
- Browse / read / write the user's knowledge bases -> dopl_kb (+ dopl_kb_admin for destructive ops).
- List / read / author the user's skills -> dopl_skill (+ dopl_skill_admin).
- See what's on the canvas -> dopl_canvas(op='list').
- Who's in the workspace / who's on which team / who can access what / what can I touch -> dopl_members(op='whoami' | 'list' | 'get' | 'teams' | 'get_team' | 'access_matrix' | 'my_access'). READ-ONLY — role, team, and access changes happen in the web UI.
- Archive this conversation for future sessions -> dopl_chats(op='export'); recall a past session -> dopl_chats(op='list' | 'get'). Read dopl_chats(op='guide') before your first export — summaries per message, verbatim only on request.

## Workspace skills

Skills are single-file procedural prompts the user authored — each is one tight SKILL.md doing one thing. Call dopl_skill(op='list') at task boundaries to see if any apply (they're grouped by folder), then dopl_skill(op='get') to load and follow the SKILL.md. Skill bodies reference KBs via [label](dopl://kb/<slug>) markdown links — load referenced KB content with dopl_kb(op='read_file') when you need it. Authoring: call dopl_skill(op='authoring_guide') first, then dopl_skill(op='create') + dopl_skill(op='write'). Prefer many small skills over monoliths; reference material belongs in KBs, not the skill. Destructive ops live on dopl_skill_admin.

## Knowledge Packs — specialist verticals

Dopl ships knowledge packs: curated, version-pinned reference docs for specialist domains (e.g. Rokid AR glasses, Unity VR), backed by public GitHub repos synced on every push. Use them when the user is doing real implementation work in a domain that has a pack — your training data may be stale; the pack is canonical.

- dopl_packs(op='list') — discover what packs exist.
- dopl_packs(op='list_files', pack, category?) — browse a pack's file tree (metadata only).
- dopl_packs(op='get_file', pack, path) — fetch one file's full markdown.

Cite the file path (e.g. docs/sdk/camera.md) in code comments. For domains with no installed pack, say so plainly — don't fabricate.

---

${skill_authoring_guide_js_1.SKILL_AUTHORING_GUIDE}`;
/**
 * Append an active-workspace status footer to a tool response. Fires on
 * every tool response so the agent always sees its current workspace
 * context (M-4).
 *
 * Skips the footer when:
 *   - the handler returned isError: true (don't muddy error messages)
 *   - there's no active workspace (rare, only on a misconfigured session)
 */
async function appendDoplStatus(response, client, getActiveWorkspace) {
    if (response.isError)
        return response;
    const active = getActiveWorkspace();
    if (!active)
        return response;
    const lines = ["", "", "---", "_dopl_status:"];
    lines.push(`  active_workspace: "${active.name}" (slug=${active.slug}, role=${active.role})`);
    const footer = lines.join("\n");
    // Append to the final text block so the agent sees the footer at the
    // end of a rendered response. If the response has no text content
    // (rare — tools always return text), add a new block.
    const content = [...response.content];
    const lastIdx = content.length - 1;
    if (lastIdx >= 0 && content[lastIdx]?.type === "text") {
        content[lastIdx] = {
            type: "text",
            text: `${content[lastIdx].text}${footer}`,
        };
    }
    else {
        content.push({ type: "text", text: footer.trimStart() });
    }
    return { ...response, content };
}
/**
 * Run a tool handler, converting an over-free-cap entitlement denial
 * (a 403 thrown by any write op through @dopl/client) into a friendly
 * tool error instead of an opaque framework throw. Every other error
 * rethrows unchanged, preserving existing behavior.
 */
async function runWithEntitlementGuard(run) {
    try {
        return await run();
    }
    catch (e) {
        const denied = (0, respond_js_1.entitlementDenied)(e);
        if (denied)
            return denied;
        throw e;
    }
}
/**
 * Wrap a tool handler so every successful response ends with the
 * `_dopl_status` footer. Handlers stay unaware of the mechanism.
 */
function withDoplStatus(handler, client, getActiveWorkspace) {
    return async (args) => {
        const result = await handler(args);
        return appendDoplStatus(result, client, getActiveWorkspace);
    };
}
/**
 * Optional per-call `workspace` argument injected into every tool
 * schema by `registerTool`. Either a workspace slug or UUID. When set,
 * the tool call routes to that workspace via the transport's
 * AsyncLocalStorage override; the session default is unchanged.
 *
 * Defined as a const so its description renders verbatim in every
 * tool's MCP introspection — keeps the prompt advice consistent.
 */
const WORKSPACE_ARG_SHAPE = {
    workspace: zod_1.z
        .string()
        .optional()
        .describe("Optional workspace slug or UUID to target for this single call. Defaults to the session's active workspace (see `current_workspace`). Use this when the user mentions a workspace by name; for sticky switching across multiple calls, use `set_workspace` instead."),
};
function createServer(client, options = {}) {
    // OAuth scope gating. Fail CLOSED: a session gets write/admin capability
    // ONLY if it presents a scope set that explicitly includes `dopl.write`.
    // Absent/empty scopes no longer grant write — the OAuth transport (the only
    // caller) always forwards the token's scopes, so this is a no-op for real
    // sessions, but it closes the prior fail-open default where a scope-less
    // code path would have silently exposed every write/destructive tool.
    const canWrite = Array.isArray(options.scopes) && options.scopes.includes("dopl.write");
    // Purely destructive tools aren't even registered for a read-only session.
    const READ_ONLY_BLOCKED_TOOLS = new Set([
        "dopl_chats_admin",
        "dopl_cluster_admin",
        "dopl_kb_admin",
        "dopl_skill_admin",
        "dopl_workflow_admin",
        "dopl_ontology_admin",
    ]);
    // Per-op write gating for the MIXED read+write tools (these stay registered
    // for read-only sessions so reads still work, but their write ops are
    // refused). Closes the gap where a `dopl.read`-only token could still write
    // via a non-admin tool. Inert while every active token carries `dopl.write`
    // — defense-in-depth for when read-only tokens are issued. Keep each set in
    // sync with the tool's `op` enum; a new write op must be added here.
    const WRITE_OPS = {
        dopl_cluster: new Set(["create", "update"]),
        dopl_ontology: new Set([
            "create_cluster",
            "update_cluster",
            "create_column",
            "create_object",
            "update_object",
            "set_template_field",
            "remove_template_field",
            "set_attribute",
            "remove_attribute",
            "set_relationship",
            "remove_relationship",
            "set_action",
            "remove_action",
            "claim_anchor",
        ]),
        dopl_kb: new Set([
            "create_base",
            "update_base",
            "restore_base",
            "create_folder",
            "move_folder",
            "write_file",
            "move_file",
            "restore_file",
            "restore_folder",
            "set_visibility",
        ]),
        dopl_skill: new Set([
            "create",
            "update",
            "write",
            "set_visibility",
        ]),
        dopl_workflow: new Set([
            "create",
            "update",
            "set_graph",
            "add_node",
            "update_node",
            "remove_node",
            "connect",
            "disconnect",
            "set_cluster",
        ]),
        dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder"]),
    };
    // Active workspace for this MCP session — seeded from the startup
    // handshake (index.ts) and mutated by `set_workspace` mid-session.
    // The slug threads into skill-writer calls so on-disk SKILL.md paths
    // get scoped per workspace. Default slug preserves the legacy
    // single-workspace paths so existing users don't see every skill
    // rename on first upgrade.
    const canvasContext = { slug: options.workspace?.slug ?? "default" };
    let activeWorkspace = options.workspace
        ? {
            id: options.workspace.id,
            slug: options.workspace.slug,
            name: options.workspace.name,
            role: options.role ?? "viewer",
        }
        : null;
    /**
     * Cache of the user's workspace memberships for slug→id resolution.
     * Refreshed on demand and after a brief TTL. `set_workspace` does
     * not invalidate it (memberships don't change just because the user
     * switched the active default).
     */
    const WORKSPACE_CACHE_TTL_MS = 60_000;
    let workspaceListCache = null;
    async function getWorkspaceList() {
        if (workspaceListCache &&
            Date.now() - workspaceListCache.loadedAt < WORKSPACE_CACHE_TTL_MS) {
            return workspaceListCache.workspaces;
        }
        const result = await client.listWorkspaces();
        workspaceListCache = {
            workspaces: result.workspaces,
            loadedAt: Date.now(),
        };
        return result.workspaces;
    }
    async function resolveWorkspaceRef(ref) {
        // Audit B11: a workspace slug shaped like a UUID (lowercase hex
        // with hyphens) is theoretically possible. Matching on id alone
        // would miss the slug, forcing a wasteful refresh on the second
        // pass. Cheap to try both id and slug on the first pass.
        let list = await getWorkspaceList();
        let match = list.find((w) => w.id === ref || w.slug === ref);
        if (match)
            return match;
        // Force-refresh once — covers the case where the user was added to
        // a new workspace mid-session and the cache hasn't ticked over.
        workspaceListCache = null;
        list = await getWorkspaceList();
        match = list.find((w) => w.id === ref || w.slug === ref);
        return match ?? null;
    }
    const server = new mcp_js_1.McpServer({
        name: "dopl",
        // Source of truth is package.json — read via version.ts so the
        // MCP handshake and any analytics that key on server version stay
        // accurate across publishes (audit fix #24).
        version: version_js_1.packageVersion,
    }, {
        instructions: exports.SERVER_INSTRUCTIONS,
    });
    // ── Tool registration helper ─────────────────────────────────────
    // Every call funnels through here so:
    //   1. An optional `workspace` arg is auto-injected on every tool
    //      (M-1). When provided, the call runs inside a transport-level
    //      AsyncLocalStorage override so client.* requests carry the
    //      right `X-Workspace-Id` header — without changing the session
    //      default.
    //   2. The response gets the `_dopl_status` footer (active workspace
    //      + pending ingestions, M-4) uniformly.
    // Matches the MCP SDK's own zod-inference signature so handler arg
    // types come through correctly.
    function registerTool(name, description, schema, handler) {
        // Read-only OAuth sessions skip write/destructive tools entirely.
        if (!canWrite && READ_ONLY_BLOCKED_TOOLS.has(name))
            return;
        // Spread the workspace arg into the published schema so the agent
        // sees it on every tool's introspection without having to author
        // it per-tool. Strip it out before calling the original handler so
        // existing handler signatures keep working.
        const enhancedSchema = { ...schema, ...WORKSPACE_ARG_SHAPE };
        const wrapped = async (args) => {
            const { workspace: workspaceRef, ...rest } = args;
            const innerArgs = rest;
            // Refuse write ops on a read-only session before doing any work.
            if (!canWrite) {
                const op = innerArgs.op;
                if (op && WRITE_OPS[name]?.has(op)) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `This session is read-only — its token lacks the \`dopl.write\` scope. \`${name}\` op="${op}" is a write operation. Reconnect with write access to perform it.`,
                            },
                        ],
                    };
                }
            }
            if (workspaceRef) {
                // Audit B8: resolveWorkspaceRef calls listWorkspaces, which
                // can throw on network / auth failures. Catch and surface a
                // friendly isError instead of letting the throw propagate
                // (which the MCP framework would expose as an opaque error).
                let resolved;
                try {
                    resolved = await resolveWorkspaceRef(workspaceRef);
                }
                catch (err) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Couldn't validate the \`workspace\` argument (${err instanceof Error ? err.message : String(err)}). Try again, or call without \`workspace=\` to use the session's active workspace.`,
                            },
                        ],
                    };
                }
                if (!resolved) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Workspace not found: \`${workspaceRef}\`. Call \`list_workspaces\` to see workspaces you have access to, or pass a slug or UUID from there.`,
                            },
                        ],
                    };
                }
                // Run the handler inside the AsyncLocalStorage scope so any
                // client.* call inside it transparently picks up the override
                // workspace id in its X-Workspace-Id header. Returns to the
                // session default (or no override) the moment this scope exits.
                const workspaceId = resolved.id;
                return runWithEntitlementGuard(() => client_1.workspaceContext.run(workspaceId, () => handler(innerArgs)));
            }
            return runWithEntitlementGuard(() => handler(innerArgs));
        };
        server.tool(name, description, enhancedSchema, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        withDoplStatus(wrapped, client, () => activeWorkspace));
    }
    // Meta-tools (workspace switcher) skip the auto-injected `workspace`
    // arg — passing a workspace into "set my workspace" doesn't make
    // sense, and routing list_workspaces / current_workspace through
    // ALS adds noise to the description without changing behavior
    // (membership lookup is user-scoped, not workspace-scoped).
    function registerMetaTool(name, description, schema, handler) {
        server.tool(name, description, schema, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        withDoplStatus(handler, client, () => activeWorkspace));
    }
    // ── Workspace switcher tools (M-2) ────────────────────────────────
    // Three small tools that let the agent discover and switch
    // workspaces at runtime, eliminating the old "one MCP process per
    // workspace" workaround. Combined with the per-call `workspace` arg
    // injected by `registerTool` (M-1), the agent has both a sticky
    // switch (`set_workspace`) and a single-call override (`workspace=...`).
    registerMetaTool("list_workspaces", "List every workspace the authenticated user is an active member of, with the user's role on each (owner/admin/member/viewer). Use before `set_workspace` when the user mentions a workspace by name and you don't know its slug, or when reporting available workspaces. Result is cached per-session for ~60s.", {}, async () => {
        const list = await getWorkspaceList();
        if (list.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "You're not an active member of any workspaces yet.",
                    },
                ],
            };
        }
        const lines = ["Workspaces you have access to:", ""];
        for (const w of list) {
            const star = w.id === activeWorkspace?.id ? " ★" : "";
            lines.push(`- **${w.name}** (slug: \`${w.slug}\`, role: ${w.role})${star}`);
        }
        lines.push("");
        if (activeWorkspace)
            lines.push("★ = currently active");
        lines.push("Use `set_workspace(workspace=<slug_or_id>)` to switch the session default, or pass `workspace=<slug>` on a single tool call.");
        return {
            content: [{ type: "text", text: lines.join("\n") }],
        };
    });
    registerMetaTool("set_workspace", "Resolve/validate a workspace by slug or UUID (from `list_workspaces`). IMPORTANT: this connection is STATELESS — the switch does NOT persist to your next call, so it does not change which workspace later tool calls target. To act in another workspace, pass `workspace=<slug_or_id>` on each tool call (the reliable mechanism). This op just confirms the ref is valid and echoes the resolved workspace.", {
        workspace: zod_1.z
            .string()
            .min(1)
            .describe("Workspace slug or UUID, from `list_workspaces`. The currently-active workspace's slug is shown in the `_dopl_status` footer."),
    }, async ({ workspace: ref }) => {
        const resolved = await resolveWorkspaceRef(ref);
        if (!resolved) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: `Workspace not found: \`${ref}\`. Call \`list_workspaces\` to see what's available.`,
                    },
                ],
            };
        }
        // Two writes: the transport stores the workspace id (so every
        // future client.* call carries it as the session default), and
        // the local activeWorkspace state powers the status footer.
        // canvasContext.slug also follows along for any skill-writer
        // path scoping that reads it later.
        client.setWorkspaceId(resolved.id);
        activeWorkspace = {
            id: resolved.id,
            slug: resolved.slug,
            name: resolved.name,
            role: resolved.role,
        };
        canvasContext.slug = resolved.slug;
        return {
            content: [
                {
                    type: "text",
                    text: `Resolved workspace **${resolved.name}** (slug: \`${resolved.slug}\`, role: ${resolved.role}). ⚠️ This connection is stateless, so this does NOT persist to your next call — pass \`workspace="${resolved.slug}"\` on each tool call to act there. (Applied to the current request only.)`,
                },
            ],
        };
    });
    registerMetaTool("current_workspace", "Return the session's default workspace (id, slug, name, role) — the one tool calls hit when no `workspace=` arg is passed. Use when the user asks 'which workspace am I in?'. Note: a per-call `workspace=` override is NOT reflected here, and `set_workspace` does not change this on a stateless connection. Cheap — no DB hit if the session already knows.", {}, async () => {
        if (!activeWorkspace) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No active workspace yet. Call `list_workspaces` to see what's available, then `set_workspace(workspace=<slug_or_id>)`.",
                    },
                ],
            };
        }
        const lines = [
            `**${activeWorkspace.name}**`,
            `- slug: \`${activeWorkspace.slug}\``,
            `- id: \`${activeWorkspace.id}\``,
            `- your role: ${activeWorkspace.role}`,
        ];
        return {
            content: [{ type: "text", text: lines.join("\n") }],
        };
    });
    // ── Consolidated domain tools ──────────────────────────────────────
    // Each registrar exposes a single `dopl_<domain>` action-tool (plus a
    // `dopl_<domain>_admin` companion where the domain has destructive ops)
    // that dispatches on an `op` arg.
    (0, cluster_js_1.registerClusterTools)(registerTool, client); // dopl_cluster + dopl_cluster_admin
    (0, workflow_js_1.registerWorkflowTools)(registerTool, client); // dopl_workflow + dopl_workflow_admin
    (0, canvas_js_1.registerCanvasTools)(registerTool, client);
    (0, packs_js_1.registerPacksTools)(registerTool, client); // curated read-only knowledge packs
    (0, knowledge_js_1.registerKnowledgeTools)(registerTool, client); // dopl_kb + dopl_kb_admin (user bases)
    (0, skills_js_1.registerSkillTools)(registerTool, client); // dopl_skill + dopl_skill_admin
    (0, chats_js_1.registerChatTools)(registerTool, client); // dopl_chats + dopl_chats_admin (archive)
    (0, members_js_1.registerMembersTool)(registerTool, client); // dopl_members — membership/teams/access (read-only)
    (0, map_js_1.registerMapTool)(registerTool, client); // dopl_map — compact workspace manifest
    (0, search_js_1.registerSearchTool)(registerTool, client); // dopl_search — cross-domain search
    (0, ontology_js_1.registerOntologyTool)(registerTool, client); // dopl_ontology — routing graph (read-only)
    return server;
}
