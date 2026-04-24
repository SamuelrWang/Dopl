import "server-only";
import { callClaude } from "@/lib/ai";
import {
  parseSkeletonStructuredOutput,
  type SkeletonStructuredOutput,
} from "@/lib/prompts/skeleton-descriptor";

/**
 * Run the LLM call and parse the structured output. Retries the call once
 * if the first response isn't parseable — Claude occasionally wraps JSON
 * in fences or adds a preamble despite the prompt forbidding it, and a
 * single retry catches almost all of those cases.
 */
export async function generateStructuredDescriptor(
  prompt: string
): Promise<SkeletonStructuredOutput | null> {
  const system =
    "You produce structured JSON descriptors of GitHub repositories. Output a single JSON object. No prose, no markdown fences. The first character of your reply must be `{`.";

  const first = await callClaude(system, prompt, { model: "sonnet", maxTokens: 2500 });
  const parsed = parseSkeletonStructuredOutput(first);
  if (parsed) return parsed;

  // One retry with a sharper instruction. Use the prior bad output as
  // negative-example context so Claude knows not to repeat the wrapper.
  const retryPrompt = `${prompt}

Your previous reply was not valid JSON. Output ONLY the JSON object. No fences, no preamble, no commentary. The first character must be \`{\`.`;
  const retry = await callClaude(system, retryPrompt, { model: "sonnet", maxTokens: 2500 });
  return parseSkeletonStructuredOutput(retry);
}

/**
 * Convert the LLM's structured output into a single markdown blob. The
 * "Key capabilities" list is prepended because that region is the most-
 * scanned part of the entry detail page; the rest is the descriptor prose
 * verbatim.
 */
export function composeDescriptorMarkdown(s: SkeletonStructuredOutput): string {
  const parts: string[] = [];
  if (s.key_capabilities.length > 0) {
    parts.push("## Key capabilities");
    for (const cap of s.key_capabilities) {
      parts.push(`- ${cap}`);
    }
    parts.push("");
  }
  parts.push(s.descriptor.trim());
  return parts.join("\n");
}
