export const CONTENT_CLASSIFIER_PROMPT = `Analyze the following raw content from a social media post about an AI/automation setup. Your job is to classify each distinct section of content by how it should be treated in documentation.

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

For each identifiable section or block of content, classify it as one of:

1. **EXECUTABLE** — Prompts, code, commands, configs, templates, schemas, step-by-step instructions. These MUST be preserved word-for-word in documentation. Changing even one word could change the output.

2. **TACTICAL** — Strategic insights, "why this matters" reasoning, specific numbers/thresholds/criteria, tool-specific knowledge. These should be preserved in substance (exact numbers, key insights) but narrative wrapper can be trimmed.

3. **CONTEXT** — Background information, author credentials, use case framing, before/after descriptions. Useful for README but not needed for execution.

4. **SKIP** — Marketing/promotional content, self-promotion, repeated points, filler phrases, engagement bait ("save this", "share this").

Output as JSON:
{
  "sections": [
    {
      "title": "Brief description of the section",
      "classification": "EXECUTABLE|TACTICAL|CONTEXT|SKIP",
      "reason": "Why this classification",
      "content_preview": "First 100 chars of the section..."
    }
  ],
  "stats": {
    "executable_count": N,
    "tactical_count": N,
    "context_count": N,
    "skip_count": N,
    "executable_percentage": "X%"
  },
  "preservation_notes": [
    "Any specific things the generators MUST preserve — e.g., 'There are 20 distinct prompts that must all be included verbatim'"
  ]
}

Be thorough. Identify EVERY distinct section. The executable count is critical — if there are 20 prompts, all 20 must be flagged as EXECUTABLE.`;

export function buildContentClassifierPrompt(rawContent: string): string {
  return CONTENT_CLASSIFIER_PROMPT.replace("{ALL_RAW_CONTENT}", rawContent);
}
