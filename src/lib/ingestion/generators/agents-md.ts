import { callClaude } from "@/lib/ai";
import { buildAgentsMdPrompt } from "@/lib/prompts/agents-md";
import { ContentClassification } from "./content-classifier";

export async function generateAgentsMd(
  allRawContent: string,
  manifest: Record<string, unknown>,
  readme: string,
  classification?: ContentClassification,
  sourceUrl?: string
): Promise<string> {
  // Build the base prompt
  let prompt = buildAgentsMdPrompt(
    allRawContent,
    JSON.stringify(manifest, null, 2),
    readme,
    sourceUrl || ""
  );

  // If we have classification data, inject preservation guidance
  if (classification && classification.preservation_notes.length > 0) {
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

  // agents.md is the most important artifact — give it max tokens
  const agentsMd = await callClaude("", prompt, { maxTokens: 16384 });
  return agentsMd.trim();
}
