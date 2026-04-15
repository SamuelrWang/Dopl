export const UNIFIED_MANIFEST_PROMPT = `You are analyzing content to extract structured metadata into a manifest.json format.

Content type: {CONTENT_TYPE}
Source type: {SOURCE_TYPE}

Here is ALL the raw content collected from the source and its linked resources:

<raw_content>
{ALL_RAW_CONTENT}
</raw_content>

Generate a manifest.json. Include ALL fields that are relevant to this content. Omit fields that don't apply.

## Always include these fields:

{
  "version": "1.0",
  "content_type": "{CONTENT_TYPE}",
  "source_type": "{SOURCE_TYPE}",
  "title": "[Descriptive title]",
  "description": "[One paragraph description]",
  "use_case": {
    "primary": "[main category — can be any descriptive category like: cold_outbound, lead_gen, content_creation, data_pipeline, monitoring, automation, agent_system, dev_tooling, customer_support, research, education, news, analysis, opinion, comparison, tutorial, reference, other]",
    "secondary": ["[additional categories]"]
  },
  "complexity": "[simple|moderate|complex|advanced]",
  "tags": ["[searchable tags — lowercase, hyphen-separated]"]
}

## Include these fields when tools/tech are involved (setup, tutorial, reference):

  "tools": [
    {
      "name": "[Tool name]",
      "role": "[What it does in this context]",
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
  "estimated_setup_time": "[Time estimate]"

## Include these fields for knowledge/article/opinion content:

  "key_topics": ["[Main concepts, techniques, or ideas discussed]"],
  "thesis": "[The main argument, claim, or point — if there is one]",
  "key_claims": ["[Specific factual claims or arguments made]"],
  "tools_mentioned": ["[Any tools or services mentioned, even if not the focus]"],
  "evidence_type": "[empirical|anecdotal|theoretical|mixed|none]"

Be thorough. Extract everything relevant to the content type.
For setup/tutorial content: extract EVERY tool, service, and integration mentioned.
For article/knowledge content: extract the key topics, claims, and insights.
Respond with ONLY the JSON, no other text.`;

export function buildManifestPrompt(rawContent: string, contentType: string = "setup", sourceType: string = "other"): string {
  return UNIFIED_MANIFEST_PROMPT
    .replace(/\{CONTENT_TYPE\}/g, contentType)
    .replace(/\{SOURCE_TYPE\}/g, sourceType)
    .replace("{ALL_RAW_CONTENT}", rawContent);
}
