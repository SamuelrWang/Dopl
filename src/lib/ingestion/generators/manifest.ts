import { callClaude, ModelTier } from "@/lib/ai";
import { buildManifestPrompt } from "@/lib/prompts/manifest";

export async function generateManifest(
  allRawContent: string,
  contentType: string = "setup",
  sourceType: string = "other",
  model?: ModelTier
): Promise<Record<string, unknown>> {
  const prompt = buildManifestPrompt(allRawContent, contentType, sourceType);
  const response = await callClaude("", prompt, { maxTokens: 4096, model });

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
      content_type: contentType,
      source_type: sourceType,
      title: "Parse Error - Manual Review Required",
      description: "Failed to auto-generate manifest. Raw content available.",
      use_case: { primary: "other", secondary: [] },
      complexity: "moderate",
      tags: [],
    };
  }
}
