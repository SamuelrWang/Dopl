import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { CanvasContextPayload } from "../canvas-context";
import type { ToolHandler, ToolResult } from "./types";
import { executeListWorkspaceClusters } from "./clusters";
import {
  executeListWorkspaceKnowledgeBases,
  executeSearchWorkspaceKnowledge,
  executeReadKnowledgeEntry,
  executeRenderKnowledgeEntry,
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

/**
 * Per-chat scope filters the user picks via the ClusterScopePicker. The
 * route handler reads this off the conversation row and passes it
 * through to every tool dispatch so each tool can narrow its query.
 *
 * Currently consumed by the workspace-knowledge and skills tools.
 */
export interface ChatScopeFilters
  extends KnowledgeScopeFilters,
    SkillsScopeFilters {
  clusterIds?: string[];
}

export type ChatMode = "workspace" | "private";

// ── Tool catalogue ─────────────────────────────────────────────────

const CLUSTER_READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_workspace_clusters",
    description:
      "List the workspace's clusters with names, slugs, and panel counts. Use this when you need to know what clusters exist before referencing them in a synthesis.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

const WORKSPACE_KB_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_workspace_knowledge_bases",
    description:
      "List the workspace's knowledge bases with their slugs, names, and descriptions.",
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
      "Read the full body of a workspace knowledge-base entry INTO YOUR OWN context so you can reason over or synthesize from it. Address by entry_id (preferred — get this from search_workspace_knowledge), OR by knowledge_base_slug + title for direct lookups. Use this when you need the content to answer; use render_knowledge_entry instead when the user wants to SEE the entry itself.",
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
  {
    name: "render_knowledge_entry",
    description:
      "Display one knowledge-base entry as a faithful, formatted document card inline in the chat — the user sees the real entry, rendered. Use this (instead of pasting or paraphrasing the whole body) when the user wants to SEE, READ, OPEN, PULL UP, or SHOW a specific entry, or when your answer essentially IS one entry. The card fetches the true content server-side, so you do NOT need to read the entry first or reproduce its text — just call this with the reference and add a one-line lead-in. For a CURATED bundle drawn from multiple sources, use emit_context_file instead. Address by entry_id (preferred — from search_workspace_knowledge) OR knowledge_base_slug + title.",
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
      "Render a synthesized Context File artifact in the chat — a focused markdown bundle the user can copy or download to drop into an agent session. Use when the user asks for a summary / synthesis / 'context file' / 'everything about X'. Pull bits from across read tools (search_workspace_knowledge, read_skill_file, list_workspace_clusters, etc.) and curate; don't dump.",
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
 * Workspace-mode tool set — the canvas chat surface (cluster reads).
 */
export const WORKSPACE_TOOLS: Anthropic.Tool[] = [
  ...CLUSTER_READ_TOOLS,
];

/**
 * Private-mode tool set — read-only across every workspace data family
 * (clusters, knowledge bases, skills) + the artifact-emit tools.
 */
export const PRIVATE_TOOLS: Anthropic.Tool[] = [
  ...CLUSTER_READ_TOOLS,
  ...WORKSPACE_KB_TOOLS,
  ...WORKSPACE_SKILLS_TOOLS,
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
  list_workspace_clusters: executeListWorkspaceClusters,
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
  render_knowledge_entry: executeRenderKnowledgeEntry,
  list_workspace_skills: executeListWorkspaceSkills,
  read_skill_file: executeReadSkillFile,
  emit_agent_prompt: (input) => executeEmitAgentPrompt(input),
  emit_context_file: (input) => executeEmitContextFile(input),
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
