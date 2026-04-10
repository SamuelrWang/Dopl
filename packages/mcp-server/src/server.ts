import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SIEClient } from "./api-client.js";

export function createServer(client: SIEClient): McpServer {
  const server = new McpServer({
    name: "setup-intelligence-engine",
    version: "0.1.0",
  });

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

  return server;
}
