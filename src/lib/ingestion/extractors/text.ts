import { ExtractedSource } from "../types";

/**
 * Extract structured content from post text without an AI call.
 * Pulls out URLs and code blocks via regex. Semantic analysis
 * (tool detection, architecture) happens downstream in generateManifest.
 */
export async function extractText(text: string): Promise<ExtractedSource[]> {
  const codeBlocks = extractCodeBlocks(text);
  const extracted = codeBlocks.length > 0
    ? `${text}\n\n--- Extracted Code Blocks ---\n\n${codeBlocks.join("\n\n")}`
    : text;

  return [
    {
      sourceType: "tweet_text",
      rawContent: text,
      extractedContent: extracted,
      depth: 0,
      childLinks: extractUrls(text),
    },
  ];
}

function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex) || [];
  return matches.map((url) => url.replace(/[.,;:!?]$/, ""));
}

/**
 * Extract fenced code blocks (```...```) and indented code blocks
 * (4+ space indent) from markdown/post text.
 */
function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];

  // Fenced code blocks: ```lang\n...\n```
  const fencedRegex = /```[\w-]*\n([\s\S]*?)```/g;
  let match;
  while ((match = fencedRegex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code.length > 0) blocks.push(code);
  }

  // Indented code blocks: lines starting with 4+ spaces or a tab,
  // only if not inside a fenced block (already captured above).
  // Group consecutive indented lines.
  if (blocks.length === 0) {
    const lines = text.split("\n");
    let current: string[] = [];
    for (const line of lines) {
      if (/^( {4,}|\t)/.test(line)) {
        current.push(line);
      } else {
        if (current.length >= 2) {
          blocks.push(current.join("\n").trim());
        }
        current = [];
      }
    }
    if (current.length >= 2) {
      blocks.push(current.join("\n").trim());
    }
  }

  return blocks;
}
