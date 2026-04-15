import { callClaude, ModelTier } from "@/lib/ai";
import { buildSecondaryArtifactPrompt } from "@/lib/prompts/agents-md";
import { ContentClassification } from "./content-classifier";

export async function generateAgentsMd(
  allRawContent: string,
  manifest: Record<string, unknown>,
  readme: string,
  classification?: ContentClassification,
  sourceUrl?: string,
  contentType?: string,
  model?: ModelTier
): Promise<string> {
  const effectiveType = contentType || "setup";

  // Resource type gets no secondary artifact
  if (effectiveType === "resource") {
    return "";
  }

  // Build the prompt based on content type
  let prompt = buildSecondaryArtifactPrompt(
    allRawContent,
    JSON.stringify(manifest, null, 2),
    readme,
    effectiveType,
    sourceUrl || ""
  );

  // For setup/tutorial types, inject preservation guidance from content classification
  if ((effectiveType === "setup" || effectiveType === "tutorial") && classification && classification.preservation_notes.length > 0) {
    const preservationBlock = `

## CONTENT CLASSIFICATION RESULTS (from pre-analysis)

The raw content was pre-analyzed. Here are critical preservation notes:

${classification.preservation_notes.map((n) => `- ⚠️ ${n}`).join("\n")}

Stats: ${classification.stats.executable_count} EXECUTABLE sections, ${classification.stats.tactical_count} TACTICAL sections, ${classification.stats.context_count} CONTEXT sections, ${classification.stats.skip_count} SKIP sections.
Executable content is ${classification.stats.executable_percentage} of total.

${classification.sections
  .filter((s) => s.classification === "EXECUTABLE")
  .map((s) => `- MUST PRESERVE: "${s.title}" — ${s.reason}`)
  .join("\n")}

DO NOT summarize any section marked EXECUTABLE above. Include it word-for-word in the agents.md — but if it is source code from a cloneable repo, reference it by file path instead of reproducing it inline.`;

    prompt = prompt + preservationBlock;
  }

  // Max tokens: agents.md (setup) gets most, insights/reference get less
  const maxTokens = (effectiveType === "setup" || effectiveType === "tutorial") ? 16384 : 8192;

  const result = await callClaude("", prompt, { maxTokens, model });
  return result.trim();
}
