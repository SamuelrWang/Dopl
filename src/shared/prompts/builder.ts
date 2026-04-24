export const BUILDER_PROMPT = `You are building a composite AI/automation solution by combining patterns from multiple proven setups in a knowledge base.

Client brief:

<brief>
{CLIENT_BRIEF}
</brief>

Constraints:

<constraints>
{CONSTRAINTS}
</constraints>

Relevant entries from the knowledge base:

<entries>
{RETRIEVED_ENTRIES}
</entries>

Your job:
1. Analyze which parts of which entries are relevant to the brief
2. Design a composite architecture that combines the best approaches
3. Generate a composite README explaining the solution
4. Generate a composite agents.md with full implementation instructions
5. List which source entries contributed to the solution and how
6. Assess confidence: how well do the available entries cover this need?

The composite agents.md must be just as specific and complete as a single-entry agents.md — exact commands, exact file contents, exact configurations. An AI agent should be able to follow it with zero ambiguity.

Output format (as JSON):
{
  "composite_readme": "[Full README markdown]",
  "composite_agents_md": "[Full agents.md markdown]",
  "source_attribution": [
    { "entry_id": "...", "title": "...", "how_used": "..." }
  ],
  "confidence": {
    "score": 0.0-1.0,
    "gaps": ["what's missing"],
    "suggestions": ["entries to add to KB"]
  }
}`;

export function buildBuilderPrompt(
  brief: string,
  constraints: string,
  entries: string
): string {
  return BUILDER_PROMPT.replace("{CLIENT_BRIEF}", brief)
    .replace("{CONSTRAINTS}", constraints)
    .replace("{RETRIEVED_ENTRIES}", entries);
}
