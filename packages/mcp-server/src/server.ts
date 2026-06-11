import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodRawShape } from "zod";
import { DoplClient, workspaceContext } from "@dopl/client";
import type {
  WorkspaceListItem,
  WorkspaceRole,
  WorkspaceSummary,
} from "@dopl/client";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerSkillTools } from "./tools/skills.js";
import { registerClusterTools } from "./tools/cluster.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerCanvasTools } from "./tools/canvas.js";
import { registerPacksTools } from "./tools/packs.js";
import { SKILL_AUTHORING_GUIDE } from "./prompts/skill-authoring-guide.js";
import { packageVersion } from "./version.js";

export const SERVER_INSTRUCTIONS = `You are connected to **Dopl** — the user's workspace of knowledge bases, skills, and clusters for AI/automation work.

## How to use this

Use the Dopl tools to read and organize the user's workspace: their knowledge bases (notes/docs), skills (procedural prompt templates), and workflows (agent-followable node graphs, grouped into clusters). Ground your answers in the user's real workspace state, not in stale local files.

## Session start — preload the user's workspace

At the very start of every new session, before your first substantive reply, call dopl_cluster(op='list') and dopl_canvas(op='list') in parallel. This loads the user's current clusters and canvas panels so questions about their workspace are grounded in real state from turn one.

You do NOT need to re-run these on every turn. Once per session is enough, except:

- User asks about their workspace ("what's on my canvas?", "which clusters do I have?") -> re-query first; they may have changed things via the web UI.
- After your own write ops (dopl_cluster create/update, dopl_kb / dopl_skill writes) -> trust the tool response; it already reflects the new state.

Workspace beats local files as source of truth. If a user's CLAUDE.md or a skills file implies a different set of clusters than dopl_cluster(op='list') returns, trust the MCP result and flag the drift.

## Workspaces — the agent can switch on the fly

This MCP server can target any workspace the authenticated user is a member of. The active workspace appears in the _dopl_status footer of every response. Controls:

1. list_workspaces — see every workspace the user is in, with role. Cached ~60s.
2. set_workspace(workspace=<slug_or_id>) — sticky switch for the session default.
3. workspace=<slug_or_id> arg on any tool — single-call override.

After set_workspace, call current_workspace once to confirm and tell the user.

## Decision tree — which tool

- See what workflows exist -> dopl_workflow(op='list'); inspect one (ordered steps + node ids + the knowledge bases / skills it references) -> dopl_workflow(op='get'). A workflow is a header + its connected node graph — the agent-followable unit.
- AUTHOR a workflow end-to-end over MCP (appears live on an open canvas): dopl_workflow(op='create') then op='set_graph' (declarative: send the whole {nodes, edges} and it's made to match) — or build incrementally with op='add_node'/'connect'/'update_node'/'remove_node'/'disconnect'. Node reads/actions reference dopl_kb / dopl_skill ids and auto-attach. Finish with op='get' to verify.
- Rename / describe a workflow -> dopl_workflow(op='update'); delete one -> dopl_workflow_admin(op='delete_workflow').
- Clusters are non-spatial CONTAINERS that group workflows. See what clusters exist -> dopl_cluster(op='list'); inspect one (its workflows) -> dopl_cluster(op='get').
- Read a knowledge-base entry -> dopl_kb(op='read_file'); read a skill's full body -> dopl_skill(op='get'). A workflow's attached KBs/skills are listed by dopl_workflow(op='get').
- Create / rename a cluster -> dopl_cluster(op='create' | 'update'); delete one -> dopl_cluster_admin(op='delete_cluster').
- Browse / read / write the user's knowledge bases -> dopl_kb (+ dopl_kb_admin for destructive ops).
- List / read / author the user's skills -> dopl_skill (+ dopl_skill_admin).
- See what's on the canvas / rename a chat panel -> dopl_canvas(op='list' | 'rename_chat').

## Workspace skills

Skills are procedural prompts the user authored. Call dopl_skill(op='list') at task boundaries to see if any apply, then dopl_skill(op='get') to load the bundle and follow SKILL.md. Skill bodies reference KBs via [label](dopl://kb/<slug>) markdown links — load referenced KB content with dopl_kb(op='read_file') when you need it. Authoring: call dopl_skill(op='authoring_guide') first, then dopl_skill(op='create') + dopl_skill(op='write_file'). Destructive ops live on dopl_skill_admin.

## Knowledge Packs — specialist verticals

Dopl ships knowledge packs: curated, version-pinned reference docs for specialist domains (e.g. Rokid AR glasses, Unity VR), backed by public GitHub repos synced on every push. Use them when the user is doing real implementation work in a domain that has a pack — your training data may be stale; the pack is canonical.

- dopl_packs(op='list') — discover what packs exist.
- dopl_packs(op='list_files', pack, category?) — browse a pack's file tree (metadata only).
- dopl_packs(op='get_file', pack, path) — fetch one file's full markdown.

Cite the file path (e.g. docs/sdk/camera.md) in code comments. For domains with no installed pack, say so plainly — don't fabricate.

---

${SKILL_AUTHORING_GUIDE}`;

/**
 * Tool-response shape the MCP SDK accepts. We re-declare it locally to
 * keep the wrapper typed without pulling the SDK's handler type.
 */
type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Snapshot of the session's active workspace, surfaced in the
 * `_dopl_status` footer (M-4) so the agent always sees which
 * workspace a tool response came from. Mutated by `set_workspace`,
 * read by `appendDoplStatus`. Null until the startup handshake
 * resolves (or if the session boots with no workspace).
 */
interface ActiveWorkspaceState {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
}

/**
 * Append an active-workspace status footer to a tool response. Fires on
 * every tool response so the agent always sees its current workspace
 * context (M-4).
 *
 * Skips the footer when:
 *   - the handler returned isError: true (don't muddy error messages)
 *   - there's no active workspace (rare, only on a misconfigured session)
 */
async function appendDoplStatus(
  response: ToolResponse,
  client: DoplClient,
  getActiveWorkspace: () => ActiveWorkspaceState | null,
): Promise<ToolResponse> {
  if (response.isError) return response;

  const active = getActiveWorkspace();
  if (!active) return response;

  const lines: string[] = ["", "", "---", "_dopl_status:"];
  lines.push(
    `  active_workspace: "${active.name}" (slug=${active.slug}, role=${active.role})`,
  );
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
  } else {
    content.push({ type: "text", text: footer.trimStart() });
  }
  return { ...response, content };
}

/**
 * Wrap a tool handler so every successful response ends with the
 * `_dopl_status` footer. Handlers stay unaware of the mechanism.
 */
function withDoplStatus<A extends object>(
  handler: (args: A) => Promise<ToolResponse>,
  client: DoplClient,
  getActiveWorkspace: () => ActiveWorkspaceState | null,
): (args: A) => Promise<ToolResponse> {
  return async (args: A) => {
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
  workspace: z
    .string()
    .optional()
    .describe(
      "Optional workspace slug or UUID to target for this single call. Defaults to the session's active workspace (see `current_workspace`). Use this when the user mentions a workspace by name; for sticky switching across multiple calls, use `set_workspace` instead.",
    ),
};
type WorkspaceArgShape = typeof WORKSPACE_ARG_SHAPE;

export function createServer(
  client: DoplClient,
  options: {
    isAdmin?: boolean;
    workspace?: WorkspaceSummary | null;
    role?: WorkspaceRole | null;
    /**
     * OAuth scopes granted for this session. Reserved for Stage 3 (OAuth):
     * when present and lacking `dopl.write`, write/admin tool ops are gated.
     * Absent ⇒ full access (stdio + bearer-key callers), so no behavior
     * change today.
     */
    scopes?: string[];
  } = {},
): McpServer {
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
    "dopl_workflow_admin",
  ]);
  // Active workspace for this MCP session — seeded from the startup
  // handshake (index.ts) and mutated by `set_workspace` mid-session.
  // The slug threads into skill-writer calls so on-disk SKILL.md paths
  // get scoped per workspace. Default slug preserves the legacy
  // single-workspace paths so existing users don't see every skill
  // rename on first upgrade.
  const canvasContext = { slug: options.workspace?.slug ?? "default" };
  let activeWorkspace: ActiveWorkspaceState | null = options.workspace
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
  let workspaceListCache: { workspaces: WorkspaceListItem[]; loadedAt: number } | null = null;

  async function getWorkspaceList(): Promise<WorkspaceListItem[]> {
    if (
      workspaceListCache &&
      Date.now() - workspaceListCache.loadedAt < WORKSPACE_CACHE_TTL_MS
    ) {
      return workspaceListCache.workspaces;
    }
    const result = await client.listWorkspaces();
    workspaceListCache = {
      workspaces: result.workspaces,
      loadedAt: Date.now(),
    };
    return result.workspaces;
  }

  async function resolveWorkspaceRef(
    ref: string,
  ): Promise<WorkspaceListItem | null> {
    // Audit B11: a workspace slug shaped like a UUID (lowercase hex
    // with hyphens) is theoretically possible. Matching on id alone
    // would miss the slug, forcing a wasteful refresh on the second
    // pass. Cheap to try both id and slug on the first pass.
    let list = await getWorkspaceList();
    let match = list.find((w) => w.id === ref || w.slug === ref);
    if (match) return match;
    // Force-refresh once — covers the case where the user was added to
    // a new workspace mid-session and the cache hasn't ticked over.
    workspaceListCache = null;
    list = await getWorkspaceList();
    match = list.find((w) => w.id === ref || w.slug === ref);
    return match ?? null;
  }

  const server = new McpServer(
    {
      name: "dopl",
      // Source of truth is package.json — read via version.ts so the
      // MCP handshake and any analytics that key on server version stay
      // accurate across publishes (audit fix #24).
      version: packageVersion,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

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
  function registerTool<S extends ZodRawShape>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>,
  ): void {
    // Read-only OAuth sessions skip write/destructive tools entirely.
    if (!canWrite && READ_ONLY_BLOCKED_TOOLS.has(name)) return;
    // Spread the workspace arg into the published schema so the agent
    // sees it on every tool's introspection without having to author
    // it per-tool. Strip it out before calling the original handler so
    // existing handler signatures keep working.
    const enhancedSchema = { ...schema, ...WORKSPACE_ARG_SHAPE } as S &
      WorkspaceArgShape;

    type EnhancedArgs = z.infer<z.ZodObject<S & WorkspaceArgShape>>;

    const wrapped = async (args: EnhancedArgs): Promise<ToolResponse> => {
      const { workspace: workspaceRef, ...rest } = args as EnhancedArgs & {
        workspace?: string;
      };
      const innerArgs = rest as unknown as z.infer<z.ZodObject<S>>;

      if (workspaceRef) {
        // Audit B8: resolveWorkspaceRef calls listWorkspaces, which
        // can throw on network / auth failures. Catch and surface a
        // friendly isError instead of letting the throw propagate
        // (which the MCP framework would expose as an opaque error).
        let resolved: WorkspaceListItem | null;
        try {
          resolved = await resolveWorkspaceRef(workspaceRef);
        } catch (err) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  `Couldn't validate the \`workspace\` argument (${
                    err instanceof Error ? err.message : String(err)
                  }). Try again, or call without \`workspace=\` to use the session's active workspace.`,
              },
            ],
          };
        }
        if (!resolved) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Workspace not found: \`${workspaceRef}\`. Call \`list_workspaces\` to see workspaces you have access to, or pass a slug or UUID from there.`,
              },
            ],
          };
        }
        // Run the handler inside the AsyncLocalStorage scope so any
        // client.* call inside it transparently picks up the override
        // workspace id in its X-Workspace-Id header. Returns to the
        // session default (or no override) the moment this scope exits.
        return workspaceContext.run(resolved.id, () => handler(innerArgs));
      }

      return handler(innerArgs);
    };

    server.tool(
      name,
      description,
      enhancedSchema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withDoplStatus(wrapped as any, client, () => activeWorkspace) as any,
    );
  }

  // Meta-tools (workspace switcher) skip the auto-injected `workspace`
  // arg — passing a workspace into "set my workspace" doesn't make
  // sense, and routing list_workspaces / current_workspace through
  // ALS adds noise to the description without changing behavior
  // (membership lookup is user-scoped, not workspace-scoped).
  function registerMetaTool<S extends ZodRawShape>(
    name: string,
    description: string,
    schema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>,
  ): void {
    server.tool(
      name,
      description,
      schema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      withDoplStatus(handler as any, client, () => activeWorkspace) as any,
    );
  }

  // ── Workspace switcher tools (M-2) ────────────────────────────────
  // Three small tools that let the agent discover and switch
  // workspaces at runtime, eliminating the old "one MCP process per
  // workspace" workaround. Combined with the per-call `workspace` arg
  // injected by `registerTool` (M-1), the agent has both a sticky
  // switch (`set_workspace`) and a single-call override (`workspace=...`).

  registerMetaTool(
    "list_workspaces",
    "List every workspace the authenticated user is an active member of, with the user's role on each (owner/admin/member/viewer). Use before `set_workspace` when the user mentions a workspace by name and you don't know its slug, or when reporting available workspaces. Result is cached per-session for ~60s.",
    {},
    async () => {
      const list = await getWorkspaceList();
      if (list.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "You're not an active member of any workspaces yet.",
            },
          ],
        };
      }
      const lines = ["Workspaces you have access to:", ""];
      for (const w of list) {
        const star = w.id === activeWorkspace?.id ? " ★" : "";
        lines.push(
          `- **${w.name}** (slug: \`${w.slug}\`, role: ${w.role})${star}`,
        );
      }
      lines.push("");
      if (activeWorkspace) lines.push("★ = currently active");
      lines.push(
        "Use `set_workspace(workspace=<slug_or_id>)` to switch the session default, or pass `workspace=<slug>` on a single tool call.",
      );
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  registerMetaTool(
    "set_workspace",
    "Switch the session's active workspace. Subsequent tool calls without a `workspace` arg target this one. Accepts a slug or UUID from `list_workspaces`. Use when the user wants to work in a different workspace for several turns. For a single call, prefer the `workspace=<slug>` arg on that tool — no switch needed.",
    {
      workspace: z
        .string()
        .min(1)
        .describe(
          "Workspace slug or UUID, from `list_workspaces`. The currently-active workspace's slug is shown in the `_dopl_status` footer.",
        ),
    },
    async ({ workspace: ref }) => {
      const resolved = await resolveWorkspaceRef(ref);
      if (!resolved) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
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
            type: "text" as const,
            text: `Active workspace set to **${resolved.name}** (slug: \`${resolved.slug}\`, role: ${resolved.role}). Subsequent tool calls target this workspace by default.`,
          },
        ],
      };
    },
  );

  registerMetaTool(
    "current_workspace",
    "Return the session's currently active workspace (id, slug, name, role). Use after `set_workspace` to confirm the switch landed, or whenever the user asks 'which workspace am I in?'. Cheap — no DB hit if the session already knows.",
    {},
    async () => {
      if (!activeWorkspace) {
        return {
          content: [
            {
              type: "text" as const,
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
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    },
  );

  // ── Consolidated domain tools ──────────────────────────────────────
  // Each registrar exposes a single `dopl_<domain>` action-tool (plus a
  // `dopl_<domain>_admin` companion where the domain has destructive ops)
  // that dispatches on an `op` arg.
  registerClusterTools(registerTool, client); // dopl_cluster + dopl_cluster_admin
  registerWorkflowTools(registerTool, client); // dopl_workflow + dopl_workflow_admin
  registerCanvasTools(registerTool, client);
  registerPacksTools(registerTool, client); // curated read-only knowledge packs
  registerKnowledgeTools(registerTool, client); // dopl_kb + dopl_kb_admin (user bases)
  registerSkillTools(registerTool, client); // dopl_skill + dopl_skill_admin

  return server;
}


