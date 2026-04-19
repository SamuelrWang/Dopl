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

/**
 * Inventory entry for one extracted source. The prepare response ships
 * these instead of the content itself — the agent calls
 * `get_ingest_content(entry_id [, source_url])` to pull the body when
 * it's about to run a prompt. Cuts response size from O(content_size)
 * to O(num_sources).
 */
export interface SourceIndexEntry {
  url: string | null;
  source_type: string;
  depth: number;
  chars: number;
}

/**
 * Record of an extraction attempt that didn't produce usable content.
 * Surfaces failures up to the agent so it knows what's missing from the
 * corpus rather than assuming the server fetched everything successfully.
 * Backed by `sources` rows with `status='failed'`.
 */
export interface FetchWarning {
  url: string | null;
  reason: string;
  fetch_status_code: number | null;
}

export interface AgentIngestBundle {
  /**
   * Inventory of successfully-extracted sources for this entry. Each
   * entry's content is retrievable via `get_ingest_content` — the
   * response deliberately doesn't inline content here so the payload
   * stays small regardless of how much the extractor pulled.
   */
  sources: SourceIndexEntry[];
  /**
   * Extractor attempts that didn't yield usable content. The agent can
   * surface these to the user ("I couldn't fetch X") or ignore them.
   */
  fetch_warnings: FetchWarning[];
  /**
   * Prompt templates with {PLACEHOLDERS}. Before running each prompt,
   * the agent calls `get_ingest_content(entry_id)` to retrieve the
   * extracted content, then substitutes it into `{ALL_RAW_CONTENT}` and
   * `{POST_TEXT}` along with the step-specific placeholders (content_type,
   * manifest_json, etc.). Keeping content out of the response is what
   * makes this bundle tractable for large repos.
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
  sources: SourceIndexEntry[];
  fetchWarnings: FetchWarning[];
}): AgentIngestBundle {
  // Templates ship as-is. The agent calls `get_ingest_content(entry_id)`
  // to retrieve content before running each prompt and substitutes
  // {ALL_RAW_CONTENT} / {POST_TEXT} itself. This keeps the prepare
  // response O(num_sources) instead of O(content_size × num_prompts)
  // (which the legacy bundle produced — 2.8MB for a 250KB repo).
  return {
    sources: input.sources,
    fetch_warnings: input.fetchWarnings,
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
export const AGENT_INGEST_INSTRUCTIONS = `To complete this ingestion, run steps 1-8 below, then call \`submit_ingested_entry\` with the results.

## HOW to run this — strongly prefer a subagent

A full ingest pulls 100-300KB of repo content, runs 6 LLM prompts, and
produces 20-30KB of artifacts. Running that inline bloats your main
conversation with tokens the user didn't ask to pay attention to.
Instead: **delegate the whole thing to a subagent** whenever your client
supports one.

### Preferred path — spawn a subagent

If you have a subagent / task-delegation tool (Claude Code's \`Task\`,
Cursor background agents, similar primitives in other clients), spawn
one now with these properties:

- **Model: \`sonnet\`** — pin this explicitly. Sonnet produces ~90-95%
  quality-equivalent output to Opus on ingestion at a fraction of the
  cost and latency. Don't let the subagent default to whatever model
  your main conversation is running — ingestion is a bulk background
  task, not an interactive UX surface.
- **MCP tool access**: subagent needs \`get_ingest_content\` and
  \`submit_ingested_entry\`. In Claude Code these inherit from the
  parent; in other clients verify before spawning.
- **Task description**: paste the prepare_ingest response fields the
  subagent needs (\`entry_id\`, \`source_url\`, \`sources\`,
  \`fetch_warnings\`, the full \`prompts\` object, and any \`images\`)
  plus steps 1-8 below verbatim. The subagent follows the steps, calls
  \`submit_ingested_entry\`, and returns a one-paragraph summary.

After the subagent returns, relay its summary to the user. You don't
need to touch the gathered content or artifacts yourself — the
subagent's result is the whole ingest.

### Fallback — run inline only if no subagent is available

If your client doesn't expose a subagent primitive, run steps 1-8
yourself. Be aware:
- 100-300KB of content + 6 prompt responses will persist in your
  conversation history. On a small entry (a tweet, short blog) this is
  fine. On a large GitHub monorepo it can eat 20-40% of your context
  budget.
- Flag this trade-off to the user before starting: \"This ingest will
  consume substantial context because my client can't delegate it.
  Proceed?\"

---

## The 8 steps (for whoever's running them — subagent or you)

### Fetching content

The prepare response gives you a \`sources\` inventory but NOT the content
itself. Before running any prompt below, call
\`get_ingest_content(entry_id)\` to retrieve the aggregated extracted
content across all successful sources. This returns \`{ content, chars,
truncated }\`. Use \`content\` to fill the \`{ALL_RAW_CONTENT}\` and
\`{POST_TEXT}\` placeholders below.

To save tokens on a narrow step (e.g. the content_type classifier only
needs the README), pass an optional \`source_url\` to
\`get_ingest_content\` matching one of the \`sources[].url\` entries —
you'll get just that source back.

If a call returns \`truncated: true\`, the entry's total content
exceeds the endpoint's 60KB cap — switch to per-source fetches for
the remaining prompts to stay under the MCP response limit.
Per-source is the preferred pattern for larger entries anyway: each
prompt step only needs the content relevant to it, so narrowing saves
tokens even when the all-sources response would have fit.

### Placeholder substitution rule

Every prompt is a template with {CURLY_BRACE} placeholders. Before running
a prompt, do plain string-replace on every placeholder it contains. The
content placeholders ({ALL_RAW_CONTENT} and {POST_TEXT}) both get filled
with content from \`get_ingest_content\`. Other placeholders ({CONTENT_TYPE},
{MANIFEST_JSON}, {GENERATED_README}, {SOURCE_URL}, etc.) are filled with
values you produce as you walk these steps.

### fetch_warnings

\`fetch_warnings[]\` lists URLs the extractor attempted but couldn't
retrieve (S3 AccessDenied, 404 pages, network timeouts). Use this to
flag missing content to the user rather than inventing details about
assets that didn't make it into the corpus.

### detected_links — offer related entries AFTER submit

\`detected_links[]\` lists URLs the primary extractor discovered (in
README bodies, linked docs, referenced repos) but did NOT follow.

Important framing: **these links are NOT for enriching the current
entry.** The primary extractor already handles same-project deeper
content (for GitHub: README + CLAUDE.md + AGENTS.md + DESIGN.md + file
tree + package.json + configs; for an X post: the tweet body + author
context; etc.). If a link is same-project, it's already covered.

\`detected_links\` exists for the case where the current source
**references a distinct external source** that's worth being its own
KB entry — e.g., an X post that links to a GitHub repo, a blog post
that references a canonical whitepaper, a tutorial that cites a
sibling tool. The right outcome there is **two entries, not one
bundle**: the current entry stays focused on its own source, and the
referenced source gets its own full-tier entry that other entries
can mention by slug.

**Protocol:**

1. **Finish the current entry first.** Run steps 1-8 below, call
   \`submit_ingested_entry\`. Do NOT touch \`detected_links\` before
   submitting.
2. **After submission,** review \`detected_links\`. Filter out:
   - Badges, shields.io, image CDNs, analytics (noise)
   - Self-references (releases, stargazers, the same source under
     different paths)
   - Tangential mentions where the primary entry already explains
     everything relevant
3. **For remaining links** that look like distinct content sources
   worth their own entry, present them to the user with a one-line
   rationale each. Template:
   > "The [source_platform] entry I just ingested references these
   > external sources: [list with one-line rationale each]. Want me
   > to ingest any of them as separate KB entries?"
4. **Wait for explicit user approval.** On approval, call
   \`prepare_ingest(url)\` for each chosen URL — normal flow,
   becomes its own entry. Mention the originating entry's slug in
   the new entry's README prose so the two are cross-referenced
   editorially.
5. **Never expand scope without explicit user approval.** No silent
   follows, no "I'll just grab this one because it looks useful."
   User consent is the scope gate.

Typical outcome: most detected_links are low-signal and the list
collapses to zero after filtering. In that case just report "no
related sources worth ingesting separately" and move on. When there
IS a genuine distinct-source reference (X post → GitHub repo is the
canonical example), the two-entry model keeps the KB clean: the X
post entry is about what the author said; the GitHub repo entry is
about the project, independently searchable and reusable.

### Submission decision rule

Call \`submit_ingested_entry\` at the end of the flow UNLESS one of
these two conditions holds:

1. The \`sources[]\` inventory from prepare_ingest is empty. Only
   successful extractions appear in \`sources[]\`; if it's empty and
   \`fetch_warnings[]\` is non-empty, every attempted URL failed. No
   content to ingest — report the failure (summarize what's in
   \`fetch_warnings\`) to the caller and stop.
2. \`sources[]\` has entries but they're all effectively empty — every
   entry has \`chars\` near zero, OR the aggregated \`get_ingest_content\`
   response is under ~200 chars of non-whitespace. Also report and stop.

**Do NOT refuse to submit for any of the following reasons.** These
are out of scope for you and will cause the ingest to stall
unnecessarily:

- **Source URL looks suspicious.** Unfamiliar snowflake IDs,
  high numeric values, unusual paths, etc. If \`prepare_ingest\`
  accepted the URL and returned usable content via
  \`get_ingest_content\`, the URL is real. The server's fetcher
  already validated it at request time. Do not second-guess.
- **Content appears promotional, unverifiable, ideologically charged,
  or resembles a "get-rich-quick" scheme.** Your job is to accurately
  represent what the extractor returned — title, tools, patterns,
  integrations. **Content moderation is the operator's job at the
  \`/admin/review\` stage**, not yours at ingest time. Submit the
  entry faithfully; the operator will approve or deny it against
  their content policy. Refusing to submit based on your own
  judgment of the content's merit bypasses the moderation flow and
  robs the operator of the chance to apply it.
- **You're unsure whether the entry is "worth" being in the KB.**
  Not your call. Submit; moderation decides.

The ONLY legitimate reasons to skip submission are the two in the
numbered list above — genuine empty-extraction cases. Everything else
submits.

1. CLASSIFY CONTENT TYPE
   Take \`prompts.content_type\`. Replace {POST_TEXT} with the content from \`get_ingest_content(entry_id)\`.
   Run the prompt. Parse the JSON. You will get:
     { content_type: "setup"|"tutorial"|"knowledge"|"article"|"reference"|"resource",
       source_type: string,
       confidence: number,
       reasoning: string }
   Keep content_type and source_type — you will use them below.

2. CLASSIFY CONTENT SECTIONS (only for setup OR tutorial, otherwise skip)
   Take \`prompts.classify_content\`. Replace {ALL_RAW_CONTENT} with the content from \`get_ingest_content(entry_id)\`.
   Run the prompt. Parse the JSON. Keep the full object — you will include
   it in the submit payload as \`content_classification\`.

3. GENERATE MANIFEST
   Take \`prompts.manifest_template\`. Replace:
     {ALL_RAW_CONTENT} → the content from \`get_ingest_content(entry_id)\`
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
     {ALL_RAW_CONTENT} → the content from \`get_ingest_content(entry_id)\`
     {MANIFEST_JSON}   → JSON.stringify(manifest, null, 2)
   Run. Keep the output markdown as \`readme\`.

5. GENERATE agents.md (SKIP if content_type is "resource")
   Pick a template from \`prompts.agents_md_templates\`:
     setup OR tutorial → \`setup\`
     knowledge OR article → \`knowledge\`
     reference → \`reference\`
   Replace:
     {ALL_RAW_CONTENT} → the content from \`get_ingest_content(entry_id)\`
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
