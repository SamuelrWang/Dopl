import { callClaude, ModelTier } from "@/lib/ai";
import { buildContentClassifierPrompt } from "@/lib/prompts/content-classifier";

export interface ContentClassification {
  sections: {
    title: string;
    classification: "EXECUTABLE" | "TACTICAL" | "CONTEXT" | "SKIP";
    reason: string;
    content_preview: string;
  }[];
  stats: {
    executable_count: number;
    tactical_count: number;
    context_count: number;
    skip_count: number;
    executable_percentage: string;
  };
  preservation_notes: string[];
}

export async function classifyContent(
  allRawContent: string,
  model?: ModelTier
): Promise<ContentClassification> {
  const prompt = buildContentClassifierPrompt(allRawContent);
  const response = await callClaude("", prompt, { maxTokens: 4096, model });

  const jsonStr = response
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    return JSON.parse(jsonStr) as ContentClassification;
  } catch (error) {
    console.error("Failed to parse content classification:", error);
    // Default: treat everything as executable (safe fallback)
    return {
      sections: [],
      stats: {
        executable_count: 0,
        tactical_count: 0,
        context_count: 0,
        skip_count: 0,
        executable_percentage: "unknown",
      },
      preservation_notes: [
        "Classification failed — generators should default to preserving all content verbatim",
      ],
    };
  }
}
