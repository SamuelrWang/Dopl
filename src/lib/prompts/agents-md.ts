export const AGENTS_MD_PROMPT = `You are generating an agents.md file. This file will be read by an AI agent (like Claude Code, Cowork, or OpenClaw) which will follow the instructions to BUILD or REPLICATE the described setup from scratch.

The agents.md must be:
- ACTIONABLE: The agent can follow it step-by-step to get the setup running
- SEQUENTIAL: Clear step-by-step order
- SPECIFIC: Exact commands, exact configs, exact env vars
- VERIFIABLE: Each step includes how to confirm it worked
- COMPLETE: The agent knows where to get everything and how to configure it

## SOURCE REPOSITORY RULE

If the source content comes from a GitHub repository or any clonable codebase:

1. **Lead with clone/install** — the first step should be \`git clone <repo_url>\` and installing dependencies
2. **NEVER reproduce full source files inline** — the code already exists in the repo. Instead:
   - Reference files by their repo path (e.g. "see \`src/strategies/weather_strategy.py\`")
   - Describe what each key file/module does and how to customize it
   - Only include SHORT code snippets (<15 lines) when showing specific modifications or customizations the user must make
3. **DO include inline:** environment variable templates (.env), config files the user must CREATE or MODIFY, CLI commands, and any setup steps not covered by the repo itself
4. **Architecture overview** — provide a brief description of how the key components connect, referencing file paths in the repo

The source URL is: {SOURCE_URL}

## Content Preservation Rules

You MUST follow these rules when deciding what to preserve vs reference:

### ALWAYS PRESERVE VERBATIM (include inline):
- Environment variable templates and .env file contents
- CLI commands and shell scripts for setup/deployment
- Configuration files the user must create or modify that are NOT in the repo
- Prompts and prompt templates (these are executable — changing a word changes the output)
- API endpoints, request/response formats
- Specific thresholds, limits, and functional numbers (character limits, filter values like "DR 20+", "volume 100-2000")

### REFERENCE BY PATH (do NOT reproduce inline):
- Source code files that exist in the repo — describe purpose, reference by path
- Large configuration files already in the repo — point to them
- Test files — mention they exist, how to run them
- Documentation files in the repo — link to them

### PRESERVE CORE INSIGHT, TRIM NARRATIVE:
- "Why this matters" explanations → Keep the strategic insight, remove the storytelling wrapper
- Tactical context that affects execution → Keep it

### OK TO CONDENSE:
- Personal anecdotes that don't contain actionable information
- Marketing/promotional content
- Repeated points (keep the best version)
- Filler phrases

## Raw content:

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

Here is the manifest:

<manifest>
{MANIFEST_JSON}
</manifest>

Here is the README:

<readme>
{GENERATED_README}
</readme>

Generate an agents.md file in markdown format following this structure:

# agents.md — [Title]

## Objective

[What the agent should build. What the end result looks like.]

## Prerequisites

[Everything needed before starting — runtime versions, accounts, API keys, etc. Use checkboxes.]

## Quick Start

[Clone repo, install deps, configure env — get running fast]

## Environment Variables

[Exact .env file with placeholder values]

## Architecture Overview

[Brief description of key components and how they connect. Reference file paths in the repo.]

## Step-by-Step Setup

### Step 1: [Title]

**What:** [Brief description]
**Why:** [Why this step matters]

[Commands, config changes, and references to repo files — NOT full source code dumps]

**Verify:** [How to confirm this step worked]

[Continue for ALL steps needed]

## Key Files Reference

[Table or list of important files in the repo with brief descriptions of what each does]

## Configuration & Customization

[What to tweak, which files to modify, key parameters to adjust]

## Testing & Verification

[How to verify the complete setup works end-to-end]

## Troubleshooting

[Common issues and solutions]

## Notes

[Limitations, customization options, alternatives]

Keep the document focused and practical. An agent reading this should be able to clone the repo, configure it, and get it running — not re-implement the entire codebase from scratch.`;

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
