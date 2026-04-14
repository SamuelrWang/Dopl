import { callClaude } from "@/lib/ai";
import { buildContentTypeClassifierPrompt } from "@/lib/prompts/content-type-classifier";
import { ContentType } from "../types";

export interface ContentTypeResult {
  content_type: ContentType;
  confidence: number;
  reasoning: string;
}

export async function classifyContentType(
  postText: string
): Promise<ContentTypeResult> {
  const prompt = buildContentTypeClassifierPrompt(postText);
  const response = await callClaude("", prompt, { maxTokens: 256 });

  const jsonStr = response
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(jsonStr) as ContentTypeResult;

    // Validate content_type
    if (!["setup", "knowledge", "resource"].includes(parsed.content_type)) {
      console.warn(
        `[content-type] Invalid type "${parsed.content_type}", defaulting to "setup"`
      );
      return { content_type: "setup", confidence: 0.5, reasoning: "Invalid classification — defaulting to setup" };
    }

    return parsed;
  } catch (error) {
    console.error("[content-type] Failed to parse classification:", error);
    // Default to setup (most thorough pipeline)
    return {
      content_type: "setup",
      confidence: 0.5,
      reasoning: "Classification parse failed — defaulting to setup",
    };
  }
}
