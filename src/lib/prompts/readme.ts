export const SETUP_README_PROMPT = `You are generating a README for a knowledge base entry. This README is the human-readable summary of an implementation or setup.

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

**Source:** {SOURCE_URL}
**Author:** [Author if available]
**Date:** [Date if available]
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

export const KNOWLEDGE_README_PROMPT = `You are generating a README for a knowledge base entry. This README summarizes knowledge, insights, or educational content.

## Content Preservation Rules

The README is for HUMAN readers who want to understand the concepts and insights quickly. This is NOT a setup guide — it's a knowledge reference document.

- DO preserve all key insights, explanations, and reasoning
- DO preserve specific claims, numbers, comparisons, and examples
- DO preserve the author's unique perspective or analysis
- DO condense repetitive content, marketing copy, and narrative filler
- DO NOT invent implementation details that aren't in the source

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

> [One-line description of the key insight or topic]

**Source:** {SOURCE_URL}
**Author:** [Author if available]
**Date:** [Date if available]
**Type:** Knowledge / Insight

## What This Covers

[2-3 paragraphs explaining what this content teaches or discusses]

## Key Concepts

[The main ideas, techniques, or concepts explained. Use subheadings if there are multiple distinct concepts. Preserve the author's explanations and reasoning.]

## Insights & Analysis

[The author's unique analysis, opinions, or insights. What makes this content valuable? What non-obvious points does it make? Preserve specific examples and reasoning.]

## Practical Takeaways

[What a practitioner can learn or apply from this content. Actionable knowledge, even if it's conceptual rather than step-by-step. If the author mentions specific tools, techniques, or approaches, include them here.]

## Related Topics

[Concepts, tools, or techniques mentioned that readers might want to explore further]

## Tags

[From manifest]

IMPORTANT: Focus on preserving the KNOWLEDGE and INSIGHTS. The goal is to capture what makes this content valuable as a reference.`;

export const ARTICLE_README_PROMPT = `You are generating a README for a knowledge base entry. This README captures the key content from a news article, opinion piece, or published analysis.

## Content Extraction Rules

Your job is to FAITHFULLY CAPTURE AND ORGANIZE the content, not to analyze or editorialize it. Preserve the author's claims, data points, and arguments as stated in the source.

- DO preserve all factual claims, statistics, and data points exactly as stated
- DO preserve direct quotes and attributions
- DO preserve the logical structure of the author's argument
- DO NOT add your own analysis, opinions, or editorial commentary
- DO NOT reframe the author's claims — present them as they are
- DO condense only redundant passages and filler — not substance

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

> [One-line summary of the article's main point]

**Source:** {SOURCE_URL}
**Author:** [Author/Publication if available]
**Date:** [Date if available]
**Type:** Article

## What This Reports

[2-3 paragraphs summarizing the article's main subject and context]

## Key Claims & Evidence

[The specific claims, findings, or arguments made in the article. Use bullet points or numbered lists. Include supporting evidence, data, or quotes where provided.]

## Context & Background

[Background information that helps readers understand the claims — industry context, prior events, related developments]

## Implications

[What the article suggests will happen, what it means for practitioners, or what actions it recommends — as stated by the author, NOT your interpretation]

## Tags

[From manifest]

IMPORTANT: This is extraction, not analysis. Faithfully capture what the source says. Your value is in organizing the content clearly, not in interpreting it.`;

export const REFERENCE_README_PROMPT = `You are generating a README for a knowledge base entry. This README captures the key content from documentation, API references, or technical reference material.

## Content Extraction Rules

Your job is to extract the key technical details into a scannable reference. Focus on what a developer would need to look up repeatedly.

- DO preserve all API signatures, parameter names, types, and defaults
- DO preserve all configuration options and their effects
- DO preserve all warnings, gotchas, and important notes
- DO structure information for quick lookup, not narrative reading
- DO NOT add explanations beyond what the source provides

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

> [One-line description of what this reference covers]

**Source:** {SOURCE_URL}
**Type:** Reference / Documentation

## What This Covers

[1-2 paragraphs describing the scope of this reference]

## Key Concepts

[Core concepts, types, or abstractions that the reader needs to understand]

## API / Interface Summary

[Key functions, endpoints, methods, or interfaces. Use code blocks and tables where appropriate.]

## Configuration & Parameters

[Key configuration options, parameters, and their effects. Use tables for option lists.]

## Important Notes & Gotchas

[Warnings, common pitfalls, edge cases, and important caveats from the documentation]

## Tags

[From manifest]

IMPORTANT: This is structured extraction. Organize the content for quick lookup. Every parameter, option, and gotcha mentioned in the source should be captured.`;

const README_PROMPTS: Record<string, string> = {
  setup: SETUP_README_PROMPT,
  tutorial: SETUP_README_PROMPT,
  knowledge: KNOWLEDGE_README_PROMPT,
  article: ARTICLE_README_PROMPT,
  reference: REFERENCE_README_PROMPT,
  resource: KNOWLEDGE_README_PROMPT,
};

export function buildReadmePrompt(
  rawContent: string,
  manifestJson: string,
  contentType: string = "setup"
): string {
  const template = README_PROMPTS[contentType] || KNOWLEDGE_README_PROMPT;
  return template.replace("{ALL_RAW_CONTENT}", rawContent).replace(
    "{MANIFEST_JSON}",
    manifestJson
  );
}
