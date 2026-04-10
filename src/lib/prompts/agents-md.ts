export const AGENTS_MD_PROMPT = `You are generating an agents.md file. This file will be read by an AI agent (like Claude Code, Cowork, or OpenClaw) which will follow the instructions to BUILD or REPLICATE the described setup from scratch.

The agents.md must be:
- SELF-CONTAINED: The agent should not need the original source material
- SEQUENTIAL: Clear step-by-step order
- SPECIFIC: Exact commands, exact file contents, exact configs
- VERIFIABLE: Each step includes how to confirm it worked
- COMPLETE: Someone with ONLY this file can fully replicate the setup

## CRITICAL: Content Preservation Rules

You MUST follow these rules when deciding what to preserve vs summarize:

### ALWAYS PRESERVE VERBATIM (never summarize these):
- Prompts, prompt templates, or prompt text (these are executable — changing a word changes the output)
- Code, scripts, commands, CLI instructions
- Configuration files, environment variables, schemas
- API calls, endpoints, request/response formats
- Templates (email templates, response templates, document templates)
- Specific lists (tool names, directory names, filter criteria, platform names)
- Step-by-step procedures with specific parameters
- URLs, file paths, naming conventions
- Exact numbers that are functional (character limits, thresholds, filter values like "DR 20+", "volume 100-2000")

### PRESERVE CORE INSIGHT, TRIM NARRATIVE:
- "Why this matters" explanations → Keep the strategic insight, remove the storytelling wrapper
  Example: "I've had clients add one category and rank the next week. Categories control which searches trigger your listing." → Keep both sentences. Remove "I just stared at the screen" type filler.
- Tactical context that affects execution → Keep it
  Example: "Review velocity matters more than total count" → Keep (it changes how you interpret the data)

### OK TO CONDENSE (only these):
- Personal anecdotes that don't contain actionable information
- Marketing/promotional content ("shameless plug", "save this", "apply at my agency")
- Repeated points (if the same concept is stated 3 times, keep the best version)
- Filler phrases ("let me walk you through", "here's the thing")

### WHEN IN DOUBT: PRESERVE. It is far better to include something unnecessary than to lose something the agent needs to execute. A longer agents.md that works is infinitely more valuable than a shorter one that's missing a critical prompt.

Here is the raw content:

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

## Environment Variables

[Exact .env file with placeholder values, if applicable]

## File Structure

[The exact folder/file structure to create, if applicable]

## Step-by-Step Implementation

### Step 1: [Title]

**What:** [Brief description]
**Why:** [Why this step matters — preserve the strategic insight]

[Exact commands, prompts, file contents, configurations — ALL VERBATIM]

**Verify:** [How to confirm this step worked]

[Continue for ALL steps needed to fully replicate this setup]

## Configuration Templates

[Any config files, prompt templates, etc. — FULL content, NEVER truncated]

## Testing & Verification

[How to verify the complete setup works end-to-end]

## Troubleshooting

[Common issues and solutions]

## Notes

[Limitations, customization options, alternatives]

REMEMBER: Your job is to create a document so complete that an AI agent can replicate this setup with ZERO access to the original source. Every prompt preserved. Every command included. Every template complete. If the original has 20 prompts, your agents.md has 20 prompts — verbatim.`;

export function buildAgentsMdPrompt(
  rawContent: string,
  manifestJson: string,
  readme: string
): string {
  return AGENTS_MD_PROMPT.replace("{ALL_RAW_CONTENT}", rawContent)
    .replace("{MANIFEST_JSON}", manifestJson)
    .replace("{GENERATED_README}", readme);
}
