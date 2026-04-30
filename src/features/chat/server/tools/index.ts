import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { CanvasContextPayload } from "../canvas-context";
import type { ToolHandler, ToolResult } from "./types";
import { executeSearchKnowledgeBase, executeGetEntryDetails } from "./search";
import { executeIngestUrl } from "./ingest";
import {
  executeListUserClusters,
  executeListClusterBrainMemories,
  executeAddClusterBrainMemory,
  executeUpdateClusterBrainMemory,
  executeRemoveClusterBrainMemory,
  executeRewriteClusterBrainInstructions,
} from "./brain";

/**
 * Tool schemas sent to Claude. Order here is cosmetic — Claude picks a
 * tool by name, not position. When adding a tool, also register its
 * handler in HANDLERS below.
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge_base",
    description:
      "Search the Dopl knowledge base for AI/automation setups matching a query. Returns ranked results with titles, summaries, and similarity scores.",
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
      "Get full details of a specific setup entry including README, agents.md, manifest, and tags. Use this when you need implementation details from a specific setup.",
    input_schema: {
      type: "object" as const,
      properties: {
        entry_id: { type: "string", description: "Entry UUID from search results" },
      },
      required: ["entry_id"],
    },
  },
  {
    name: "ingest_url",
    description:
      "Ingest a URL into the knowledge base. Use this when a user shares a link they want to add — a blog post, GitHub repo, tweet, etc. Starts background processing that extracts content and generates README, agents.md, and manifest.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to ingest" },
      },
      required: ["url"],
    },
  },
  // ── Cluster brain editing ────────────────────────────────────────
  // When the chat is inside a cluster, `cluster_slug` must match the
  // enclosing cluster's slug — enforced server-side. When the chat is
  // on the open canvas, the user can target any cluster they own.
  {
    name: "list_user_clusters",
    description:
      "List the clusters the user owns, with names, slugs, and panel counts. Use this when the user asks you to edit a cluster by name and you need to look up the slug. If the chat is already inside a cluster, you already know the target — no need to call this.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_cluster_brain_memories",
    description:
      "Fetch a cluster's current brain — instructions text and the list of memories with their IDs. Call this before updating or removing specific memories so you know their IDs, or before rewriting instructions so you can preserve useful context.",
    input_schema: {
      type: "object" as const,
      properties: {
        cluster_slug: { type: "string", description: "The cluster's slug." },
      },
      required: ["cluster_slug"],
    },
  },
  {
    name: "add_cluster_brain_memory",
    description:
      "Append a new memory to a cluster's brain. Use for preferences/corrections the user tells you to remember about this cluster's domain (e.g., 'prefer Resend over SendGrid', 'always ask before scraping'). Keep the memory short and imperative. Set scope='personal' when the memory is private to this user (their own setup, env, machine, alias) — those memories are visible only to them and never written to the shared canvas brain panel; default scope='workspace' shares with every member of the canvas.",
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

const HANDLERS: Record<string, ToolHandler> = {
  search_knowledge_base: executeSearchKnowledgeBase,
  get_entry_details: executeGetEntryDetails,
  ingest_url: executeIngestUrl,
  list_user_clusters: executeListUserClusters,
  list_cluster_brain_memories: executeListClusterBrainMemories,
  add_cluster_brain_memory: executeAddClusterBrainMemory,
  update_cluster_brain_memory: executeUpdateClusterBrainMemory,
  remove_cluster_brain_memory: executeRemoveClusterBrainMemory,
  rewrite_cluster_brain_instructions: executeRewriteClusterBrainInstructions,
};

/**
 * Dispatch a single tool call to its handler. Returns a ToolResult with
 * a text blob for Claude and an optional `entries` array the route
 * streams back to the UI as entry cards.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  userId?: string,
  canvasContext?: CanvasContextPayload,
  canvasId?: string
): Promise<ToolResult> {
  const handler = HANDLERS[name];
  if (!handler) return { result: `Unknown tool: ${name}` };
  return handler(input, userId, canvasContext, canvasId);
}
