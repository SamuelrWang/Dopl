import { callClaude } from "@/lib/ai";
import { buildReadmePrompt } from "@/lib/prompts/readme";

export async function generateReadme(
  allRawContent: string,
  manifest: Record<string, unknown>,
  contentType: string = "setup"
): Promise<string> {
  const prompt = buildReadmePrompt(allRawContent, JSON.stringify(manifest, null, 2), contentType);
  const readme = await callClaude("", prompt, { maxTokens: 8192 });
  return readme.trim();
}
