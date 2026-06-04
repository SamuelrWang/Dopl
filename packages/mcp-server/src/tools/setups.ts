/**
 * `dopl_setups` — browse + fetch knowledge-base entries.
 *
 * Consolidates the old `dopl_setups(op='list')` + `dopl_setups(op='get')` tools. The semantic
 * front-door tools `search_setups` and `build_solution` stay standalone
 * in server.ts (high-traffic, must stay obvious to the model).
 *
 * This module is the canonical pattern for every consolidated domain tool:
 * a single `register(...)` with an `op` enum + a flat schema of all per-op
 * params (optional), a handler that switches on `op`, validates required
 * params for that op via `missingParams`, then calls the existing
 * `client.*` method. Op bodies are lifted verbatim from the old handlers.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { ok, missingParams, type RegisterTool, type ToolResponse } from "./respond";

const DESCRIPTION = `Browse and fetch Dopl knowledge-base entries. Set \`op\` to one of:
- "list" — paginated browse of all entries (optional use_case / complexity filters). Open-ended exploration only; for keyword/task-shaped retrieval use the \`search_setups\` tool instead (semantic ranking beats a flat list).
- "get" — full implementation details (README, agents.md, manifest, tags) for one entry by slug/UUID. Also the right call to poll an entry's status after ingest.`;

export function registerSetupsTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_setups",
    DESCRIPTION,
    {
      op: z.enum(["list", "get"]).describe("Operation to perform."),
      entry: z
        .string()
        .optional()
        .describe("op=get: entry slug or UUID (from search_setups or a prior response)."),
      use_case: z
        .string()
        .optional()
        .describe("op=list: filter by use case category."),
      complexity: z
        .string()
        .optional()
        .describe("op=list: filter by complexity (simple|moderate|complex|advanced)."),
      limit: z.number().optional().describe("op=list: page size (default 20)."),
      offset: z.number().optional().describe("op=list: pagination offset."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list":
          return opList(client, args);
        case "get": {
          const miss = missingParams("get", args, ["entry"]);
          if (miss) return miss;
          return opGet(client, args.entry as string);
        }
      }
    },
  );
}

async function opList(
  client: DoplClient,
  params: { use_case?: string; complexity?: string; limit?: number; offset?: number },
): Promise<ToolResponse> {
  const result = await client.listSetups({
    use_case: params.use_case,
    complexity: params.complexity,
    offset: params.offset,
    limit: params.limit ?? 20,
  });

  const lines: string[] = [];
  lines.push(`## Setups (${result.total} total, showing ${result.entries.length})\n`);

  for (const entry of result.entries) {
    const title = entry.title || "Untitled";
    const url = client.entryUrl(entry.slug);
    const label = url ? `[${title}](${url})` : title;
    lines.push(`- **${label}** [${entry.complexity || "?"}] — ${entry.summary || "No summary"}`);
    lines.push(`  Source: ${entry.source_url}`);
  }

  if (result.total > result.offset + result.entries.length) {
    lines.push(`\n_Use offset=${result.offset + result.entries.length} to see more._`);
  }

  return ok(lines.join("\n"));
}

async function opGet(client: DoplClient, entryRef: string): Promise<ToolResponse> {
  const entry = await client.getSetup(entryRef);

  const lines: string[] = [];
  const title = entry.title || "Untitled";
  const url = client.entryUrl(entry.slug);
  lines.push(`# ${url ? `[${title}](${url})` : title}`);
  if (entry.summary) lines.push(`\n${entry.summary}`);
  lines.push(`\nStatus: ${entry.status}`);
  lines.push(`Source: ${entry.source_url}`);
  lines.push(`Platform: ${entry.source_platform || "unknown"}`);
  lines.push(`Complexity: ${entry.complexity || "unknown"}`);
  lines.push(`Use case: ${entry.use_case || "unknown"}`);

  if (entry.tags && entry.tags.length > 0) {
    lines.push(`\nTags: ${entry.tags.map((t) => `${t.tag_type}:${t.tag_value}`).join(", ")}`);
  }

  if (entry.ingestion_tier === "skeleton" && entry.descriptor) {
    lines.push("\n---\n## Descriptor (skeleton tier)\n");
    lines.push(entry.descriptor);
    lines.push(
      "\n*This is a skeleton entry. Read the source repo directly for implementation details.*",
    );
  } else {
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
  }

  return ok(lines.join("\n"));
}
