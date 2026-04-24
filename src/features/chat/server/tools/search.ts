import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { searchEntries } from "@/features/entries/server/retrieval/search";
import type { ToolResult } from "./types";

const supabase = supabaseAdmin();

/**
 * Tool: search_knowledge_base — vector search over approved entries.
 * Returns a formatted text blob for Claude plus a structured entries
 * array for UI cards.
 */
export async function executeSearchKnowledgeBase(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const query = input.query as string;
  const maxResults = (input.max_results as number) || 5;

  const results = await searchEntries(query, {
    maxResults,
    threshold: 0.5,
  });

  const entries = results.map((r) => ({
    entry_id: r.entry_id,
    title: r.title,
    summary: r.summary,
    use_case: r.use_case,
    complexity: r.complexity,
    similarity: r.similarity,
    source_url: r.source_platform,
  }));

  // Format for Claude's internal consumption — rich context for synthesis.
  // Claude will use [cite:ENTRY_ID] markers when referencing specific entries.
  const resultText = results.length === 0
    ? "No relevant implementations found in the knowledge base."
    : results
        .map(
          (r, i) => {
            const parts = [
              `--- Source ${i + 1} (ref: ${r.entry_id}) ---`,
              `Tools: ${r.manifest ? JSON.stringify((r.manifest as Record<string, unknown>).tools || []) : "unknown"}`,
              `Use case: ${r.use_case || "unknown"} | Complexity: ${r.complexity || "unknown"}`,
            ];
            if (r.summary) parts.push(`Overview: ${r.summary}`);
            if (r.readme) parts.push(`Implementation details:\n${r.readme.slice(0, 3000)}`);
            return parts.join("\n");
          }
        )
        .join("\n\n");

  return { result: resultText, entries };
}

/**
 * Tool: get_entry_details — fetch one entry's full content for synthesis.
 */
export async function executeGetEntryDetails(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const entryId = input.entry_id as string;

  const { data: entry, error } = await supabase
    .from("entries")
    .select("*")
    .eq("id", entryId)
    .single();

  if (error || !entry) {
    return { result: `Entry ${entryId} not found.` };
  }

  const { data: tags } = await supabase
    .from("tags")
    .select("tag_type, tag_value")
    .eq("entry_id", entryId);

  // Format for Claude's internal synthesis — rich detail, no user-facing metadata.
  const parts = [
    `--- Detailed source (ref: ${entryId}) ---`,
    `Complexity: ${entry.complexity || "unknown"}`,
    `Use case: ${entry.use_case || "unknown"}`,
  ];

  if (tags && tags.length > 0) {
    parts.push(
      `Tags: ${tags.map((t: { tag_type: string; tag_value: string }) => t.tag_value).join(", ")}`
    );
  }

  if (entry.readme) {
    parts.push(`\n--- Implementation Guide ---\n${entry.readme}`);
  }
  if (entry.agents_md) {
    parts.push(`\n--- Setup Instructions ---\n${entry.agents_md}`);
  }
  if (entry.manifest) {
    parts.push(
      `\n--- Structured Metadata ---\n${JSON.stringify(entry.manifest, null, 2)}`
    );
  }

  return {
    result: parts.join("\n"),
    entries: [
      {
        entry_id: entry.id,
        title: entry.title,
        summary: entry.summary,
        source_url: entry.source_url,
        complexity: entry.complexity,
      },
    ],
  };
}
