export const SETUP_MANIFEST_PROMPT = `You are analyzing content from a social media post about an AI/automation setup. Your job is to extract structured metadata into a manifest.json format.

Here is ALL the raw content collected from this post and its linked resources:

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

Generate a manifest.json with this exact structure:

{
  "version": "1.0",
  "content_type": "setup",
  "title": "[Descriptive title for this setup]",
  "description": "[One paragraph description]",
  "use_case": {
    "primary": "[main category: cold_outbound, lead_gen, content_creation, data_pipeline, monitoring, automation, agent_system, dev_tooling, customer_support, research, other]",
    "secondary": ["[additional categories]"]
  },
  "complexity": "[simple|moderate|complex|advanced]",
  "tools": [
    {
      "name": "[Tool name]",
      "role": "[What it does in this setup]",
      "required": true/false,
      "alternatives": ["[Alternative tools]"]
    }
  ],
  "integrations": [
    {
      "from": "[Source tool/service]",
      "to": "[Destination tool/service]",
      "method": "[API|webhook|MCP|file|database|other]",
      "description": "[What data flows between them]"
    }
  ],
  "languages": ["[Programming languages used]"],
  "frameworks": ["[Frameworks used]"],
  "patterns": ["[Architecture patterns: mcp_server, agent_loop, rag, cron_job, webhook, event_driven, pipeline, etc.]"],
  "estimated_setup_time": "[Time estimate]",
  "tags": ["[searchable tags]"]
}

Be thorough. Extract EVERY tool, service, and integration mentioned.
If something is implied but not stated, include it with a note.
Respond with ONLY the JSON, no other text.`;

export const KNOWLEDGE_MANIFEST_PROMPT = `You are analyzing content from a social media post that shares AI/automation knowledge, insights, or educational content. Your job is to extract structured metadata into a manifest.json format.

Here is ALL the raw content collected from this post and its linked resources:

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

Generate a manifest.json with this exact structure:

{
  "version": "1.0",
  "content_type": "knowledge",
  "title": "[Descriptive title capturing the key insight or topic]",
  "description": "[One paragraph description of what this content teaches or explains]",
  "use_case": {
    "primary": "[main category: knowledge, tutorial, comparison, best_practices, technique, concept, analysis, opinion, news, other]",
    "secondary": ["[additional categories]"]
  },
  "complexity": "[simple|moderate|complex|advanced]",
  "key_topics": ["[Main concepts, techniques, or ideas discussed]"],
  "tools_mentioned": ["[Any tools or services mentioned, even if not the focus]"],
  "languages": ["[Programming languages discussed, if any]"],
  "frameworks": ["[Frameworks discussed, if any]"],
  "patterns": ["[Concepts or patterns discussed: rag, fine_tuning, prompt_engineering, embeddings, agent_design, etc.]"],
  "tags": ["[searchable tags]"]
}

Focus on capturing the KNOWLEDGE and INSIGHTS, not implementation details.
Extract the core concepts and topics being discussed.
Respond with ONLY the JSON, no other text.`;

export function buildManifestPrompt(rawContent: string, contentType: string = "setup"): string {
  const template = contentType === "knowledge" ? KNOWLEDGE_MANIFEST_PROMPT : SETUP_MANIFEST_PROMPT;
  return template.replace("{ALL_RAW_CONTENT}", rawContent);
}
