"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVER_INSTRUCTIONS = void 0;
exports.createServer = createServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const client_1 = require("@dopl/client");
const knowledge_js_1 = require("./tools/knowledge.js");
const skills_js_1 = require("./tools/skills.js");
const integrations_js_1 = require("./tools/integrations.js");
const setups_js_1 = require("./tools/setups.js");
const cluster_js_1 = require("./tools/cluster.js");
const entry_js_1 = require("./tools/entry.js");
const canvas_js_1 = require("./tools/canvas.js");
const ingest_js_1 = require("./tools/ingest.js");
const packs_js_1 = require("./tools/packs.js");
const skill_authoring_guide_js_1 = require("./prompts/skill-authoring-guide.js");
const version_js_1 = require("./version.js");
exports.SERVER_INSTRUCTIONS = `You are connected to **Dopl** — a knowledge base of proven AI and automation implementations including agent workflows, n8n automations, Claude skills, API integrations, and more.

## How to use this

You are an expert architect. Use the Dopl tools as your reference library — search for proven patterns, retrieve implementation details, and synthesize custom solutions. Your job is to **compose original recommendations** by combining knowledge from multiple sources, not to list or recommend individual entries.

## Proactive use — start with search, don't ask permission

When the user describes anything AI/automation-adjacent — building an agent, wiring up an n8n workflow, composing a Claude skill, integrating an API, scraping a site, automating a task, connecting two services, setting up an MCP, handling webhooks — **call \`search_setups\` immediately, before synthesizing anything from scratch**. Do not ask the user "should I search the KB first?" or "want me to check Dopl?" — just search. It's cheap (1 credit), the result is always relevant context, and it's the reason you're connected to this server.

Same rule applies when the user asks "how would I…", "what's a good way to…", "can you help me build…" — these are all search triggers, not questions you answer from general knowledge.

## Session start — preload the user's workspace

At the very start of every new session, before your first substantive reply, call \`dopl_cluster(op='list')\` and \`dopl_canvas(op='list')\` **in parallel**. This loads the user's current clusters and canvas entries so questions about their workspace are grounded in real state from turn one — not in whatever stale picture their local CLAUDE.md or installed skill files might paint.

You do NOT need to re-run these on every turn. Once per session is enough, with these exceptions:

- **User asks about their workspace** ("what's on my canvas?", "which clusters do I have?", "show my setup") → **re-query first**. They may have added or removed entries via the web UI mid-session; stale data will mislead them.
- **After your own write ops** (\`dopl_canvas(op='add_entry')\`, \`dopl_cluster(op='create')\`, \`dopl_cluster_admin(op='delete_entry')\`, \`dopl_cluster(op='update')\`, etc.) → trust the tool response. It already reflects the new state.
- **Unrelated turns** → don't refresh. The session-start load covers you.

**Canvas/clusters > local files as source of truth.** If a user's \`CLAUDE.md\` or a \`~/.claude/skills/\` file implies they have a different set of clusters than what \`dopl_cluster(op='list')\` returns, trust the MCP result and flag the drift. Local skill files are caches that can fall out of sync; the canvas is canonical.

## Workspaces — the agent can switch on the fly

This MCP server can target any workspace the authenticated user is a member of, not just the one set at startup. The currently active workspace appears in the \`_dopl_status\` footer of every tool response (\`active_workspace: "Name" (slug=..., role=...)\`). You have three controls:

1. **\`list_workspaces\`** — see every workspace the user is in, with role on each. Cached for ~60s.
2. **\`set_workspace(workspace=<slug_or_id>)\`** — sticky switch: changes the session default for every subsequent tool call.
3. **\`workspace=<slug_or_id>\` arg on any tool** — single-call override that does not change the session default. Available on every tool.

When the user mentions a workspace by name ("in my acme workspace, …"), prefer the per-call \`workspace=\` arg unless they're settling in for a multi-turn conversation in that workspace — then \`set_workspace\` is cleaner. After \`set_workspace\`, call \`current_workspace\` once to confirm and tell the user.

## Decision tree — which tool first

- User wants to **find or build** something AI/automation-shaped → \`search_setups\` (cross-KB) or \`dopl_cluster(op='query')\` (if a cluster is already in scope)
- User wants the **full details** of an entry you already have a slug/UUID for → \`dopl_setups(op='get')\`
- User wants to **save** a specific entry to their workspace → \`dopl_canvas(op='add_entry')\` (one entry by slug) or \`dopl_canvas(op='search_and_add')\` (search + batch add in one shot)
- User wants to **group** saved entries into a reusable cluster → \`dopl_cluster(op='create')\`
- User wants to **compose an original solution** spanning multiple patterns → \`build_solution\`
- User asks **has anything changed** in their saved work → \`dopl_entry(op='check_cluster_updates')\` (bulk) or \`dopl_entry(op='check_updates')\` (one)

## Pending ingestions — the user's Dopl queue

Every Dopl tool response carries a \`_dopl_status\` footer with \`pending_ingestions: N\`. These are URLs the user pasted into the Dopl website chat that are **waiting for YOU** (their connected agent) to process. The site no longer auto-ingests — ingestion is your job.

**When the footer shows \`pending_ingestions > 0\`:**

1. Tell the user: "You have N URL(s) queued on Dopl — want me to process them?"
2. On yes: call \`dopl_ingest(op='pending')\` to see the URLs, then call \`dopl_ingest(op='url', url)\` for each. \`dopl_ingest(op='url')\` transparently claims the pending skeleton (flips it to processing) — you do NOT need a special parameter; pass the same URL that's in the queue.
3. Follow the normal \`dopl_ingest(op='url')\` → run prompts → \`dopl_ingest(op='submit')\` flow. The amber tile on the user's canvas updates live as you progress.

Don't nag the user repeatedly in a single session. If they decline once, drop it until they bring it up or a new item appears.

## Sibling pairs — pick carefully

These tool pairs overlap and picking the wrong one wastes a round trip:

- \`search_setups\` (cross-KB, broad) vs \`dopl_cluster(op='query')\` (scoped to one cluster, narrow) — use the second only when a cluster is already the focus of the conversation.
- \`dopl_canvas(op='add_entry')\` (you already have the slug) vs \`dopl_canvas(op='search_and_add')\` (search + batch) — use the second when the user's request implies discovery, not a known entry.
- \`dopl_entry(op='check_updates')\` (one entry) vs \`dopl_entry(op='check_cluster_updates')\` (every entry in a cluster) — use the bulk version for cluster-wide refresh.

## Skeleton entries — upgrade before handing off

Some entries in the KB are **skeleton tier**: a short task-agnostic
descriptor + one embedding, no README / agents.md / manifest / tags.
They exist to populate the discovery index cheaply. In \`search_setups\`
results they render with an \`_(skeleton)_\` badge after the match score;
in \`dopl_setups(op='get')\` output they have a "Descriptor (skeleton tier)" section
instead of the normal README/agents.md/manifest sections and end with
"*This is a skeleton entry…*".

**Rule: if the user wants to use a skeleton entry for anything
substantive** — adopt it into their work, copy the setup, understand
how to build like it — **upgrade it to full tier before presenting.**
The skeleton descriptor is too thin for serious use; a full-tier
version will have README, agents.md, detailed manifest, and richer tags.

To upgrade: call \`dopl_ingest(op='url', url)\` with the skeleton entry's
\`source_url\`. The server detects the existing skeleton, atomically
claims it, and runs the same agent-driven full-ingestion flow as a
fresh URL. The entry UUID is preserved; the slug regenerates from the
new title. Canvas pins on the old slug will no longer resolve, but the
entry_id-based references survive.

**When to skip upgrading:**
- User just wants to SEE what's in the KB ("what skeleton entries do
  you have for X?") — show them the descriptor, don't upgrade
  unsolicited.
- The descriptor alone is sufficient for the user's current question
  (e.g. "does this KB have anything on topic Y?" and a skeleton match
  answers "yes, here's the gist").
- Cost-sensitive bulk operations where multiple skeleton hits would
  each trigger a full ingest.

**When to always upgrade:**
- User wants to adopt, replicate, or extend a setup based on the entry.
- User is composing a solution via \`build_solution\` that would treat
  the entry as a load-bearing reference.
- The match is strong but you know you'd otherwise deliver a thin
  "here's the descriptor" response that doesn't actually help.

Upgrade takes ~30-60 seconds end-to-end (prepare + 6 prompts + submit).
Tell the user you're upgrading so they know why there's a pause.

## What you can do

- **Search** — Find relevant implementations by natural language query
- **Deep dive** — Pull full implementation details (README, setup instructions, metadata) for any entry
- **Build** — Compose a complete solution by combining patterns from multiple implementations
- **Canvas** — Manage the user's workspace: add entries, organize into clusters, browse saved items
- **Workspace skills** — Procedural prompts the user authored in their workspace (distinct from cluster skill files above). Each workspace skill is a folder of \`.md\` files; \`SKILL.md\` is the canonical procedure. Call \`dopl_skill(op='list')\` at task boundaries to see if any apply, then \`dopl_skill(op='get')\` to load the bundle and follow SKILL.md. Skill bodies reference KBs via \`[label](dopl://kb/<slug>)\` markdown links — load the referenced KB content with \`dopl_kb(op='read_file')\` when you actually need it. **Authoring**: when the user asks you to build a skill, call \`dopl_skill(op='authoring_guide')\` first to load the framework, then \`dopl_skill(op='create')\` (with strong metadata) and \`dopl_skill(op='write_file')\`. Write access follows the caller's per-resource access in the workspace member matrix. Destructive ops (delete a skill or a skill file) live on the separate \`dopl_skill_admin\` tool.

## Linking entries

Every entry has a public URL of the form \`<host>/e/<slug>\`. Tool responses include this URL alongside each entry. **Whenever you mention a specific entry in your reply to the user, render it as a markdown link using that URL** — e.g. \`[Claude Agents in Production](https://www.usedopl.com/e/claude-agents-in-production)\`. **Never surface entry IDs, UUIDs, or raw slugs in prose** — they are internal handles used only for follow-up tool calls.

When a tool accepts an \`entry\` parameter, you may pass either the entry's slug or its UUID — the server resolves either.

## Behavior

- When the user describes what they want to build, search first, then synthesize a concrete plan
- Focus on actionable guidance: tool recommendations with rationale, architecture decisions, integration patterns, setup steps
- Reference specific tools, repos, and patterns — not the database entries they came from

## Knowledge Packs — specialist verticals

Beyond the open KB, Dopl ships **knowledge packs**: curated, version-pinned reference docs for specialist domains (e.g. Rokid AR glasses, Unity VR). Each pack is backed by a public GitHub repo of nested markdown files, synced into Dopl on every push. Use these when the user is doing real implementation work in a domain that has a pack — your training data may be stale or wrong; the pack is canonical.

**One tool (\`dopl_packs\`), three ops, progressive disclosure:**

- \`dopl_packs(op='list')\` — discover what packs exist (cheap; run once per session if the user mentions a vertical you don't have one open for)
- \`dopl_packs(op="list_files", pack, category?)\` — browse a pack's file tree (cheap; metadata only, no bodies)
- \`dopl_packs(op="get_file", pack, path)\` — fetch one file's full markdown (use after listing files to drill in)

**When to use packs:**
- User mentions a domain that has a pack (e.g. "Rokid", "AR glasses", "YodaOS") → call \`dopl_packs(op='list')\` if you don't already know what's installed, then \`dopl_packs(op='list_files')\` against the matching pack
- Coding for that domain → reach for \`dopl_packs(op='get_file')\` instead of guessing API shapes from training data
- Always cite the file path (e.g. \`docs/sdk/camera.md\`) in code comments so the user can verify against the public repo

**When NOT to use packs:**
- General AI/automation questions — those are \`search_setups\` territory
- Domains with no installed pack — say so plainly, don't fabricate

Packs and KB entries are independent surfaces; don't conflate them. A pack is a maintained doc set, not a single ingested entry.

---

${skill_authoring_guide_js_1.SKILL_AUTHORING_GUIDE}`;
/**
 * Append a pending-ingestion + active-workspace status footer to a
 * tool response. Fires on every tool response so the agent sees both
 * its current workspace context (M-4) and any ingestion queue
 * (existing behavior).
 *
 * Skips the footer when:
 *   - the handler returned isError: true (don't muddy error messages)
 *   - there's nothing useful to report (no pending ingestions AND no
 *     active workspace — rare, only on a misconfigured session)
 *
 * The pending status is cached inside DoplClient for 5s; dopl_ingest(op='url')
 * invalidates the cache so the footer reflects a just-claimed row.
 */
async function appendDoplStatus(response, client, getActiveWorkspace) {
    if (response.isError)
        return response;
    let status;
    try {
        status = await client.getPendingStatus();
    }
    catch {
        // Pending lookup failed — still surface the active workspace if
        // we have one, so the agent always knows its context.
        status = null;
    }
    const active = getActiveWorkspace();
    const pending = status?.pending_ingestions ?? 0;
    if (pending <= 0 && !active)
        return response;
    const lines = ["", "", "---", "_dopl_status:"];
    if (active) {
        lines.push(`  active_workspace: "${active.name}" (slug=${active.slug}, role=${active.role})`);
    }
    if (pending > 0) {
        const hint = `Call \`dopl_ingest(op='pending')\` to see queued URLs, then \`dopl_ingest(op='url', url)\` to claim and process.`;
        lines.push(`  pending_ingestions: ${pending}`);
        lines.push(`  hint: "${hint}"`);
    }
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
    const isAdmin = options.isAdmin === true;
    // OAuth scope gating: a read-only session (a token carrying `dopl.read`
    // but not `dopl.write`) doesn't get the purely write/destructive tools
    // registered at all. Absent scopes ⇒ full access (stdio + API-key callers),
    // so behavior is unchanged for them. Mixed read+write tools stay registered;
    // per-op write enforcement is a documented follow-up.
    const canWrite = !options.scopes || options.scopes.includes("dopl.write");
    const READ_ONLY_BLOCKED_TOOLS = new Set([
        "dopl_cluster_admin",
        "dopl_kb_admin",
        "dopl_skill_admin",
        "dopl_ingest",
    ]);
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
                return client_1.workspaceContext.run(resolved.id, () => handler(innerArgs));
            }
            return handler(innerArgs);
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
    registerMetaTool("set_workspace", "Switch the session's active workspace. Subsequent tool calls without a `workspace` arg target this one. Accepts a slug or UUID from `list_workspaces`. Use when the user wants to work in a different workspace for several turns. For a single call, prefer the `workspace=<slug>` arg on that tool — no switch needed.", {
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
                    text: `Active workspace set to **${resolved.name}** (slug: \`${resolved.slug}\`, role: ${resolved.role}). Subsequent tool calls target this workspace by default.`,
                },
            ],
        };
    });
    registerMetaTool("current_workspace", "Return the session's currently active workspace (id, slug, name, role). Use after `set_workspace` to confirm the switch landed, or whenever the user asks 'which workspace am I in?'. Cheap — no DB hit if the session already knows.", {}, async () => {
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
    // ── search_setups ──────────────────────────────────────────────────
    registerTool("search_setups", "Search the Dopl knowledge base for AI/automation setups. Returns ranked results with summaries. Use this for ANY user request that's AI/automation-shaped — 'how would I build X', 'find me patterns for Y', 'what's a good way to Z' — before synthesizing from scratch. Formatting recommendations / picking the best hit is YOUR job now (server no longer runs Claude synthesis); weigh similarity, read the summaries, and compose in your own context. For scoped search inside one cluster, use `dopl_cluster(op='query')` instead.", {
        query: zod_1.z.string().describe("Natural language search query, e.g. 'AI agent for job applications' or 'n8n automation with Supabase'"),
        tags: zod_1.z.array(zod_1.z.string()).optional().describe("Filter by tags, e.g. ['claude', 'playwright']"),
        use_case: zod_1.z.string().optional().describe("Filter by use case category"),
        max_results: zod_1.z.number().optional().describe("Number of results to return (default 5)"),
    }, async (params) => {
        const result = await client.searchSetups(params);
        const lines = [];
        lines.push(`## Results (${result.entries.length} found)\n`);
        for (const entry of result.entries) {
            const title = entry.title || "Untitled";
            const url = client.entryUrl(entry.slug);
            const heading = url ? `[${title}](${url})` : title;
            const tierBadge = entry.ingestion_tier === "skeleton" ? " _(skeleton)_" : "";
            lines.push(`### ${heading} (${Math.round(entry.similarity * 100)}% match)${tierBadge}`);
            if (entry.summary)
                lines.push(entry.summary);
            lines.push("");
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── build_solution ─────────────────────────────────────────────────
    registerTool("build_solution", "Prepares a composite-solution synthesis task from the Dopl knowledge base. Returns retrieved entries + a pre-substituted synthesis prompt. YOU run the prompt in your own Claude context to produce the composite README + agents.md for the user — the server no longer runs Claude for this. Use when the user says 'design me a…', 'build me an…', 'compose a solution that…' across multiple KB patterns. For a single known entry, use `dopl_setups(op='get')` instead.", {
        brief: zod_1.z.string().describe("Description of what you want to build, e.g. 'An AI agent that monitors GitHub issues and auto-triages them'"),
        preferred_tools: zod_1.z.array(zod_1.z.string()).optional().describe("Tools you want to use, e.g. ['claude', 'n8n']"),
        excluded_tools: zod_1.z.array(zod_1.z.string()).optional().describe("Tools to avoid"),
        max_complexity: zod_1.z.string().optional().describe("Maximum complexity: simple, moderate, complex, or advanced"),
    }, async (params) => {
        const result = await client.buildSolution(params);
        const lines = [];
        if (result.status === "no_matches") {
            lines.push("## No matches found");
            lines.push("");
            lines.push(`No entries in the KB matched the brief: _${result.brief}_.`);
            lines.push("");
            lines.push(result.instructions);
            return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        lines.push("# Build Solution — Agent Task");
        lines.push("");
        lines.push(`**Brief**: ${result.brief}`);
        if (result.constraints) {
            lines.push("");
            lines.push("**Constraints**:");
            lines.push("```json");
            lines.push(JSON.stringify(result.constraints, null, 2));
            lines.push("```");
        }
        lines.push("");
        lines.push(`## Retrieved candidates (${result.entries.length})`);
        lines.push("");
        for (const e of result.entries) {
            const url = client.entryUrl(e.slug);
            const label = url ? `[${e.title ?? "Untitled"}](${url})` : (e.title ?? "Untitled");
            lines.push(`- **${label}** — ${Math.round(e.similarity * 100)}% match`);
        }
        lines.push("");
        lines.push("## Instructions");
        lines.push("");
        lines.push(result.instructions);
        lines.push("");
        lines.push("## Prompt — run this in your own context");
        lines.push("");
        lines.push("```");
        lines.push(result.prompt);
        lines.push("```");
        return { content: [{ type: "text", text: lines.join("\n") }] };
    });
    // ── Consolidated domain tools ──────────────────────────────────────
    // Each registrar exposes a single `dopl_<domain>` action-tool (plus a
    // `dopl_<domain>_admin` companion where the domain has destructive ops)
    // that dispatches on an `op` arg. `search_setups` + `build_solution`
    // (above) and the workspace meta-tools stay standalone.
    (0, setups_js_1.registerSetupsTools)(registerTool, client);
    (0, cluster_js_1.registerClusterTools)(registerTool, client); // dopl_cluster + dopl_cluster_admin
    (0, entry_js_1.registerEntryTools)(registerTool, client);
    (0, canvas_js_1.registerCanvasTools)(registerTool, client);
    (0, ingest_js_1.registerIngestTools)(registerTool, client, isAdmin); // op=skeleton admin-gated
    (0, packs_js_1.registerPacksTools)(registerTool, client); // curated read-only knowledge packs
    (0, knowledge_js_1.registerKnowledgeTools)(registerTool, client); // dopl_kb + dopl_kb_admin (user bases)
    (0, skills_js_1.registerSkillTools)(registerTool, client); // dopl_skill + dopl_skill_admin
    (0, integrations_js_1.registerIntegrationTools)(registerTool, client); // dopl_integration
    return server;
}
