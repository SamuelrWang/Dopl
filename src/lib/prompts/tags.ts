export const TAGS_PROMPT = `Based on the following manifest, generate a comprehensive list of tags for this entry. Each tag should have a type and value.

<manifest>
{MANIFEST_JSON}
</manifest>

Tag types:
- tool: specific tools/services (e.g., "claude", "supabase", "slack")
- platform: platforms (e.g., "vercel", "aws", "gcp")
- language: programming languages (e.g., "typescript", "python")
- framework: frameworks (e.g., "nextjs", "langchain")
- use_case: use cases (e.g., "cold-outbound", "monitoring")
- pattern: architecture patterns (e.g., "mcp-server", "rag", "agent-loop")
- integration: integration types (e.g., "slack-integration", "email")

Respond with JSON array:
[
  { "tag_type": "tool", "tag_value": "claude" },
  { "tag_type": "use_case", "tag_value": "cold-outbound" },
  ...
]

Be thorough. Include every relevant tag. Use lowercase, hyphen-separated values.`;

export function buildTagsPrompt(manifestJson: string): string {
  return TAGS_PROMPT.replace("{MANIFEST_JSON}", manifestJson);
}
