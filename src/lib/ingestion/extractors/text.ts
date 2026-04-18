import { ExtractedSource } from "../types";
import { normalizeUrl } from "../url";

/**
 * Extract structured content from post text without an AI call.
 * Pulls out URLs and code blocks via regex. Semantic analysis
 * (tool detection, architecture) happens downstream in generateManifest.
 *
 * Returns an empty array when the input is effectively empty so we
 * don't create a useless `post_text` row alongside the platform source
 * for MCP ingests where `content.text` is empty. Direct URL ingests
 * (agent paste) used to produce a spurious depth-0 post_text row that
 * contributed nothing but showed up in the downstream gathered_content.
 */
const MIN_MEANINGFUL_TEXT_CHARS = 40;

export async function extractText(text: string): Promise<ExtractedSource[]> {
  const trimmed = text.trim();
  if (trimmed.length < MIN_MEANINGFUL_TEXT_CHARS) {
    return [];
  }

  const codeBlocks = extractCodeBlocks(trimmed);
  const extracted = codeBlocks.length > 0
    ? `${trimmed}\n\n--- Extracted Code Blocks ---\n\n${codeBlocks.join("\n\n")}`
    : trimmed;

  return [
    {
      sourceType: "post_text",
      rawContent: trimmed,
      extractedContent: extracted,
      depth: 0,
      childLinks: extractUrls(trimmed),
    },
  ];
}

/**
 * Pull URLs out of body text.
 *
 * Previously used a permissive regex that grabbed everything up to
 * whitespace. That produced gems like `hyperframes"><img` when the
 * body was HTML-flavored markdown — the URL bled into attribute
 * markers. Excluding quotes and angle brackets from the URL body
 * stops the bleed without dropping legitimate URL characters.
 *
 * Also normalizes each URL via the shared normalizer so downstream
 * dedup (visitedUrls Set, storeSources) treats a/?utm=... and a the
 * same on first contact.
 */
function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s"'<>`()]+)/g;
  const matches = text.match(urlRegex) || [];
  const cleaned = matches
    // Strip trailing sentence punctuation that commonly abuts a URL
    // in prose but isn't part of it.
    .map((url) => url.replace(/[.,;:!?)]+$/, ""))
    .map((url) => normalizeUrl(url));
  return [...new Set(cleaned)];
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
