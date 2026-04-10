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
    .map(
      (r) =>
        `Entry ID: ${r.entry_id}\nTitle: ${r.title}\nSummary: ${r.summary}\nSimilarity: ${r.similarity}\nREADME:\n${r.readme?.slice(0, 2000) || "N/A"}\nManifest:\n${JSON.stringify(r.manifest, null, 2)}`
    )
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
