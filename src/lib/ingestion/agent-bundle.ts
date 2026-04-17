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
  /** Prompts, pre-filled where possible, template-with-placeholder otherwise. */
  prompts: {
    /** Run first. JSON response classifies the content. Pre-filled with {POST_TEXT}. */
    content_type: string;
    /**
     * Run only for setup/tutorial. Identifies sections that MUST be preserved
     * verbatim in agents.md. JSON response. Pre-filled with {ALL_RAW_CONTENT}.
     */
    classify_content: string;
    /**
     * Substitute {CONTENT_TYPE} and {SOURCE_TYPE} with the strings from your
     * content_type response, then run. {ALL_RAW_CONTENT} is already filled.
     */
    manifest_template: string;
    /**
     * Pick one based on content_type: setup/tutorial → `setup`; knowledge → `knowledge`;
     * article → `article`; reference/resource → `reference`. Each template has
     * {ALL_RAW_CONTENT} pre-filled and {MANIFEST_JSON} placeholder — substitute
     * `JSON.stringify(manifest, null, 2)` for that before running.
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
     * this step. Placeholders: {ALL_RAW_CONTENT} pre-filled; substitute
     * {MANIFEST_JSON}, {GENERATED_README}, {SOURCE_URL} yourself.
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

  return {
    gathered_content: gathered,
    gathered_content_chars: gathered.length,
    prompts: {
      // Content type classifier — pre-filled with raw text.
      content_type: CONTENT_TYPE_CLASSIFIER_PROMPT.replace(
        "{POST_TEXT}",
        gathered
      ),
      // Section classifier (setup/tutorial only) — pre-filled with raw text.
      classify_content: CONTENT_CLASSIFIER_PROMPT.replace(
        "{ALL_RAW_CONTENT}",
        gathered
      ),
      // Manifest — raw content pre-filled; {CONTENT_TYPE}, {SOURCE_TYPE} left
      // for the agent to substitute AFTER running content_type classifier.
      manifest_template: UNIFIED_MANIFEST_PROMPT.replace(
        "{ALL_RAW_CONTENT}",
        gathered
      ),
      // README templates — raw content pre-filled; {MANIFEST_JSON} left for
      // agent to substitute once the manifest is generated.
      readme_templates: {
        setup: SETUP_README_PROMPT.replace("{ALL_RAW_CONTENT}", gathered),
        knowledge: KNOWLEDGE_README_PROMPT.replace(
          "{ALL_RAW_CONTENT}",
          gathered
        ),
        article: ARTICLE_README_PROMPT.replace("{ALL_RAW_CONTENT}", gathered),
        reference: REFERENCE_README_PROMPT.replace(
          "{ALL_RAW_CONTENT}",
          gathered
        ),
      },
      // agents.md / secondary-artifact templates — raw content pre-filled.
      // Agent substitutes {MANIFEST_JSON}, {GENERATED_README}, {SOURCE_URL}.
      agents_md_templates: {
        setup: AGENTS_MD_PROMPT.replace("{ALL_RAW_CONTENT}", gathered),
        knowledge: KEY_INSIGHTS_PROMPT.replace("{ALL_RAW_CONTENT}", gathered),
        reference: REFERENCE_GUIDE_PROMPT.replace(
          "{ALL_RAW_CONTENT}",
          gathered
        ),
      },
      // Tag fallback — agent substitutes {MANIFEST_JSON} once manifest exists.
      tags_fallback: TAGS_PROMPT,
      // Image vision — no placeholders. Run as-is alongside each image.
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

Every prompt in \`prompts\` already has the raw content filled in. Placeholders in {CURLY_BRACES} are fields you substitute as you go.

1. CLASSIFY CONTENT TYPE
   Run \`prompts.content_type\`. Parse the JSON. You will get:
     { content_type: "setup"|"tutorial"|"knowledge"|"article"|"reference"|"resource",
       source_type: string,
       confidence: number,
       reasoning: string }
   Keep content_type and source_type — you will use them below.

2. CLASSIFY CONTENT SECTIONS (only for setup OR tutorial, otherwise skip)
   Run \`prompts.classify_content\`. Parse the JSON. Keep the full object —
   you will include it in the submit payload as \`content_classification\`.

3. GENERATE MANIFEST
   Take \`prompts.manifest_template\`. Replace every {CONTENT_TYPE} with the
   content_type from step 1, and every {SOURCE_TYPE} with the source_type.
   Run the prompt. Parse the JSON. Required fields in the output: title,
   description, use_case.primary, complexity ("simple"|"moderate"|"complex"|"advanced").

4. GENERATE README
   Pick a template from \`prompts.readme_templates\`:
     setup OR tutorial → \`setup\`
     knowledge → \`knowledge\`
     article → \`article\`
     reference OR resource → \`reference\`
   Replace {MANIFEST_JSON} with JSON.stringify(manifest, null, 2). Run.
   Keep the output markdown as \`readme\`.

5. GENERATE agents.md (SKIP if content_type is "resource")
   Pick a template from \`prompts.agents_md_templates\`:
     setup OR tutorial → \`setup\`
     knowledge OR article → \`knowledge\`
     reference → \`reference\`
   Replace {MANIFEST_JSON}, {GENERATED_README} (= the readme from step 4), and
   {SOURCE_URL} (= source_url from the prepare response). Run. Keep as \`agents_md\`.
   For content_type "resource", set agents_md = "".

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
