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

export function buildAgentsMdPrompt(
  rawContent: string,
  manifestJson: string,
  readme: string,
  sourceUrl: string
): string {
  return AGENTS_MD_PROMPT.replace("{ALL_RAW_CONTENT}", rawContent)
    .replace("{MANIFEST_JSON}", manifestJson)
    .replace("{GENERATED_README}", readme)
    .replace("{SOURCE_URL}", sourceUrl || "Not available");
}
