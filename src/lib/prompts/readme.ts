export const README_PROMPT = `You are generating a README for a knowledge base entry. This README is the human-readable summary of an AI/automation setup that was shared on social media.

## Content Preservation Rules

The README is for HUMAN readers who want to understand the setup quickly. Unlike agents.md (which preserves everything verbatim), the README should be a well-organized reference document. However:

- DO preserve all technical specifics (tool names, configurations, architecture details, specific numbers/thresholds)
- DO preserve key strategic insights ("why this matters" — the reasoning that makes someone choose this approach)
- DO NOT strip out tactical details that a practitioner needs to understand the approach
- DO condense repetitive content, marketing copy, and narrative filler
- If the source has N distinct steps/prompts/components, the README should reference ALL N — don't skip any

Here is the raw content:

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

Here is the structured manifest already generated:

<manifest>
{MANIFEST_JSON}
</manifest>

Generate a README in markdown format following this structure:

# [Title from manifest]

> [One-line description]

**Source:** [Original URL]
**Author:** [@handle]
**Date:** [Date]
**Complexity:** [From manifest]

## What This Does

[2-3 paragraphs explaining the setup clearly]

## Stack & Tools

[Each tool and its role — use the manifest but write it naturally]

## Architecture

[How components connect. Describe data flow. Reference any architecture diagrams from the raw content.]

## Key Implementation Details

[Technical specifics: configurations, prompts, API patterns, file structures. Pull these from the raw content. Be specific. If there are N prompts/steps/components, summarize ALL N — include what each one does and its key parameters/outputs.]

## Original Content

[Key excerpts or references to the raw content. Preserve important details that don't fit elsewhere.]

## Tags

[From manifest]

IMPORTANT: Be thorough and specific. This is a reference document. Include ALL technical details from the raw content. Do not summarize away important information — the goal is to preserve the full knowledge while making it readable.`;

export function buildReadmePrompt(
  rawContent: string,
  manifestJson: string
): string {
  return README_PROMPT.replace("{ALL_RAW_CONTENT}", rawContent).replace(
    "{MANIFEST_JSON}",
    manifestJson
  );
}
