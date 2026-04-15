import { callClaude, ModelTier } from "@/lib/ai";
import { buildContentTypeClassifierPrompt } from "@/lib/prompts/content-type-classifier";
import { ContentType } from "../types";

const VALID_CONTENT_TYPES: ContentType[] = ["setup", "knowledge", "resource", "article", "tutorial", "reference"];

export interface ContentTypeResult {
  content_type: ContentType;
  source_type: string;
  confidence: number;
  reasoning: string;
}

export async function classifyContentType(
  postText: string,
  model?: ModelTier
): Promise<ContentTypeResult> {
  const prompt = buildContentTypeClassifierPrompt(postText);
  const response = await callClaude("", prompt, { maxTokens: 256, model });

  const jsonStr = response
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(jsonStr) as ContentTypeResult;

    // Validate content_type
    if (!VALID_CONTENT_TYPES.includes(parsed.content_type)) {
      console.warn(
        `[content-type] Invalid type "${parsed.content_type}", defaulting to "knowledge"`
      );
      return { content_type: "knowledge", source_type: parsed.source_type || "other", confidence: 0.5, reasoning: "Invalid classification — defaulting to knowledge" };
    }

    return {
      ...parsed,
      source_type: parsed.source_type || "other",
    };
  } catch (error) {
    console.error("[content-type] Failed to parse classification:", error);
    return {
      content_type: "knowledge",
      source_type: "other",
      confidence: 0.5,
      reasoning: "Classification parse failed — defaulting to knowledge",
    };
  }
}
