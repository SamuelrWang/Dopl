import { callClaude } from "@/lib/ai";
import { ExtractedSource } from "../types";

const TEXT_ANALYSIS_PROMPT = `Analyze this post about an AI/automation setup. Extract:
1. All tools, platforms, and services mentioned
2. The core use case or problem being solved
3. Any technical architecture described
4. Any configuration details or code snippets
5. Any links or references to external resources

Post content:`;

export async function extractText(text: string): Promise<ExtractedSource[]> {
  const analysis = await callClaude(TEXT_ANALYSIS_PROMPT, text);

  return [
    {
      sourceType: "tweet_text",
      rawContent: text,
      extractedContent: analysis,
      depth: 0,
      childLinks: extractUrls(text),
    },
  ];
}

function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex) || [];
  return matches.map((url) => url.replace(/[.,;:!?]$/, "")); // Clean trailing punctuation
}
