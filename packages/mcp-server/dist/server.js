"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildInstructions = buildInstructions;
exports.createServer = createServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const knowledge_js_1 = require("./tools/knowledge.js");
const skills_js_1 = require("./tools/skills.js");
const cluster_js_1 = require("./tools/cluster.js");
const workflow_js_1 = require("./tools/workflow.js");
const chats_js_1 = require("./tools/chats.js");
const members_js_1 = require("./tools/members.js");
const map_js_1 = require("./tools/map.js");
const search_js_1 = require("./tools/search.js");
const ontology_js_1 = require("./tools/ontology.js");
const channel_js_1 = require("./tools/channel.js");
const respond_js_1 = require("./tools/respond.js");
const skill_authoring_guide_js_1 = require("./prompts/skill-authoring-guide.js");
const version_js_1 = require("./version.js");
/**
 * Bake the caller's workspace directory into the "targeting" section of the
 * instructions (M-2), so the agent knows — before its first tool call —
 * whether it must pass `workspace=` and which workspaces exist. The table
 * carries name/slug/role/description; the rule flips on membership count.
 *
 * `pin` is the boot-resolved header pin (only meaningful for 2+ memberships —
 * a sole membership is already covered by the length===1 branch). When present
 * the connection HAS a default, so the copy says so rather than demanding
 * `workspace=` on every call. `directoryLoadFailed` distinguishes a transient
 * directory-load failure from a genuine 0-membership caller.
 */
function renderWorkspaceGuidance(directory, pin, directoryLoadFailed) {
    if (directory.length === 0) {
        if (directoryLoadFailed) {
            return `We couldn't load your workspace memberships just now — this is usually a transient backend issue, not a sign you have none. Retry in a moment, and reconnect if it persists. Tool calls that need a workspace will fail until the directory loads.`;
        }
        return `You are not an active member of any workspace yet. Create one in the Dopl web app, then reconnect — tool calls fail until you belong to a workspace.`;
    }
    const table = directory
        .map((w) => {
        const desc = w.description ? ` — ${w.description}` : "";
        return `- **${w.name}** (slug: \`${w.slug}\`, role: ${w.role})${desc}`;
    })
        .join("\n");
    if (directory.length === 1) {
        return `You have exactly one workspace, so every tool call targets it automatically — you may omit \`workspace=\`. The \`_dopl_status\` footer on each response confirms which workspace was hit.

${table}`;
    }
    if (pin) {
        return `You are a member of ${directory.length} workspaces, and this connection is pinned to **${pin.name}** (slug: \`${pin.slug}\`) by default — a no-arg tool call targets it. Pass \`workspace=<slug_or_id>\` to target a DIFFERENT workspace for that one call. The \`_dopl_status\` footer names the workspace each response actually hit.

${table}

Controls:
- \`list_workspaces\` — re-list these with role (cached ~60s).
- \`current_workspace\` — shows which workspace a no-arg call resolves to (here: **${pin.name}**).
- \`workspace=<slug_or_id>\` on any tool — target that workspace for that ONE call, overriding the pin. Each call is independent (stateless connection).`;
    }
    return `You are a member of ${directory.length} workspaces and this connection has NO default: you MUST pass \`workspace=<slug_or_id>\` on EVERY tool call, or the call fails asking which workspace to use. The \`_dopl_status\` footer names the workspace each response actually hit.

${table}

Controls:
- \`list_workspaces\` — re-list these with role (cached ~60s).
- \`current_workspace\` — shows which workspace a no-arg call resolves to (here: none — you must pass \`workspace=\`).
- \`workspace=<slug_or_id>\` on any tool — target that workspace for that ONE call. Each call is independent (stateless connection), so this per-call arg is the only way to choose a workspace.`;
}
function buildInstructions(directory, guidance = {}) {
    return `You are connected to **Dopl** — the user's workspace of knowledge bases, skills, and clusters for AI/automation work.

## How to use this

Use the Dopl tools to read and organize the user's workspace: their knowledge bases (notes/docs), skills (procedural prompt templates), and workflows (agent-followable step graphs, grouped into clusters). Ground your answers in the user's real workspace state, not in stale local files.

## Session start — preload the user's workspace

At the very start of every new session, before your first substantive reply, call dopl_map (one cheap call: every knowledge base, skill, workflow, and ontology cluster with one-liners). For "my/me" requests also call dopl_ontology(op='anchor') to learn who the caller is in the workspace graph. Ground answers in that real state, not stale local files.

You do NOT need to re-run these on every turn. Once per session is enough, except:

- User asks about their workspace ("what's on my canvas?", "which clusters do I have?") -> re-query first; they may have changed things via the web UI.
- After your own write ops (dopl_cluster create/update, dopl_kb / dopl_skill writes) -> trust the tool response; it already reflects the new state.

Workspace beats local files as source of truth. If a user's CLAUDE.md or a skills file implies a different set of clusters than dopl_cluster(op='list') returns, trust the MCP result and flag the drift.

## Workspaces — targeting a specific workspace

${renderWorkspaceGuidance(directory, guidance.pin ?? null, guidance.directoryLoadFailed ?? false)}

## Decision tree — which tool

- See what workflows exist -> dopl_workflow(op='list'); inspect one (topologically-ordered steps + step ids + the knowledge bases / skills it references) -> dopl_workflow(op='get'); read ONE step's full detail as you walk -> dopl_workflow(op='step'). A workflow is a graph of steps connected by branch-conditioned edges — the agent-followable unit. Entry steps are those with no incoming edge.
- AUTHOR a workflow end-to-end over MCP: dopl_workflow(op='create') then op='set_graph' (declarative: send the whole {nodes, edges} and it's made to match) — or build incrementally with op='add_node'/'connect'/'update_node'/'remove_node'/'disconnect'. Step reads/actions reference dopl_kb / dopl_skill ids and auto-attach; edges can carry a branch condition. Finish with op='get' to verify.
- Rename / describe a workflow -> dopl_workflow(op='update'); delete one -> dopl_workflow_admin(op='delete_workflow').
- Clusters are non-spatial CONTAINERS that group workflows. See what clusters exist -> dopl_cluster(op='list'); inspect one (its workflows) -> dopl_cluster(op='get').
- Read a knowledge-base entry -> dopl_kb(op='read_file'); read a skill's full body -> dopl_skill(op='get'). A workflow's attached KBs/skills are listed by dopl_workflow(op='get').
- Create / rename a cluster -> dopl_cluster(op='create' | 'update'); delete one -> dopl_cluster_admin(op='delete_cluster').
- Browse / read / write the user's knowledge bases -> dopl_kb (+ dopl_kb_admin for destructive ops).
- List / read / author the user's skills -> dopl_skill (+ dopl_skill_admin).
- Who's in the workspace / who's on which team / who can access what / what can I touch -> dopl_members(op='whoami' | 'list' | 'get' | 'teams' | 'get_team' | 'access_matrix' | 'my_access'). READ-ONLY — role, team, and access changes happen in the web UI.
- Archive this conversation for future sessions -> dopl_chats(op='export'); recall a past session -> dopl_chats(op='list' | 'get'). Read dopl_chats(op='guide') before your first export — summaries per message, verbatim only on request.

## Workspace skills

Skills are single-file procedural prompts the user authored — each is one tight SKILL.md doing one thing. Call dopl_skill(op='list') at task boundaries to see if any apply (they're grouped by folder), then dopl_skill(op='get') to load and follow the SKILL.md. Skill bodies reference KBs via [label](dopl://kb/<slug>) markdown links — load referenced KB content with dopl_kb(op='read_file') when you need it. Authoring: call dopl_skill(op='authoring_guide') first, then dopl_skill(op='create') + dopl_skill(op='write'). Prefer many small skills over monoliths; reference material belongs in KBs, not the skill. Destructive ops live on dopl_skill_admin.

---

${skill_authoring_guide_js_1.SKILL_AUTHORING_GUIDE}`;
}
/**
 * Append the mandatory `_dopl_status` footer to a tool response (M-4). It
 * always reports the EFFECTIVE workspace this call actually hit plus a
 * source label — `per-call arg` (a `workspace=` override), `sole membership`
 * (auto-targeted single workspace), or `header pin` (a request-level
 * X-Workspace-Id). There is no session-default duality: the footer names
 * exactly where the response came from.
 *
 * Skips the footer when:
 *   - the handler returned isError: true (don't muddy error messages), or
 *   - there is no effective workspace to report (only reachable via the
 *     meta-tools when the caller has no session default).
 */
async function appendDoplStatus(response, effective) {
    if (response.isError)
        return response;
    if (!effective)
        return response;
    const footer = [
        "",
        "",
        "---",
        "_dopl_status:",
        `  active_workspace: "${effective.name}" (slug=${effective.slug}, role=${effective.role})`,
        `  workspace_source: ${effective.source}`,
    ].join("\n");
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
 * Wrap a meta-tool handler so every successful response ends with the
 * `_dopl_status` footer reporting the session default (if any). Handlers
 * stay unaware of the mechanism.
 */
function withDoplStatus(handler, getEffective) {
    return async (args) => {
        const result = await handler(args);
        return appendDoplStatus(result, getEffective());
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
        .describe("Workspace slug or UUID to target for this single call. Omit to use the session's workspace (see `current_workspace`). REQUIRED on every call when the user belongs to 2+ workspaces — there is no default then, so a no-arg call is refused with the list of choices. Use `list_workspaces` to discover slugs."),
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
            "restore_cluster",
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
            "restore_workflow",
        ]),
        dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder", "restore"]),
        dopl_channel: new Set(["open", "invite", "post"]),
    };
    // Session default workspace — resolved once at boot (factory.ts), never
    // mutated (there is no `set_workspace`; per-call `workspace=` scopes a
    // single call via AsyncLocalStorage without touching this). Null when the
    // caller has 0 or 2+ memberships and sent no pin.
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
    /**
     * Cache of the user's workspace memberships for slug→id resolution.
     * Seeded from the boot `listWorkspaces()` call (options.directory) so the
     * first per-call `workspace=` needs no extra loopback; refreshed on demand
     * after a brief TTL.
     */
    const WORKSPACE_CACHE_TTL_MS = 60_000;
    // Seed from the boot directory — but NOT when the boot load failed, or we'd
    // cache a bogus empty list for the full TTL and mask the failure. Leaving it
    // null lets the first `workspace=` / no-default path retry the load.
    let workspaceListCache = options.directory && !options.directoryLoadFailed
        ? { workspaces: options.directory, loadedAt: Date.now() }
        : null;
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
    /**
     * The isError response for a no-`workspace=` call that has no session
     * default (M-3). Lists the caller's workspaces so the agent can retry
     * with an explicit `workspace=`; mirrors the backend WORKSPACE_REQUIRED
     * envelope in intent. Reads the boot-seeded directory (cached — no extra
     * loopback on the happy path).
     */
    async function noWorkspaceError() {
        let list;
        // Start from the boot-time load state; a fresh successful load below
        // supersedes it (the cache is left unseeded when boot failed, so this
        // actually retries rather than returning a stale empty list).
        let loadFailed = options.directoryLoadFailed ?? false;
        try {
            list = await getWorkspaceList();
            loadFailed = false;
        }
        catch {
            list = options.directory ?? [];
        }
        if (list.length === 0) {
            return {
                isError: true,
                content: [
                    {
                        type: "text",
                        text: loadFailed
                            ? "We couldn't load your workspace memberships just now — this looks like a transient backend issue, not that you have none. Retry in a moment, and reconnect if it persists."
                            : "You're not an active member of any workspace, so there's nothing to act on. Create one in the Dopl web app, then reconnect.",
                    },
                ],
            };
        }
        const lines = [
            `This connection has no default workspace because you belong to ${list.length} workspaces. Pass \`workspace=<slug_or_id>\` on this call — pick one:`,
            "",
        ];
        for (const w of list) {
            lines.push(`- **${w.name}** (slug: \`${w.slug}\`, role: ${w.role})`);
        }
        return {
            isError: true,
            content: [{ type: "text", text: lines.join("\n") }],
        };
    }
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
        instructions: buildInstructions(options.directory ?? [], {
            pin: options.workspaceSource === "header pin" && options.workspace
                ? { name: options.workspace.name, slug: options.workspace.slug }
                : null,
            directoryLoadFailed: options.directoryLoadFailed ?? false,
        }),
    });
    // ── Tool registration helper ─────────────────────────────────────
    // Every call funnels through here so:
    //   1. An optional `workspace` arg is auto-injected on every tool
    //      (M-1). When provided, the call runs inside a transport-level
    //      AsyncLocalStorage override so client.* requests carry the
    //      right `X-Workspace-Id` header. When omitted AND the session has
    //      no default (0/2+ memberships, no pin) the call is refused (M-3)
    //      rather than guessing a workspace.
    //   2. The response gets the mandatory `_dopl_status` footer naming the
    //      effective workspace + how it was chosen (M-4) uniformly.
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
            // A `workspace` arg was passed on the call. Distinguish "provided
            // but blank" (fail closed) from "not provided" (use session
            // default). Audit fix F-2: an empty/whitespace string used to be
            // falsy and silently fell through to the session default — the
            // user's REAL workspace — so a computed-but-empty ref could route
            // a write to the wrong workspace with no error. Reject it.
            if (workspaceRef !== undefined) {
                const ref = typeof workspaceRef === "string" ? workspaceRef.trim() : "";
                if (!ref) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `The \`workspace\` argument was blank. Pass a slug or UUID from \`list_workspaces\`, or omit \`workspace=\` entirely to use the session's active workspace.`,
                            },
                        ],
                    };
                }
                // Audit B8: resolveWorkspaceRef calls listWorkspaces, which
                // can throw on network / auth failures. Catch and surface a
                // friendly isError instead of letting the throw propagate
                // (which the MCP framework would expose as an opaque error).
                let resolved;
                try {
                    resolved = await resolveWorkspaceRef(ref);
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
                                text: `Workspace not found: \`${ref}\`. Call \`list_workspaces\` to see workspaces you have access to, or pass a slug or UUID from there.`,
                            },
                        ],
                    };
                }
                // Run the handler inside the AsyncLocalStorage scope so any
                // client.* call inside it transparently picks up the override
                // workspace id in its X-Workspace-Id header. Returns to the
                // session default (or no override) the moment this scope exits.
                // The footer reports the EFFECTIVE (resolved) workspace with a
                // `per-call arg` source so the agent can confirm where it landed.
                const effective = {
                    id: resolved.id,
                    slug: resolved.slug,
                    name: resolved.name,
                    role: resolved.role,
                    source: "per-call arg",
                };
                const result = await runWithEntitlementGuard(() => client_1.workspaceContext.run(resolved.id, () => handler(innerArgs)));
                return appendDoplStatus(result, effective);
            }
            // No `workspace=` arg. Auto-target the session default when there is
            // one (single membership or a header pin); otherwise refuse (M-3) —
            // a 0/2+-membership caller must pass `workspace=` rather than have a
            // workspace guessed for them.
            if (!activeWorkspace) {
                return noWorkspaceError();
            }
            const result = await runWithEntitlementGuard(() => handler(innerArgs));
            return appendDoplStatus(result, sessionEffective());
        };
        server.tool(name, description, enhancedSchema, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wrapped);
    }
    // Meta-tools skip the auto-injected `workspace` arg — a membership
    // lookup is user-scoped, not workspace-scoped, so routing it through
    // ALS adds noise without changing behavior. Their footer reports the
    // session default (if any).
    function registerMetaTool(name, description, schema, handler) {
        server.tool(name, description, schema, 
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        withDoplStatus(handler, sessionEffective));
    }
    // ── Workspace directory tools (M-2) ───────────────────────────────
    // Two read-only tools that let the agent discover its workspaces and
    // see what a no-arg call resolves to. Targeting is per-call only: pass
    // the `workspace=` arg injected by `registerTool` (M-1). There is no
    // sticky `set_workspace` — the connection is stateless, so a "switch"
    // couldn't persist anyway.
    registerMetaTool("list_workspaces", "List every workspace the authenticated user is an active member of, with the user's role on each (owner/admin/member/viewer). Use when the user mentions a workspace by name and you don't know its slug, or when reporting available workspaces. Pass a chosen workspace as the `workspace=` arg on subsequent tool calls. Result is cached per-session for ~60s.", {}, async () => {
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
        if (activeWorkspace) {
            lines.push("★ = the workspace a no-arg call auto-targets.");
        }
        else {
            lines.push("You belong to 2+ workspaces, so there is no auto-target — pass `workspace=<slug_or_id>` on every tool call.");
        }
        return {
            content: [{ type: "text", text: lines.join("\n") }],
        };
    });
    registerMetaTool("current_workspace", "Report which workspace a no-`workspace=` tool call resolves to on this connection. Returns that workspace (id, slug, name, role) when the caller has exactly one membership (or a request pin); when the caller belongs to 2+ workspaces there is NO auto-target, and this lists them so you can pick one to pass as `workspace=`. Use when the user asks 'which workspace am I in?'.", {}, async () => {
        if (activeWorkspace) {
            const lines = [
                `A no-\`workspace=\` call targets **${activeWorkspace.name}**:`,
                `- slug: \`${activeWorkspace.slug}\``,
                `- id: \`${activeWorkspace.id}\``,
                `- your role: ${activeWorkspace.role}`,
            ];
            return {
                content: [{ type: "text", text: lines.join("\n") }],
            };
        }
        // No session default → surface the directory so the agent can pick.
        const list = await getWorkspaceList();
        if (list.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "You're not an active member of any workspace yet, so no tool call can resolve a target.",
                    },
                ],
            };
        }
        const lines = [
            `You belong to ${list.length} workspaces and there is no auto-target — pass \`workspace=<slug_or_id>\` on every tool call. Choices:`,
            "",
        ];
        for (const w of list) {
            lines.push(`- **${w.name}** (slug: \`${w.slug}\`, role: ${w.role})`);
        }
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
    (0, knowledge_js_1.registerKnowledgeTools)(registerTool, client); // dopl_kb + dopl_kb_admin (user bases)
    (0, skills_js_1.registerSkillTools)(registerTool, client); // dopl_skill + dopl_skill_admin
    (0, chats_js_1.registerChatTools)(registerTool, client); // dopl_chats + dopl_chats_admin (archive)
    (0, members_js_1.registerMembersTool)(registerTool, client); // dopl_members — membership/teams/access (read-only)
    (0, map_js_1.registerMapTool)(registerTool, client); // dopl_map — compact workspace manifest
    (0, search_js_1.registerSearchTool)(registerTool, client); // dopl_search — cross-domain search
    (0, ontology_js_1.registerOntologyTool)(registerTool, client); // dopl_ontology — routing graph (read-only)
    (0, channel_js_1.registerChannelTool)(registerTool, client); // dopl_channel — cross-user collaboration channels
    return server;
}
