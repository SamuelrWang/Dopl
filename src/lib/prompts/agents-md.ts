export const AGENTS_MD_PROMPT = `You are generating an agents.md file — instructions for an AI coding agent to replicate this setup.

IMPORTANT — BREVITY RULES:
- The reader is an AI agent, not a junior developer. It already knows how to clone repos, install dependencies, run builds, use docker, pip, npm, etc.
- NEVER explain standard tools or workflows (git, npm, pip, docker, etc.). Just give the commands.
- NEVER add "What/Why/Verify" scaffolding for obvious steps. Only explain WHY when the reason is non-obvious or project-specific.
- Focus ONLY on what is unique to THIS setup — the specific configuration, architecture, and domain logic that the agent couldn't figure out from the repo alone.
- Omit any section that would be empty or generic. Only include sections with real, specific content.

## SOURCE REPOSITORY RULE

If the source comes from a GitHub repo or clonable codebase:
1. Lead with \`git clone\` + install in the Setup section — no explanation needed
2. NEVER reproduce source files inline — reference by path (e.g. \`src/strategies/weather.py\`)
3. Only include inline: .env templates, config files the user must CREATE, CLI commands, and setup steps not in the repo
4. Short code snippets (<15 lines) only for specific modifications the user must make

Source URL: {SOURCE_URL}

## Content Preservation Rules

PRESERVE VERBATIM: env var templates, CLI commands, config files not in repo, prompts/prompt templates, API endpoints, specific thresholds/limits/numbers.

REFERENCE BY PATH (don't reproduce): source code in repo, large config files in repo, test files, docs.

CONDENSE: anecdotes, marketing, repeated points, filler.

## Raw content:

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

<manifest>
{MANIFEST_JSON}
</manifest>

<readme>
{GENERATED_README}
</readme>

Generate agents.md using this structure (omit any section that would be empty or generic):

\`\`\`
# agents.md — [Title]

## Objective
[1-2 sentences: what the agent builds and the end result.]

## Setup
- Prerequisites: [brief checklist — runtime versions, accounts, API keys]
- Env vars:
\`\`\`
[.env template with placeholder values]
\`\`\`
- Commands:
\`\`\`bash
git clone <repo_url> && cd <repo> && <install command>
[any additional setup commands]
\`\`\`

## Architecture Overview
[How components connect. Reference key file paths with one-line descriptions inline.]

## Step-by-Step Setup
[Only non-obvious steps. Flat format — no What/Why/Verify boilerplate. Just describe what to do and give the commands. Include "why" only when the reason is surprising or project-specific.]

## Configuration & Customization
[What to tweak, which files, key parameters.]

## Testing & Verification
[How to verify the complete setup works.]
\`\`\`

Be terse. Every line should earn its place.`;

export const KEY_INSIGHTS_PROMPT = `You are extracting key insights from content for a knowledge base. Your job is to faithfully capture what the source says, organized for easy reference.

DO NOT add your own analysis or opinions. Extract and organize what's already there.

Source URL: {SOURCE_URL}

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

<manifest>
{MANIFEST_JSON}
</manifest>

<readme>
{GENERATED_README}
</readme>

Generate a "Key Insights" document using this structure:

# Key Insights — [Title]

## Core Thesis
[1-3 sentences: the main argument, finding, or point of this content. If there's no single thesis, summarize the topic.]

## Key Insights

1. **[Insight title]** — [Detailed explanation with supporting evidence or reasoning from the source. Include specific numbers, quotes, or examples.]

2. **[Insight title]** — [...]

[Continue for all distinct insights. Aim for 3-10 depending on content depth.]

## Actionable Takeaways

- [What a practitioner can do with this knowledge]
- [Specific techniques, approaches, or tools to explore]
- [...]

## Related Topics

- [Concepts or tools mentioned that connect to other knowledge]
- [...]

Extract ALL distinct insights. Don't merge or summarize separate points into one.`;

export const REFERENCE_GUIDE_PROMPT = `You are extracting a quick-reference guide from documentation or technical reference material. Optimize for fast lookup.

Source URL: {SOURCE_URL}

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

<manifest>
{MANIFEST_JSON}
</manifest>

<readme>
{GENERATED_README}
</readme>

Generate a "Reference Guide" document using this structure:

# Reference Guide — [Title]

## Quick Reference

[The most commonly needed information in a scannable format — key commands, primary API endpoints, or core concepts in a table or bullet list]

## Key Concepts

[Core abstractions, types, or patterns the reader needs to understand. Keep explanations concise.]

## Detailed Reference

[Comprehensive listing of APIs, parameters, configuration options, etc. Use code blocks and tables. Preserve all parameter names, types, defaults, and descriptions from the source.]

## Common Patterns & Examples

[Usage examples from the documentation. Preserve code examples verbatim.]

## Gotchas & Notes

[Warnings, caveats, common mistakes, edge cases. These are often the most valuable part of reference material.]

Preserve all technical specifics exactly. This is a reference document — accuracy matters more than brevity.`;

const SECONDARY_PROMPTS: Record<string, string> = {
  setup: AGENTS_MD_PROMPT,
  tutorial: AGENTS_MD_PROMPT,
  knowledge: KEY_INSIGHTS_PROMPT,
  article: KEY_INSIGHTS_PROMPT,
  reference: REFERENCE_GUIDE_PROMPT,
};

export function buildSecondaryArtifactPrompt(
  rawContent: string,
  manifestJson: string,
  readme: string,
  contentType: string,
  sourceUrl: string
): string {
  const template = SECONDARY_PROMPTS[contentType] || KEY_INSIGHTS_PROMPT;
  return template
    .replace("{ALL_RAW_CONTENT}", rawContent)
    .replace("{MANIFEST_JSON}", manifestJson)
    .replace("{GENERATED_README}", readme)
    .replace("{SOURCE_URL}", sourceUrl || "Not available");
}

// Keep backward-compatible export
export function buildAgentsMdPrompt(
  rawContent: string,
  manifestJson: string,
  readme: string,
  sourceUrl: string
): string {
  return buildSecondaryArtifactPrompt(rawContent, manifestJson, readme, "setup", sourceUrl);
}
