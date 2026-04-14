import { callClaude } from "@/lib/ai";
import { buildQuerySynthesisPrompt } from "@/lib/prompts/query-synthesis";
import { SearchResult } from "./search";

export interface SynthesisResult {
  entries: {
    entry_id: string;
    relevance_score: number;
    explanation: string;
  }[];
  recommendation: string;
  composite_approach?: string;
  gaps: string[];
  suggested_searches: string[];
}

export async function synthesizeResults(
  query: string,
  results: SearchResult[]
): Promise<SynthesisResult> {
  const entriesStr = results
    .map((r) => {
      const manifest = r.manifest as Record<string, unknown> | null;
      const parts = [
        `Entry ID: ${r.entry_id}`,
        `Title: ${r.title}`,
        `Summary: ${r.summary}`,
        `Similarity: ${r.similarity}`,
      ];

      // Include structured metadata from manifest for better relevance judgment
      if (manifest) {
        const tools = manifest.tools as Array<{ name: string; role: string }> | undefined;
        if (tools?.length) {
          parts.push(`Tools: ${tools.map((t) => `${t.name} (${t.role})`).join(", ")}`);
        }
        const integrations = manifest.integrations as Array<{ from: string; to: string; description: string }> | undefined;
        if (integrations?.length) {
          parts.push(`Integrations: ${integrations.map((i) => `${i.from} → ${i.to}: ${i.description}`).join("; ")}`);
        }
        const patterns = manifest.patterns as string[] | undefined;
        if (patterns?.length) {
          parts.push(`Patterns: ${patterns.join(", ")}`);
        }
        const useCase = manifest.use_case as { primary?: string; secondary?: string[] } | undefined;
        if (useCase) {
          parts.push(`Use case: ${useCase.primary}${useCase.secondary?.length ? ` (also: ${useCase.secondary.join(", ")})` : ""}`);
        }
      }

      parts.push(`README:\n${r.readme?.slice(0, 4000) || "N/A"}`);

      return parts.join("\n");
    })
    .join("\n\n---\n\n");

  const prompt = buildQuerySynthesisPrompt(query, entriesStr);
  const response = await callClaude("", prompt, { maxTokens: 4096 });

  // Parse response
  const jsonStr = response
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    return JSON.parse(jsonStr) as SynthesisResult;
  } catch {
    return {
      entries: results.map((r) => ({
        entry_id: r.entry_id,
        relevance_score: Math.round(r.similarity * 10),
        explanation: `Matched with ${(r.similarity * 100).toFixed(1)}% similarity`,
      })),
      recommendation: "Unable to synthesize — showing raw results by similarity.",
      gaps: [],
      suggested_searches: [],
    };
  }
}
