import { callClaude } from "@/lib/ai";
import { buildManifestPrompt } from "@/lib/prompts/manifest";

export async function generateManifest(
  allRawContent: string
): Promise<Record<string, unknown>> {
  const prompt = buildManifestPrompt(allRawContent);
  const response = await callClaude("", prompt, { maxTokens: 4096 });

  // Extract JSON from response (handle cases where LLM wraps in markdown code block)
  const jsonStr = response
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Failed to parse manifest JSON:", error);
    console.error("Raw response:", response);
    // Return a minimal manifest on parse failure
    return {
      version: "1.0",
      title: "Parse Error - Manual Review Required",
      description: "Failed to auto-generate manifest. Raw content available.",
      use_case: { primary: "other", secondary: [] },
      complexity: "moderate",
      tools: [],
      integrations: [],
      languages: [],
      frameworks: [],
      patterns: [],
      estimated_setup_time: "unknown",
      tags: [],
    };
  }
}
