/**
 * Agent-ingestion prompt bundle.
 *
 * /api/ingest/prepare returns this payload to the user's Claude Code. The
 * agent runs each prompt in its own context, assembles the artifacts, and
 * POSTs them to /api/ingest/submit for embedding + persistence.
 *
 * Single source of truth for every prompt used in the agent-driven flow —
 * mirrors the server-side generators in [src/lib/ingestion/generators/](./generators/)
 * but keeps them as inert strings the agent can substitute.
 */

import { UNIFIED_MANIFEST_PROMPT } from "@/lib/prompts/manifest";
import {
  SETUP_README_PROMPT,
  KNOWLEDGE_README_PROMPT,
  ARTICLE_README_PROMPT,
  REFERENCE_README_PROMPT,
} from "@/lib/prompts/readme";
import {
  AGENTS_MD_PROMPT,
  KEY_INSIGHTS_PROMPT,
  REFERENCE_GUIDE_PROMPT,
} from "@/lib/prompts/agents-md";
import { CONTENT_TYPE_CLASSIFIER_PROMPT } from "@/lib/prompts/content-type-classifier";
import { CONTENT_CLASSIFIER_PROMPT } from "@/lib/prompts/content-classifier";
import { TAGS_PROMPT } from "@/lib/prompts/tags";
import { IMAGE_ANALYSIS_PROMPT } from "@/lib/prompts/image-vision";

export interface AgentIngestBundle {
  /** Raw content fetched by the server (primary URL + followed links). */
  gathered_content: string;
  /** Character count — sometimes useful for the agent to budget its context. */
  gathered_content_chars: number;
  /**
   * Prompt templates with {PLACEHOLDERS}. The agent substitutes
   * `gathered_content` (and other fields it generates as it goes) into the
   * placeholders before running each prompt. Keeping `gathered_content` out
   * of the templates is what keeps the prepare response slim — a 250KB
   * repo would otherwise inline into every template, ballooning the
   * response by 10x and eating the agent's context for no reason.
   */
  prompts: {
    /** Run first. Substitute {POST_TEXT} = gathered_content. JSON response classifies content. */
    content_type: string;
    /**
     * Run only for setup/tutorial. Substitute {ALL_RAW_CONTENT} = gathered_content.
     * Identifies sections that MUST be preserved verbatim in agents.md. JSON response.
     */
    classify_content: string;
    /**
     * Substitute {ALL_RAW_CONTENT} = gathered_content, {CONTENT_TYPE} and
     * {SOURCE_TYPE} = strings from your content_type response, then run.
     */
    manifest_template: string;
    /**
     * Pick one based on content_type: setup/tutorial → `setup`; knowledge → `knowledge`;
     * article → `article`; reference/resource → `reference`. Substitute
     * {ALL_RAW_CONTENT} = gathered_content and {MANIFEST_JSON} =
     * `JSON.stringify(manifest, null, 2)` before running.
     */
    readme_templates: {
      setup: string;
      knowledge: string;
      article: string;
      reference: string;
    };
    /**
     * Pick one based on content_type: setup/tutorial → `setup`; knowledge/article →
     * `knowledge`; reference → `reference`; resource → produce EMPTY string, skip
     * this step. Substitute {ALL_RAW_CONTENT} = gathered_content, {MANIFEST_JSON},
     * {GENERATED_README}, {SOURCE_URL} before running.
     */
    agents_md_templates: {
      setup: string;
      knowledge: string;
      reference: string;
    };
    /**
     * Fallback for when manifest-derived tags are fewer than 3. Substitute
     * {MANIFEST_JSON} with the manifest you generated, then run.
     */
    tags_fallback: string;
    /**
     * Image-vision prompt. Send alongside each base64 image in `images[]`.
     * Produces an analysis string — classify it yourself as one of
     * `code_screenshot`|`architecture_diagram`|`image`|`other` based on whether
     * the analysis mentions "code screenshot", "architecture"/"diagram", etc.
     */
    image_vision: string;
  };
}

/**
 * Build the bundle for the agent. `gatheredContent` is the concatenated text
 * extracted from the primary URL and any followed links — the server has
 * already run the extractors.
 */
export function buildAgentIngestBundle(input: {
  gatheredContent: string;
}): AgentIngestBundle {
  const gathered = input.gatheredContent;

  // Templates ship as-is. The agent substitutes {ALL_RAW_CONTENT} (and
  // {POST_TEXT} for the content_type classifier) from the response's
  // top-level `gathered_content` field at the moment it runs each prompt.
  // This keeps the prepare response O(content_size) instead of
  // O(content_size × num_prompts) — for a 250KB repo, ~250KB vs ~2.8MB.
  return {
    gathered_content: gathered,
    gathered_content_chars: gathered.length,
    prompts: {
      content_type: CONTENT_TYPE_CLASSIFIER_PROMPT,
      classify_content: CONTENT_CLASSIFIER_PROMPT,
      manifest_template: UNIFIED_MANIFEST_PROMPT,
      readme_templates: {
        setup: SETUP_README_PROMPT,
        knowledge: KNOWLEDGE_README_PROMPT,
        article: ARTICLE_README_PROMPT,
        reference: REFERENCE_README_PROMPT,
      },
      agents_md_templates: {
        setup: AGENTS_MD_PROMPT,
        knowledge: KEY_INSIGHTS_PROMPT,
        reference: REFERENCE_GUIDE_PROMPT,
      },
      tags_fallback: TAGS_PROMPT,
      image_vision: IMAGE_ANALYSIS_PROMPT,
    },
  };
}

/**
 * Step-by-step instructions the agent follows after calling prepare_ingest.
 * Rendered verbatim into the prepare response so every client sees the same
 * playbook regardless of its version of the MCP server.
 */
export const AGENT_INGEST_INSTRUCTIONS = `To complete this ingestion, run these steps in YOUR OWN Claude context, then call \`submit_ingested_entry\` with the results.

Every prompt is a template with {CURLY_BRACE} placeholders. Before running
a prompt, do plain string-replace on every placeholder it contains. The
content placeholders ({ALL_RAW_CONTENT} and {POST_TEXT}) both get filled
with the response's top-level \`gathered_content\` field. Other placeholders
({CONTENT_TYPE}, {MANIFEST_JSON}, {GENERATED_README}, {SOURCE_URL}, etc.)
are filled with values you produce as you walk these steps.

1. CLASSIFY CONTENT TYPE
   Take \`prompts.content_type\`. Replace {POST_TEXT} with \`gathered_content\`.
   Run the prompt. Parse the JSON. You will get:
     { content_type: "setup"|"tutorial"|"knowledge"|"article"|"reference"|"resource",
       source_type: string,
       confidence: number,
       reasoning: string }
   Keep content_type and source_type — you will use them below.

2. CLASSIFY CONTENT SECTIONS (only for setup OR tutorial, otherwise skip)
   Take \`prompts.classify_content\`. Replace {ALL_RAW_CONTENT} with \`gathered_content\`.
   Run the prompt. Parse the JSON. Keep the full object — you will include
   it in the submit payload as \`content_classification\`.

3. GENERATE MANIFEST
   Take \`prompts.manifest_template\`. Replace:
     {ALL_RAW_CONTENT} → \`gathered_content\`
     {CONTENT_TYPE}    → content_type from step 1
     {SOURCE_TYPE}     → source_type from step 1
   Run. Parse the JSON. Required fields in the output: title,
   description, use_case.primary, complexity ("simple"|"moderate"|"complex"|"advanced").

4. GENERATE README
   Pick a template from \`prompts.readme_templates\`:
     setup OR tutorial → \`setup\`
     knowledge → \`knowledge\`
     article → \`article\`
     reference OR resource → \`reference\`
   Replace:
     {ALL_RAW_CONTENT} → \`gathered_content\`
     {MANIFEST_JSON}   → JSON.stringify(manifest, null, 2)
   Run. Keep the output markdown as \`readme\`.

5. GENERATE agents.md (SKIP if content_type is "resource")
   Pick a template from \`prompts.agents_md_templates\`:
     setup OR tutorial → \`setup\`
     knowledge OR article → \`knowledge\`
     reference → \`reference\`
   Replace:
     {ALL_RAW_CONTENT} → \`gathered_content\`
     {MANIFEST_JSON}   → JSON.stringify(manifest, null, 2)
     {GENERATED_README} → the readme from step 4
     {SOURCE_URL}      → source_url from the prepare response
   Run. Keep as \`agents_md\`. For content_type "resource", set agents_md = "".

6. GENERATE TAGS
   First try extracting tags directly from the manifest:
     - manifest.tools[].name → { tag_type: "tool", tag_value: name }
     - manifest.integrations[].from, manifest.integrations[].to → "integration"
     - manifest.languages[] → "language"
     - manifest.frameworks[] → "framework"
     - manifest.patterns[] → "pattern"
     - manifest.use_case.primary + manifest.use_case.secondary[] → "use_case"
     - manifest.platform → "platform"
   Normalize every value to lowercase, hyphen-separated. Dedupe by (tag_type, tag_value).
   If you have fewer than 3 tags, run \`prompts.tags_fallback\` with
   {MANIFEST_JSON} substituted, and merge its output. Parse as JSON array of
   { tag_type, tag_value }.

7. ANALYZE IMAGES (if any are present in \`images[]\`)
   For each image, call your own vision model with \`prompts.image_vision\` and
   the base64 data. Classify the result by keyword match:
     analysis contains "code screenshot" or "code snippet" → "code_screenshot"
     analysis contains "architecture" or "diagram" → "architecture_diagram"
     otherwise → "image"
   Build an \`image_analyses\` array of
     { image_id, source_type, raw_content: "[base64 image: <mimeType>]",
       extracted_content: <analysis>,
       metadata: { mimeType, imageType: source_type } }.

8. SUBMIT
   Call submit_ingested_entry with:
     entry_id         — from prepare response
     content_type     — from step 1
     source_type      — from step 1
     manifest         — from step 3 (entire JSON object)
     readme           — from step 4
     agents_md        — from step 5 (empty string for "resource")
     tags             — from step 6
     image_analyses   — from step 7 (omit if no images)
     content_classification — from step 2 (omit for non-setup/tutorial)

The server validates the shape, runs embeddings, and persists. You get back
{ status: "complete", entry_id, slug, title }.`;
