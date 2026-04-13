import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SIEClient } from "./api-client.js";
import type { ClusterRow } from "./types.js";

const CONTEXT_CHAR_BUDGET = 2000;
const MAX_PROMPT_ENTRIES = 10;

const SERVER_INSTRUCTIONS = `You are connected to the **Setup Intelligence Engine (SIE)** — a curated knowledge base of real-world AI and automation setups including agent workflows, n8n automations, Claude skills, API integrations, and more. Each setup includes full documentation (README), implementation instructions (agents.md), and structured metadata (manifest).

## What you can help the user with

- **Searching** — Find setups by natural language query (e.g. "cold email outreach", "n8n + Supabase automation")
- **Browsing** — List all setups, filter by complexity or use case
- **Deep dives** — Pull up the full README, agents.md, and manifest for any setup
- **Building** — Compose a new solution by combining patterns from multiple setups
- **Canvas management** — Add setups to the user's canvas workspace, organize them into clusters, or browse what's already there
- **Cluster exploration** — Browse curated groupings of setups, or search within a specific cluster

When the user asks about AI/automation setups, tools, or workflows, use the tools provided by this server to give them accurate, up-to-date answers from the knowledge base.`;

export function createServer(client: SIEClient): McpServer {
  const server = new McpServer(
    {
      name: "setup-intelligence-engine",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // ── search_setups ──────────────────────────────────────────────────
  server.tool(
    "search_setups",
    "Search the Setup Intelligence Engine knowledge base for AI/automation setups matching a query. Returns ranked results with summaries and an AI synthesis recommendation.",
    {
      query: z.string().describe("Natural language search query, e.g. 'AI agent for job applications' or 'n8n automation with Supabase'"),
      tags: z.array(z.string()).optional().describe("Filter by tags, e.g. ['claude', 'playwright']"),
      use_case: z.string().optional().describe("Filter by use case category"),
      max_results: z.number().optional().describe("Number of results to return (default 5)"),
      include_synthesis: z.boolean().optional().describe("Include AI synthesis/recommendation (default true)"),
    },
    async (params) => {
      const result = await client.searchSetups(params);

      const lines: string[] = [];

      if (result.synthesis) {
        lines.push("## Recommendation");
        lines.push(result.synthesis.recommendation);
        if (result.synthesis.composite_approach) {
          lines.push("\n## Suggested Approach");
          lines.push(result.synthesis.composite_approach);
        }
        lines.push("");
      }

      lines.push(`## Results (${result.entries.length} found)\n`);
      for (const entry of result.entries) {
        lines.push(`### ${entry.title || "Untitled"} (${Math.round(entry.similarity * 100)}% match)`);
        lines.push(`ID: ${entry.entry_id}`);
        if (entry.summary) lines.push(entry.summary);
        if (entry.relevance_explanation) lines.push(`Relevance: ${entry.relevance_explanation}`);
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── get_setup ──────────────────────────────────────────────────────
  server.tool(
    "get_setup",
    "Get full details of a specific setup from the knowledge base, including README, agents.md (AI setup instructions), and manifest.",
    {
      id: z.string().describe("Entry ID (UUID) from search results"),
    },
    async ({ id }) => {
      const entry = await client.getSetup(id);

      const lines: string[] = [];
      lines.push(`# ${entry.title || "Untitled"}`);
      if (entry.summary) lines.push(`\n${entry.summary}`);
      lines.push(`\nSource: ${entry.source_url}`);
      lines.push(`Platform: ${entry.source_platform || "unknown"}`);
      lines.push(`Complexity: ${entry.complexity || "unknown"}`);
      lines.push(`Use case: ${entry.use_case || "unknown"}`);

      if (entry.tags && entry.tags.length > 0) {
        lines.push(`\nTags: ${entry.tags.map((t) => `${t.tag_type}:${t.tag_value}`).join(", ")}`);
      }

      if (entry.readme) {
        lines.push("\n---\n## README\n");
        lines.push(entry.readme);
      }

      if (entry.agents_md) {
        lines.push("\n---\n## agents.md (AI Setup Instructions)\n");
        lines.push(entry.agents_md);
      }

      if (entry.manifest) {
        lines.push("\n---\n## Manifest\n");
        lines.push("```json");
        lines.push(JSON.stringify(entry.manifest, null, 2));
        lines.push("```");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── build_solution ─────────────────────────────────────────────────
  server.tool(
    "build_solution",
    "Compose a new AI/automation solution from the knowledge base. Describe what you want to build, and the system will find relevant setups and generate a composite README and agents.md.",
    {
      brief: z.string().describe("Description of what you want to build, e.g. 'An AI agent that monitors GitHub issues and auto-triages them'"),
      preferred_tools: z.array(z.string()).optional().describe("Tools you want to use, e.g. ['claude', 'n8n']"),
      excluded_tools: z.array(z.string()).optional().describe("Tools to avoid"),
      max_complexity: z.string().optional().describe("Maximum complexity: simple, moderate, complex, or advanced"),
    },
    async (params) => {
      const result = await client.buildSolution(params);

      const lines: string[] = [];
      lines.push("## Composite Solution\n");
      lines.push(`Confidence: ${Math.round(result.confidence.score * 100)}%`);

      if (result.confidence.gaps.length > 0) {
        lines.push(`\nGaps: ${result.confidence.gaps.join(", ")}`);
      }

      lines.push("\n### Source Setups Used:");
      for (const src of result.source_entries) {
        lines.push(`- **${src.title}** (${src.entry_id}): ${src.how_used}`);
      }

      lines.push("\n---\n### README\n");
      lines.push(result.composite_readme);

      lines.push("\n---\n### agents.md\n");
      lines.push(result.composite_agents_md);

      if (result.confidence.suggestions.length > 0) {
        lines.push("\n---\n### Suggestions for Improvement");
        for (const s of result.confidence.suggestions) {
          lines.push(`- ${s}`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── list_setups ────────────────────────────────────────────────────
  server.tool(
    "list_setups",
    "Browse all available setups in the knowledge base with optional filters.",
    {
      use_case: z.string().optional().describe("Filter by use case category"),
      complexity: z.string().optional().describe("Filter by complexity: simple, moderate, complex, advanced"),
      limit: z.number().optional().describe("Number of results (default 20)"),
      offset: z.number().optional().describe("Pagination offset"),
    },
    async (params) => {
      const result = await client.listSetups({
        ...params,
        limit: params.limit ?? 20,
      });

      const lines: string[] = [];
      lines.push(`## Setups (${result.total} total, showing ${result.entries.length})\n`);

      for (const entry of result.entries) {
        lines.push(`- **${entry.title || "Untitled"}** [${entry.complexity || "?"}] — ${entry.summary || "No summary"}`);
        lines.push(`  ID: ${entry.id} | Source: ${entry.source_url}`);
      }

      if (result.total > result.offset + result.entries.length) {
        lines.push(`\n_Use offset=${result.offset + result.entries.length} to see more._`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── list_clusters ──────────────────────────────────────────────────
  server.tool(
    "list_clusters",
    "List all clusters (curated groupings of setups) available in the knowledge base.",
    {},
    async () => {
      const { clusters } = await client.listClusters();
      const lines = clusters.map(
        (c) =>
          `- **${c.name}** (slug: \`${c.slug}\`) — ${c.panel_count ?? 0} entries`
      );
      return {
        content: [
          {
            type: "text" as const,
            text: lines.join("\n") || "No clusters found.",
          },
        ],
      };
    }
  );

  // ── get_cluster ────────────────────────────────────────────────────
  server.tool(
    "get_cluster",
    "Get details of a specific cluster including its member entries with summaries and READMEs.",
    {
      slug: z.string().describe("Cluster slug from list_clusters"),
    },
    async ({ slug }) => {
      const cluster = await client.getCluster(slug);

      const lines: string[] = [];
      lines.push(`# Cluster: ${cluster.name}`);
      lines.push(`Slug: \`${cluster.slug}\``);
      lines.push(`Entries: ${cluster.entries.length}\n`);

      for (const e of cluster.entries) {
        lines.push(`### ${e.title || "Untitled"} (${e.entry_id})`);
        if (e.summary) lines.push(e.summary);
        if (e.readme) {
          lines.push(`\nREADME:\n${e.readme.slice(0, CONTEXT_CHAR_BUDGET)}`);
        }
        if (e.agents_md) {
          lines.push(
            `\nagents.md:\n${e.agents_md.slice(0, CONTEXT_CHAR_BUDGET)}`
          );
        }
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── query_cluster ──────────────────────────────────────────────────
  server.tool(
    "query_cluster",
    "Semantic search scoped to a specific cluster's entries only.",
    {
      cluster_slug: z.string().describe("Cluster slug"),
      query: z.string().describe("Natural language search query"),
      max_results: z
        .number()
        .optional()
        .describe("Max results (default 5)"),
    },
    async ({ cluster_slug, query, max_results }) => {
      const result = await client.queryCluster(
        cluster_slug,
        query,
        max_results
      );

      const lines: string[] = [];
      lines.push(
        `## Cluster Search: "${query}" in ${result.cluster_slug} (${result.results.length} results)\n`
      );

      for (const r of result.results) {
        lines.push(
          `### ${r.title || "Untitled"} (${Math.round(r.similarity * 100)}% match)`
        );
        lines.push(`ID: ${r.entry_id}`);
        if (r.summary) lines.push(r.summary);
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── canvas_list_panels ──────────────────────────────────────────────
  server.tool(
    "canvas_list_panels",
    "List all knowledge base entries currently on your canvas workspace.",
    {},
    async () => {
      const panels = await client.listCanvasPanels();

      if (panels.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Your canvas is empty. Use `canvas_add_entry` to add entries, or `search_setups` to find them first." }],
        };
      }

      const lines: string[] = [];
      lines.push(`## Your Canvas (${panels.length} entries)\n`);

      for (const p of panels) {
        lines.push(`- **${p.title || "Untitled"}** (entry: ${p.entry_id})`);
        if (p.summary) lines.push(`  ${p.summary}`);
        if (p.source_url) lines.push(`  Source: ${p.source_url}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── canvas_add_entry ──────────────────────────────────────────────
  server.tool(
    "canvas_add_entry",
    "Add a knowledge base entry to your canvas. Use search_setups to find entries first.",
    {
      entry_id: z.string().describe("Entry ID (UUID) from search results or get_setup"),
    },
    async ({ entry_id }) => {
      const { panel, created } = await client.addCanvasPanel(entry_id);
      const verb = created ? "Added" : "Already on";
      return {
        content: [
          {
            type: "text" as const,
            text: `${verb} canvas: **${panel.title || "Untitled"}** (${panel.entry_id})`,
          },
        ],
      };
    }
  );

  // ── canvas_remove_entry ───────────────────────────────────────────
  server.tool(
    "canvas_remove_entry",
    "Remove an entry from your canvas. Does not delete it from the knowledge base.",
    {
      entry_id: z.string().describe("Entry ID to remove from canvas"),
    },
    async ({ entry_id }) => {
      await client.removeCanvasPanel(entry_id);
      return {
        content: [
          {
            type: "text" as const,
            text: `Removed entry ${entry_id} from your canvas.`,
          },
        ],
      };
    }
  );

  // ── canvas_create_cluster ─────────────────────────────────────────
  server.tool(
    "canvas_create_cluster",
    "Group canvas entries into a named cluster for organized access via query_cluster.",
    {
      name: z.string().describe("Cluster name, e.g. 'AI Agent Stack'"),
      entry_ids: z.array(z.string()).describe("Entry IDs to include (must be on your canvas)"),
    },
    async ({ name, entry_ids }) => {
      const result = await client.createCluster(name, entry_ids);

      return {
        content: [
          {
            type: "text" as const,
            text: `Created cluster **${result.name}** (slug: \`${result.slug}\`) with ${result.panel_count ?? entry_ids.length} entries.`,
          },
        ],
      };
    }
  );

  return server;
}

// ── Phase 3: Dynamic prompts ─────────────────────────────────────────

/**
 * Register one MCP prompt per cluster. Each prompt loads the cluster's
 * entries as context and seeds a scoping instruction so Claude uses
 * query_cluster instead of search_setups for the session.
 */
export async function registerClusterPrompts(
  server: McpServer,
  client: SIEClient
): Promise<string[]> {
  const { clusters } = await client.listClusters();
  const slugs: string[] = [];

  for (const cluster of clusters) {
    slugs.push(cluster.slug);
    server.prompt(
      cluster.slug,
      `Chat scoped to cluster: ${cluster.name}`,
      {},
      async () => {
        const detail = await client.getCluster(cluster.slug);
        const contextBlock = detail.entries
          .slice(0, MAX_PROMPT_ENTRIES)
          .map((e) => {
            const parts = [`### ${e.title || "Untitled"} (${e.entry_id})`];
            if (e.summary) parts.push(e.summary);
            if (e.readme) {
              parts.push(
                `README:\n${e.readme.slice(0, CONTEXT_CHAR_BUDGET)}`
              );
            }
            if (e.agents_md) {
              parts.push(
                `agents.md:\n${e.agents_md.slice(0, CONTEXT_CHAR_BUDGET)}`
              );
            }
            return parts.join("\n");
          })
          .join("\n\n---\n\n");

        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Load cluster "${detail.name}" as the active scope.\n\n${contextBlock}`,
              },
            },
            {
              role: "assistant" as const,
              content: {
                type: "text" as const,
                text: `Cluster "${detail.name}" (slug: \`${detail.slug}\`) is now my active scope with ${detail.entries.length} entries loaded. For any retrieval in this session, I will call \`query_cluster\` with \`cluster_slug="${detail.slug}"\` instead of \`search_setups\`. I won't search the broader knowledge base unless you explicitly ask.`,
              },
            },
          ],
        };
      }
    );
  }

  return slugs;
}

// ── Phase 4: Polling sync ────────────────────────────────────────────

/**
 * Poll for cluster changes and re-register prompts when the set changes.
 * Emits `notifications/prompts/list_changed` so Claude Code refreshes
 * its slash-command palette.
 */
export function startPromptSync(
  server: McpServer,
  client: SIEClient,
  intervalMs = 30_000
): NodeJS.Timeout {
  let knownSlugs: Set<string> = new Set();

  async function sync() {
    try {
      const { clusters } = await client.listClusters();
      const currentSlugs = new Set(clusters.map((c: ClusterRow) => c.slug));

      // Check if the set changed
      const changed =
        currentSlugs.size !== knownSlugs.size ||
        [...currentSlugs].some((s) => !knownSlugs.has(s));

      if (changed) {
        // Re-register all cluster prompts
        const newSlugs = await registerClusterPrompts(server, client);
        knownSlugs = new Set(newSlugs);

        // Notify connected clients
        try {
          await server.server.notification({
            method: "notifications/prompts/list_changed",
          });
        } catch {
          // Notification may fail if no client is connected yet
        }
      }
    } catch {
      // Swallow errors — polling is best-effort
    }
  }

  // Initial sync
  sync();

  return setInterval(sync, intervalMs);
}
