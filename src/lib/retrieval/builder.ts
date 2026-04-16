import { callClaude } from "@/lib/ai";
import { buildBuilderPrompt } from "@/lib/prompts/builder";
import { searchEntries, SearchResult } from "./search";
import { BuildResponse } from "@/types/api";

export async function buildComposite(
  brief: string,
  constraints?: {
    preferred_tools?: string[];
    excluded_tools?: string[];
    max_complexity?: string;
    budget_context?: string;
  }
): Promise<BuildResponse> {
  // 1. Search for relevant entries
  const results = await searchEntries(brief, {
    maxResults: 10,
    threshold: 0.5, // Lower threshold for builder to get more diverse results
  });

  if (results.length === 0) {
    return {
      composite_readme: "# No Matching Entries\n\nNo entries in the knowledge base match this brief.",
      composite_agents_md: "# No Implementation Available\n\nThe knowledge base does not have enough relevant entries to generate a composite solution.",
      source_entries: [],
      confidence: {
        score: 0,
        gaps: ["No relevant entries found in the knowledge base"],
        suggestions: ["Add entries related to: " + brief.slice(0, 100)],
      },
    };
  }

  // 2. Build entries context
  const entriesStr = results
    .map(
      (r) =>
        `Entry ID: ${r.entry_id}\nTitle: ${r.title}\nREADME:\n${r.readme || "N/A"}\nagents.md:\n${r.agents_md || "N/A"}\nManifest:\n${JSON.stringify(r.manifest, null, 2)}`
    )
    .join("\n\n===\n\n");

  const constraintsStr = constraints
    ? JSON.stringify(constraints, null, 2)
    : "None specified";

  // 3. Call Claude to compose solution
  const prompt = buildBuilderPrompt(brief, constraintsStr, entriesStr);
  const response = await callClaude("", prompt, { maxTokens: 16384 });

  // 4. Parse response
  const jsonStr = response
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  // Build a lookup from entry_id → slug so we can hydrate Claude's output
  // (which only echoes entry_ids) with public slugs for hyperlinking.
  const slugByEntryId = new Map<string, string | null>();
  for (const r of results) slugByEntryId.set(r.entry_id, r.slug);

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      composite_readme: parsed.composite_readme || "",
      composite_agents_md: parsed.composite_agents_md || "",
      source_entries: (parsed.source_attribution || []).map(
        (a: { entry_id: string; title: string; how_used: string }) => ({
          entry_id: a.entry_id,
          slug: slugByEntryId.get(a.entry_id) ?? null,
          title: a.title,
          how_used: a.how_used,
        })
      ),
      confidence: parsed.confidence || { score: 0.5, gaps: [], suggestions: [] },
    };
  } catch {
    // If JSON parsing fails, try to extract sections from the response
    return {
      composite_readme: extractSection(response, "composite_readme") || response,
      composite_agents_md: extractSection(response, "composite_agents_md") || "",
      source_entries: results.map((r) => ({
        entry_id: r.entry_id,
        slug: r.slug,
        title: r.title || "Unknown",
        how_used: "Referenced in composite solution",
      })),
      confidence: {
        score: 0.5,
        gaps: ["Response parsing failed — manual review recommended"],
        suggestions: [],
      },
    };
  }
}

function extractSection(text: string, sectionName: string): string | null {
  const regex = new RegExp(
    `<${sectionName}>\\s*([\\s\\S]*?)\\s*</${sectionName}>`,
    "i"
  );
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}
