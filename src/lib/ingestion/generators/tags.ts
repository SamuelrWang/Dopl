import { callClaude, ModelTier } from "@/lib/ai";
import { buildTagsPrompt } from "@/lib/prompts/tags";

interface GeneratedTag {
  tag_type: string;
  tag_value: string;
}

export async function generateTags(
  manifest: Record<string, unknown>,
  model?: ModelTier
): Promise<GeneratedTag[]> {
  const prompt = buildTagsPrompt(JSON.stringify(manifest, null, 2));
  const response = await callClaude("", prompt, { maxTokens: 2048, model });

  // Extract JSON array from response
  const jsonStr = response
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    const tags = JSON.parse(jsonStr) as GeneratedTag[];
    // Validate tag types
    const validTypes = [
      "tool",
      "platform",
      "language",
      "framework",
      "use_case",
      "pattern",
      "integration",
      "custom",
    ];
    return tags.filter(
      (t) =>
        validTypes.includes(t.tag_type) &&
        typeof t.tag_value === "string" &&
        t.tag_value.length > 0
    );
  } catch (error) {
    console.error("Failed to parse tags JSON:", error);
    return [];
  }
}
