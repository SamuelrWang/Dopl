import { claude } from "@/lib/ai";
import { ExtractedSource } from "../types";
import { IMAGE_ANALYSIS_PROMPT } from "@/lib/prompts/image-vision";

type ImageType =
  | "code_screenshot"
  | "architecture_diagram"
  | "image"
  | "other";

export async function extractImage(
  base64Image: string,
  mimeType: string = "image/png"
): Promise<ExtractedSource> {
  const response = await claude.messages.create({
    // Use Haiku for image analysis — cheaper (~5x) and fast enough
    // for code screenshot extraction and basic classification.
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: base64Image,
            },
          },
          {
            type: "text",
            text: IMAGE_ANALYSIS_PROMPT,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const extractedContent = textBlock?.text || "";

  // Determine image type from analysis
  const imageType = classifyImageType(extractedContent);

  return {
    sourceType: imageType,
    rawContent: `[base64 image: ${mimeType}]`,
    extractedContent,
    contentMetadata: { mimeType, imageType },
    depth: 0,
  };
}

function classifyImageType(analysis: string): ImageType {
  const lowerAnalysis = analysis.toLowerCase();
  if (
    lowerAnalysis.includes("code screenshot") ||
    lowerAnalysis.includes("code snippet")
  ) {
    return "code_screenshot";
  }
  if (
    lowerAnalysis.includes("architecture") ||
    lowerAnalysis.includes("diagram")
  ) {
    return "architecture_diagram";
  }
  return "image";
}
