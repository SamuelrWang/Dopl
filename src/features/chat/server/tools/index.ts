import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { CanvasContextPayload } from "../canvas-context";
import type { ToolHandler, ToolResult } from "./types";
import { executeSearchKnowledgeBase, executeGetEntryDetails } from "./search";
import {
  executeListWorkspaceClusters,
  executeListClusterBrainMemories,
  executeAddClusterBrainMemory,
  executeUpdateClusterBrainMemory,
  executeRemoveClusterBrainMemory,
  executeRewriteClusterBrainInstructions,
} from "./brain";
import {
  executeListWorkspaceKnowledgeBases,
  executeSearchWorkspaceKnowledge,
  executeReadKnowledgeEntry,
  type KnowledgeScopeFilters,
} from "./knowledge";
import {
  executeListWorkspaceSkills,
  executeReadSkillFile,
  type SkillsScopeFilters,
} from "./skills";
import {
  executeEmitAgentPrompt,
  executeEmitContextFile,
} from "./artifacts";
import {
  executeExecuteIntegrationActionTool,
  executeIntegrationStatus,
  executeListIntegrationActionsTool,
  executeListIntegrationObjects,
  executeReadIntegrationObject,
} from "./integrations";

/**
 * Per-chat scope filters the user picks via the ClusterScopePicker. The
 * route handler reads this off the conversation row and passes it
 * through to every tool dispatch so each tool can narrow its query.
 *
 * Currently consumed by the workspace-knowledge and skills tools. The
 * cluster-brain tools accept it for future parity (no-op today).
 */
export interface ChatScopeFilters
  extends KnowledgeScopeFilters,
    SkillsScopeFilters {
  clusterIds?: string[];
}

export type ChatMode = "workspace" | "private";

// ── Tool catalogue ─────────────────────────────────────────────────

const SEARCH_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge_base",
    description:
      "Search the public Dopl catalog for AI/automation setups matching a query. Use this for ideas, patterns, and reference implementations from the wider community — NOT for the user's own workspace data. Returns ranked results with titles and summaries.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Natural language search query" },
        max_results: { type: "number", description: "Number of results (default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_entry_details",
    description:
      "Get full details (README, agents.md, manifest, tags) of one Dopl catalog entry. Use after search_knowledge_base when you need implementation specifics from a result.",
    input_schema: {
      type: "object" as const,
      properties: {
        entry_id: { type: "string", description: "Entry UUID from search results" },
      },
      required: ["entry_id"],
    },
  },
];

const CLUSTER_READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_workspace_clusters",
    description:
      "List the workspace's clusters with names, slugs, and panel counts. Use this when you need to know what clusters exist before reading their brain memories or referencing them in a synthesis.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_cluster_brain_memories",
    description:
      "Fetch a cluster's brain — the synthesized instructions text plus the list of memories (workspace-shared and the calling user's personal memories). Use this when synthesizing context about a cluster's domain.",
    input_schema: {
      type: "object" as const,
      properties: {
        cluster_slug: { type: "string", description: "The cluster's slug." },
      },
      required: ["cluster_slug"],
    },
  },
];

const CLUSTER_WRITE_TOOLS: Anthropic.Tool[] = [
  {
    name: "add_cluster_brain_memory",
    description:
      "Append a new memory to a cluster's brain. Use for preferences/corrections the user tells you to remember about this cluster's domain (e.g., 'prefer Resend over SendGrid', 'always ask before scraping'). Keep the memory short and imperative. Set scope='personal' when the memory is private to this user (their own setup, env, machine, alias) — those memories are visible only to them and never written to the shared canvas brain panel; default scope='workspace' shares with every member of the workspace.",
    input_schema: {
      type: "object" as const,
      properties: {
        cluster_slug: { type: "string", description: "The cluster's slug." },
        content: { type: "string", description: "The memory text. Short, imperative." },
        scope: {
          type: "string",
          enum: ["workspace", "personal"],
          description:
            "Visibility scope. 'workspace' (default) shares with every member; 'personal' is private to the calling user.",
        },
      },
      required: ["cluster_slug", "content"],
    },
  },
  {
    name: "update_cluster_brain_memory",
    description:
      "Update the text of an existing memory. Call list_cluster_brain_memories first to find the memory_id. The memory must belong to the named cluster.",
    input_schema: {
      type: "object" as const,
      properties: {
        cluster_slug: { type: "string", description: "The cluster's slug." },
        memory_id: { type: "string", description: "UUID of the memory to update." },
        content: { type: "string", description: "New memory text." },
      },
      required: ["cluster_slug", "memory_id", "content"],
    },
  },
  {
    name: "remove_cluster_brain_memory",
    description:
      "Permanently delete a memory from a cluster's brain. Call list_cluster_brain_memories first to find the memory_id. The memory must belong to the named cluster.",
    input_schema: {
      type: "object" as const,
      properties: {
        cluster_slug: { type: "string", description: "The cluster's slug." },
        memory_id: { type: "string", description: "UUID of the memory to delete." },
      },
      required: ["cluster_slug", "memory_id"],
    },
  },
  {
    name: "rewrite_cluster_brain_instructions",
    description:
      "Replace the cluster brain's instructions text wholesale. Destructive — you are overwriting the entire instructions body. Prefer add_cluster_brain_memory for incremental changes; only use rewrite for major restructuring. Call list_cluster_brain_memories first to read the current instructions so you can preserve what matters.",
    input_schema: {
      type: "object" as const,
      properties: {
        cluster_slug: { type: "string", description: "The cluster's slug." },
        instructions: { type: "string", description: "New instructions body (replaces existing)." },
      },
      required: ["cluster_slug", "instructions"],
    },
  },
];

const WORKSPACE_KB_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_workspace_knowledge_bases",
    description:
      "List the workspace's knowledge bases with their slugs, names, and descriptions. The user's own knowledge bases — different from the public Dopl catalog covered by search_knowledge_base.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "search_workspace_knowledge",
    description:
      "Full-text search across the workspace's knowledge-base entries. Returns matching entries with snippets + the KB they belong to. Use this when the user asks about something they 'have' or 'know' — their own writing/notes — rather than the public catalog.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query (free-text)." },
        max_results: { type: "number", description: "Max results (default 8)." },
      },
      required: ["query"],
    },
  },
  {
    name: "read_knowledge_entry",
    description:
      "Read the full body of a workspace knowledge-base entry. Address by entry_id (preferred — get this from search_workspace_knowledge), OR by knowledge_base_slug + title for direct lookups.",
    input_schema: {
      type: "object" as const,
      properties: {
        entry_id: { type: "string", description: "Entry UUID (preferred)." },
        knowledge_base_slug: {
          type: "string",
          description: "KB slug, used with `title` when entry_id isn't known.",
        },
        title: {
          type: "string",
          description: "Entry title, used with `knowledge_base_slug`.",
        },
      },
      required: [],
    },
  },
];

const WORKSPACE_SKILLS_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_workspace_skills",
    description:
      "List the workspace's skills (procedural prompt templates) with name, description, and when_to_use. Includes private skills the calling user authored.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "read_skill_file",
    description:
      "Read one file inside a skill (defaults to SKILL.md, the canonical body). Use this when synthesizing context that should include skill procedures.",
    input_schema: {
      type: "object" as const,
      properties: {
        skill_id: { type: "string", description: "Skill UUID (preferred)." },
        skill_slug: {
          type: "string",
          description: "Skill slug, used when skill_id isn't known.",
        },
        file_name: {
          type: "string",
          description: "File name to read. Defaults to 'SKILL.md'.",
        },
      },
      required: [],
    },
  },
];

const INTEGRATION_PROVIDER_ENUM = [
  "notion",
  "gmail",
  "google_drive",
  "github",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "slack",
] as const;

const INTEGRATION_TOOLS: Anthropic.Tool[] = [
  {
    name: "integration_status",
    description:
      "Check whether a third-party service is connected for this workspace. Returns one of: connected, needs_auth, error, disconnected. Call this first when the user asks about external content; if not connected, tell them to visit /settings/integrations to connect.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          enum: INTEGRATION_PROVIDER_ENUM,
          description:
            "Which third-party service to check. Supported: notion, gmail, google_drive, github, google_calendar, google_docs, google_sheets, slack.",
        },
      },
      required: ["provider"],
    },
  },
  {
    name: "list_integration_objects",
    description:
      "Search/list objects from a connected third-party service. **Read-shaped providers only**: notion (pages), gmail (threads), google_drive (files). For other providers (github, google_calendar, google_docs, google_sheets, slack) this returns INTEGRATION_READ_NOT_SUPPORTED — use `execute_integration_action` (MCP) for action-shaped reads on those toolkits. Use the returned `id` with `read_integration_object` to fetch full content.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          enum: INTEGRATION_PROVIDER_ENUM,
          description: "Which third-party service to search.",
        },
        query: {
          type: "string",
          description:
            "Free-text query. For Gmail use Gmail search syntax (e.g. 'from:foo subject:bar after:2026/01/01'). For Notion this is a title search.",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from a previous response.",
        },
        limit: {
          type: "number",
          description: "Max objects to return (default 10, max 50).",
        },
      },
      required: ["provider"],
    },
  },
  {
    name: "read_integration_object",
    description:
      "Fetch the full content of one object from a connected provider. **Read-shaped providers only**: notion (page → markdown), gmail (thread → all messages), google_drive (file → text). Other providers return INTEGRATION_READ_NOT_SUPPORTED. Use after `list_integration_objects` to drill into a result.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          enum: INTEGRATION_PROVIDER_ENUM,
          description: "Which third-party service the object lives in.",
        },
        object_id: {
          type: "string",
          description:
            "The id from `list_integration_objects` (page id, thread id, file id).",
        },
      },
      required: ["provider", "object_id"],
    },
  },
  {
    name: "list_integration_actions",
    description:
      "Discover every action a connected provider exposes — covers all 8 supported providers. Returns `{ actions: [{ name, summary, paramsJsonSchema, source }] }`. `paramsJsonSchema` is a standard JSON Schema fragment; read it to construct the `params` object you'll pass to `execute_integration_action`. `source` is `curated` (hand-tuned) or `auto` (auto-mapped from Composio). The catalog can be large (50+ actions); narrow your reading to actions the user's request implies — search by intent in the action names (e.g. 'list_events', 'create_event' for Calendar; 'append_row', 'get_spreadsheet' for Sheets; 'post_message' for Slack).",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          enum: INTEGRATION_PROVIDER_ENUM,
          description: "Which third-party service to enumerate actions for.",
        },
      },
      required: ["provider"],
    },
  },
  {
    name: "execute_integration_action",
    description:
      "Run a named action on a connected provider — works for every action Composio exposes across all 8 providers (gmail, calendar, sheets, docs, drive, notion, github, slack). ALWAYS call `list_integration_actions` first to discover the action name and exact `params` shape; missing required fields fail server-side validation. Returns `{ ok: true, data }` on success, `{ ok: false, error }` if the provider rejected the call. Side-effecting for write actions (create_*, send_*, delete_*, update_*); confirm with the user before running those. Read actions (list_*, get_*, fetch_*, search_*) are safe to call without confirmation.",
    input_schema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          enum: INTEGRATION_PROVIDER_ENUM,
          description: "Which third-party service to act on.",
        },
        action: {
          type: "string",
          description:
            "Action name from `list_integration_actions` (e.g. 'send_email', 'list_events', 'append_row', 'create_issue').",
        },
        params: {
          type: "object",
          description:
            "Action params, shape determined by the action's `paramsJsonSchema`.",
        },
        alias: {
          type: "string",
          description:
            "Optional account alias when the user has multiple connected accounts for this provider (e.g. work + personal Gmail). Defaults to most-recently-used.",
        },
      },
      required: ["provider", "action", "params"],
    },
  },
];

const ARTIFACT_TOOLS: Anthropic.Tool[] = [
  {
    name: "emit_agent_prompt",
    description:
      "Render a copy-pasteable Agent Prompt artifact in the chat. Use ONLY when the user has asked for an action you cannot perform yourself — wrap the action as a self-contained prompt the user can paste into their executing agent (Claude Code, Cursor, etc.). The prompt must include all the context the agent needs: target cluster/KB/skill names, constraints, and the exact action.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short title for the artifact card (≤60 chars)." },
        prompt: {
          type: "string",
          description:
            "Self-contained markdown prompt for the user's agent. Must work without this conversation as context.",
        },
      },
      required: ["title", "prompt"],
    },
  },
  {
    name: "emit_context_file",
    description:
      "Render a synthesized Context File artifact in the chat — a focused markdown bundle the user can copy or download to drop into an agent session. Use when the user asks for a summary / synthesis / 'context file' / 'everything about X'. Pull bits from across read tools (search_workspace_knowledge, read_skill_file, list_cluster_brain_memories, etc.) and curate; don't dump.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Short title for the artifact card (≤60 chars)." },
        markdown: {
          type: "string",
          description:
            "The synthesized markdown bundle. Cite sources by name inline.",
        },
      },
      required: ["title", "markdown"],
    },
  },
];

/**
 * Workspace-mode tool set — preserves the canvas chat surface (search +
 * cluster reads + cluster brain mutations) and adds the integration
 * action surface so the agent can run write actions on connected
 * providers (e.g. send a Gmail, post a Slack message, create a
 * Calendar event) without leaving the canvas chat.
 */
export const WORKSPACE_TOOLS: Anthropic.Tool[] = [
  ...SEARCH_TOOLS,
  ...CLUSTER_READ_TOOLS,
  ...CLUSTER_WRITE_TOOLS,
  ...INTEGRATION_TOOLS,
];

/**
 * Private-mode tool set — read-only across every workspace data family
 * + the artifact-emit tools, PLUS the integration action surface so
 * the agent can pull from any connected provider (Calendar events,
 * Sheets rows, Slack history, GitHub issues) without us having to
 * hand-wrap a read path per provider. Write actions are reachable
 * here too — the system prompt nudges the agent to confirm
 * destructive operations with the user before running them.
 */
export const PRIVATE_TOOLS: Anthropic.Tool[] = [
  ...SEARCH_TOOLS,
  ...CLUSTER_READ_TOOLS,
  ...WORKSPACE_KB_TOOLS,
  ...WORKSPACE_SKILLS_TOOLS,
  ...INTEGRATION_TOOLS,
  ...ARTIFACT_TOOLS,
];

/**
 * Backwards-compat alias — the old `TOOLS` export pointed at the
 * workspace toolset. Existing callers that haven't been updated to
 * pass `mode` get the same behaviour as before.
 */
export const TOOLS = WORKSPACE_TOOLS;

// ── Dispatch ───────────────────────────────────────────────────────

const HANDLERS: Record<string, ToolHandler> = {
  search_knowledge_base: executeSearchKnowledgeBase,
  get_entry_details: executeGetEntryDetails,
  list_workspace_clusters: executeListWorkspaceClusters,
  list_cluster_brain_memories: executeListClusterBrainMemories,
  add_cluster_brain_memory: executeAddClusterBrainMemory,
  update_cluster_brain_memory: executeUpdateClusterBrainMemory,
  remove_cluster_brain_memory: executeRemoveClusterBrainMemory,
  rewrite_cluster_brain_instructions: executeRewriteClusterBrainInstructions,
};

/**
 * Tool handlers that need scopeFilters threaded in. The standard
 * ToolHandler signature stops at workspaceId, so these get a sibling
 * dispatch path with the extra arg.
 */
type ScopedToolHandler = (
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload,
  workspaceId?: string,
  scopeFilters?: ChatScopeFilters
) => Promise<ToolResult>;

const SCOPED_HANDLERS: Record<string, ScopedToolHandler> = {
  list_workspace_knowledge_bases: executeListWorkspaceKnowledgeBases,
  search_workspace_knowledge: executeSearchWorkspaceKnowledge,
  read_knowledge_entry: executeReadKnowledgeEntry,
  list_workspace_skills: executeListWorkspaceSkills,
  read_skill_file: executeReadSkillFile,
  emit_agent_prompt: (input) => executeEmitAgentPrompt(input),
  emit_context_file: (input) => executeEmitContextFile(input),
  integration_status: (input, userId, canvasContext, workspaceId) =>
    executeIntegrationStatus(input, userId, canvasContext, workspaceId),
  list_integration_objects: (input, userId, canvasContext, workspaceId) =>
    executeListIntegrationObjects(input, userId, canvasContext, workspaceId),
  read_integration_object: (input, userId, canvasContext, workspaceId) =>
    executeReadIntegrationObject(input, userId, canvasContext, workspaceId),
  list_integration_actions: (input, userId, canvasContext, workspaceId) =>
    executeListIntegrationActionsTool(input, userId, canvasContext, workspaceId),
  execute_integration_action: (input, userId, canvasContext, workspaceId) =>
    executeExecuteIntegrationActionTool(input, userId, canvasContext, workspaceId),
};

/**
 * Dispatch a single tool call to its handler. When a tool isn't allowed
 * in the active mode, we return an error string rather than throwing —
 * Claude treats it as a normal failed tool result and recovers.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload,
  workspaceId?: string,
  options?: { mode?: ChatMode; scopeFilters?: ChatScopeFilters }
): Promise<ToolResult> {
  const mode: ChatMode = options?.mode ?? "workspace";
  const allowed = isToolAllowed(name, mode);
  if (!allowed) {
    return {
      result: JSON.stringify({
        error: `Tool '${name}' is not available in ${mode} chat mode.`,
      }),
    };
  }

  const scoped = SCOPED_HANDLERS[name];
  if (scoped) {
    return scoped(input, userId, canvasContext, workspaceId, options?.scopeFilters);
  }
  const handler = HANDLERS[name];
  if (!handler) return { result: `Unknown tool: ${name}` };
  return handler(input, userId, canvasContext, workspaceId);
}

function isToolAllowed(name: string, mode: ChatMode): boolean {
  const set = mode === "private" ? PRIVATE_TOOLS : WORKSPACE_TOOLS;
  return set.some((t) => t.name === name);
}
