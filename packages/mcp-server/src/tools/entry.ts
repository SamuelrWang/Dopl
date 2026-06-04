/**
 * `dopl_entry` — edit + freshness-check knowledge-base entries.
 *
 * Consolidates the old `dopl_entry(op='update')`, `dopl_entry(op='check_updates')`, and
 * `dopl_entry(op='check_cluster_updates')` tools. Follows the canonical pattern in
 * `setups.ts`: a single `register(...)` with an `op` enum + a flat schema
 * of all per-op params (optional), a handler that switches on `op`,
 * validates required params via `missingParams`, then calls the existing
 * `client.*` method. Op bodies are lifted verbatim.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { ok, missingParams, type RegisterTool, type ToolResponse } from "./respond";

const DESCRIPTION = `Edit and freshness-check Dopl knowledge-base entries. Set \`op\` to one of:
- "update" — Update an entry's editable metadata fields: title, summary, use_case, complexity. Use when the user wants to correct an entry's categorization or description. Does NOT edit README, agents.md, or the source URL — those are regenerated only via re-ingestion. Scoped to the entry's owner and admin callers.
- "check_updates" — Check whether ONE GitHub-sourced entry has new commits since it was ingested. Use when the user asks 'is this still current?' about a specific entry. Non-GitHub entries are skipped (returns a no-op status). For checking every entry in a cluster at once, use op="check_cluster_updates" — much faster than looping.
- "check_cluster_updates" — Bulk-check every GitHub-sourced entry in a cluster for upstream changes. Use this when the user asks 'has anything in my cluster changed?' or 'is my stack still current?'. For a single entry, use op="check_updates". Non-GitHub entries are skipped.`;

export function registerEntryTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_entry",
    DESCRIPTION,
    {
      op: z
        .enum(["update", "check_updates", "check_cluster_updates"])
        .describe("Operation to perform."),
      entry: z
        .string()
        .optional()
        .describe("op=update|check_updates: entry slug or UUID."),
      title: z.string().optional().describe("op=update: new title."),
      summary: z.string().optional().describe("op=update: new summary."),
      use_case: z.string().optional().describe("op=update: new use case category."),
      complexity: z
        .enum(["simple", "moderate", "complex", "advanced"])
        .optional()
        .describe("op=update: new complexity level."),
      slug: z
        .string()
        .optional()
        .describe("op=check_cluster_updates: cluster slug from list_clusters."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "update": {
          const miss = missingParams("update", args, ["entry"]);
          if (miss) return miss;
          return opUpdate(client, args);
        }
        case "check_updates": {
          const miss = missingParams("check_updates", args, ["entry"]);
          if (miss) return miss;
          return opCheckUpdates(client, args.entry as string);
        }
        case "check_cluster_updates": {
          const miss = missingParams("check_cluster_updates", args, ["slug"]);
          if (miss) return miss;
          return opCheckClusterUpdates(client, args.slug as string);
        }
      }
    },
  );
}

async function opUpdate(
  client: DoplClient,
  params: {
    entry?: string;
    title?: string;
    summary?: string;
    use_case?: string;
    complexity?: string;
  },
): Promise<ToolResponse> {
  const { entry, title, summary, use_case, complexity } = params;
  const updates: { title?: string; summary?: string; use_case?: string; complexity?: string } = {};
  if (title) updates.title = title;
  if (summary) updates.summary = summary;
  if (use_case) updates.use_case = use_case;
  if (complexity) updates.complexity = complexity;

  const updated = await client.updateEntry(entry as string, updates);
  const t = updated.title || "Untitled";
  const url = client.entryUrl(updated.slug);
  const label = url ? `[${t}](${url})` : t;
  return ok(`Updated entry **${label}**.`);
}

async function opCheckUpdates(client: DoplClient, entry: string): Promise<ToolResponse> {
  const result = await client.checkEntryUpdates(entry);

  // The check-updates endpoint echoes back entry_id (UUID). We fetch the
  // entry metadata so we can render a proper hyperlink via slug.
  let url: string | null = null;
  try {
    const e = await client.getSetup(result.entry_id);
    url = client.entryUrl(e.slug);
  } catch {
    // Non-fatal; fall back to plain title.
  }
  const title = result.title || "Untitled";
  const label = url ? `[${title}](${url})` : title;

  if (result.has_updates === null) {
    return ok(`**${label}**: ${result.reason || "Update checking not available."}`);
  }

  if (result.has_updates) {
    return ok(
      `**${label}** (${result.repo}): Updates available.\nRepo last pushed ${result.days_since_push} day(s) ago. You ingested it ${result.days_since_ingestion} day(s) ago.\nConsider re-ingesting with \`dopl_ingest(op='url')\`.`,
    );
  }

  return ok(
    `**${label}** (${result.repo}): No updates since ingestion (${result.days_since_ingestion} day(s) ago).`,
  );
}

async function opCheckClusterUpdates(client: DoplClient, slug: string): Promise<ToolResponse> {
  const detail = await client.getCluster(slug);

  const updated: string[] = [];
  const current: string[] = [];
  const skipped: string[] = [];

  for (const entry of detail.entries) {
    const url = client.entryUrl(entry.slug);
    const mkLabel = (title: string | null) => {
      const t = title || entry.title || "Untitled";
      return url ? `[${t}](${url})` : t;
    };
    try {
      const result = await client.checkEntryUpdates(entry.entry_id);
      if (result.has_updates === true) {
        updated.push(`- **${mkLabel(result.title)}** (${result.repo}) — updated ${result.days_since_push}d ago, ingested ${result.days_since_ingestion}d ago`);
      } else if (result.has_updates === false) {
        current.push(`- ${mkLabel(result.title)}`);
      } else {
        skipped.push(`- ${mkLabel(result.title)} — ${result.reason || "not GitHub"}`);
      }
    } catch {
      skipped.push(`- ${mkLabel(null)} — check failed`);
    }
  }

  const lines: string[] = [];
  lines.push(`## Cluster: ${detail.name} — Update Check\n`);

  if (updated.length > 0) {
    lines.push(`### Updates available (${updated.length})\n`);
    lines.push(...updated);
    lines.push("");
  }
  if (current.length > 0) {
    lines.push(`### Up to date (${current.length})\n`);
    lines.push(...current);
    lines.push("");
  }
  if (skipped.length > 0) {
    lines.push(`### Skipped (${skipped.length})\n`);
    lines.push(...skipped);
  }

  return ok(lines.join("\n"));
}
