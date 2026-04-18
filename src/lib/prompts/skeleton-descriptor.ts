/**
 * Skeleton-tier descriptor prompt.
 *
 * Produces a structured-JSON writeup of a public GitHub repo from a single
 * Sonnet call. The skeleton tier carries no README/agents.md/manifest, so
 * this is the ONLY LLM artifact each entry has — title, summary, tags,
 * classification, and the descriptor markdown all come from this one call.
 *
 * Output is JSON because the entries / tags tables need typed fields, not
 * just markdown. The descriptor markdown still rides along as one field so
 * the entry detail page has prose to render.
 *
 * The descriptor itself must be task-AGNOSTIC: describe the repo in
 * isolation. It's what the agent sees at search time before it decides
 * whether to read the repo and propose a solution.
 *
 * Output quality rule: every section earns its place by helping an agent
 * rule repos in or out. Non-goals is the load-bearing section — it's how
 * the agent excludes bad matches when only descriptors are visible.
 */

export const SKELETON_DESCRIPTOR_PROMPT_VERSION = "skeleton-descriptor-v2";

const COMPLEXITY_VALUES = ["simple", "moderate", "complex", "advanced"] as const;
const CONTENT_TYPE_VALUES = [
  "setup",
  "tutorial",
  "knowledge",
  "article",
  "reference",
  "resource",
] as const;

export type SkeletonComplexity = (typeof COMPLEXITY_VALUES)[number];
export type SkeletonContentType = (typeof CONTENT_TYPE_VALUES)[number];

export interface SkeletonStructuredOutput {
  title: string;
  summary: string;
  use_case: string;
  complexity: SkeletonComplexity;
  content_type: SkeletonContentType;
  key_capabilities: string[];
  tags: { tag_type: string; tag_value: string }[];
  descriptor: string;
}

export const SKELETON_DESCRIPTOR_PROMPT = `You are writing a structured descriptor for a GitHub repository. This is the ONLY artifact an AI agent and a browsing user will see for this repo — they will not read the README. Your output decides whether the agent picks this repo for a user task and whether the user recognizes it on a browse card.

OUTPUT: a single JSON object. No prose before or after. No markdown code fences. The first character of your reply must be \`{\`. The fields are described below — every field is required, but you may emit empty arrays / strings where the source is genuinely silent.

{
  "title": "string — clean human-readable name (e.g. 'HyperFrames', 'LangChain', 'Claude Code'). Prefer the project's own branding from the README. Fall back to the repo name in proper case. Do NOT use 'owner/repo'. Max 80 chars.",
  "summary": "string — 1–2 sentences for browse cards. Concrete and specific. Lead with WHAT it is, not 'a tool that helps you...'. Max 280 chars.",
  "use_case": "string — single primary use case in snake_case. Pick one of: cold_outbound, lead_gen, content_creation, data_pipeline, monitoring, automation, agent_system, dev_tooling, customer_support, research, education, video_production, voice_audio, knowledge_management, code_generation, browser_automation, scraping, observability, security, infrastructure, other. Use the closest match — these are the established categories.",
  "complexity": "string — one of: simple | moderate | complex | advanced. Judge by setup difficulty AND conceptual difficulty. 'simple' = drop-in / single-file; 'moderate' = standard project setup; 'complex' = multi-service or non-trivial config; 'advanced' = deep domain expertise required.",
  "content_type": "string — one of: setup | tutorial | knowledge | article | reference | resource. Almost always 'setup' for an implementation repo. Use 'reference' only if the repo is documentation/specs without runnable code. Use 'resource' only for asset/data dumps.",
  "key_capabilities": ["array of 3–5 short strings, each ≤120 chars. The concrete things the repo can do — surfaced on browse cards. Action-led: 'Render HTML to MP4 deterministically', 'Stream tool calls with backpressure', etc."],
  "tags": [
    "array of 5–12 objects: { tag_type, tag_value }. Both lowercase, hyphen-separated for multi-word values.",
    "Valid tag_type values:",
    "  - 'tool': a named product/service the repo wraps or integrates (e.g. 'claude', 'supabase', 'puppeteer', 'gsap')",
    "  - 'platform': a hosting/runtime platform (e.g. 'vercel', 'aws', 'cloudflare', 'docker')",
    "  - 'framework': a software framework the repo builds on (e.g. 'nextjs', 'fastapi', 'langchain', 'react')",
    "  - 'pattern': an architectural pattern (e.g. 'mcp-server', 'rag', 'agent-loop', 'webhook', 'cron')",
    "  - 'integration': a specific service integration (e.g. 'slack-integration', 'stripe-integration')",
    "  - 'use_case': a sub-use-case beyond the primary (e.g. 'video-generation', 'screenshot-automation')",
    "Output ONLY the array — do not include these instruction lines as tags. Aim for high signal: tags an agent would search by."
  ],
  "descriptor": "string — markdown body for the entry detail page. Use the exact section structure below. Total ~300–450 words. Plain markdown, no JSON inside this field's value (escape newlines as \\\\n).\\n\\n## What it is\\nOne sentence. What kind of thing it is and the domain it operates in.\\n\\n## What it's used for\\n2–4 bullets. Concrete capabilities. Not marketing language.\\n\\n## Primary use cases\\n3–5 bullets. Actual scenarios a builder would adopt this for.\\n\\n## Tech stack\\nOne compact line: language, runtime, major framework, critical deps.\\n\\n## Non-goals\\n2–4 bullets. What this is NOT for. Adjacent problems it doesn't solve, platforms it doesn't support. This section prevents bad matches — be honest even when the README is silent.\\n\\n## Combines well with\\nOptional. 2–4 adjacent tools/repos this is commonly paired with. Only include when actually mentioned or strongly implied."
}

CRITICAL RULES:
- Describe the repo IN ISOLATION. No "you can use this to build your…" framing.
- Be specific. "Utility library" is useless; "X for parsing Y" earns its place.
- If a field's source material is genuinely missing, emit an empty array / empty string rather than padding.
- Output JSON only. No preamble, no trailing commentary, no \`\`\`json fences.

Source URL: {SOURCE_URL}

<repo_content>
{REPO_CONTENT}
</repo_content>

<repo_metadata>
{REPO_METADATA}
</repo_metadata>

Now output the JSON object. First character must be \`{\`.`;

export function buildSkeletonDescriptorPrompt(
  repoContent: string,
  repoMetadata: Record<string, unknown>,
  sourceUrl: string
): string {
  return SKELETON_DESCRIPTOR_PROMPT
    .replace("{REPO_CONTENT}", repoContent)
    .replace("{REPO_METADATA}", JSON.stringify(repoMetadata, null, 2))
    .replace("{SOURCE_URL}", sourceUrl || "Not available");
}

export const SKELETON_COMPLEXITY_VALUES = COMPLEXITY_VALUES;
export const SKELETON_CONTENT_TYPE_VALUES = CONTENT_TYPE_VALUES;

/**
 * Parse the LLM's JSON response into a typed structured output.
 *
 * Defensive against the common Claude-output failure modes:
 * - wrapping in ```json fences
 * - leading "Here is the JSON:" preamble
 * - trailing commentary
 * - invalid enum values for complexity / content_type
 *
 * Returns null only when the output isn't recoverable as JSON at all —
 * caller should retry the LLM call once before failing the entry.
 */
export function parseSkeletonStructuredOutput(
  raw: string
): SkeletonStructuredOutput | null {
  const sliced = sliceToJsonObject(raw);
  if (!sliced) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(sliced);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 80) : "";
  const summary =
    typeof obj.summary === "string" ? obj.summary.trim().slice(0, 280) : "";
  const use_case =
    typeof obj.use_case === "string" && obj.use_case.trim().length > 0
      ? obj.use_case.trim().toLowerCase()
      : "other";

  const complexity = COMPLEXITY_VALUES.includes(obj.complexity as SkeletonComplexity)
    ? (obj.complexity as SkeletonComplexity)
    : "moderate";

  const content_type = CONTENT_TYPE_VALUES.includes(
    obj.content_type as SkeletonContentType
  )
    ? (obj.content_type as SkeletonContentType)
    : "setup";

  const key_capabilities = Array.isArray(obj.key_capabilities)
    ? obj.key_capabilities
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 5)
    : [];

  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter(
          (t): t is { tag_type: unknown; tag_value: unknown } =>
            !!t && typeof t === "object"
        )
        .map((t) => ({
          tag_type:
            typeof t.tag_type === "string" ? t.tag_type.trim().toLowerCase() : "",
          tag_value:
            typeof t.tag_value === "string"
              ? t.tag_value.trim().toLowerCase()
              : "",
        }))
        .filter((t) => t.tag_type.length > 0 && t.tag_value.length > 0)
        // Limit before dedup — pathological output won't blow up downstream.
        .slice(0, 20)
    : [];

  const descriptor = typeof obj.descriptor === "string" ? obj.descriptor.trim() : "";

  // Title and descriptor are the two fields the entry detail page leans on
  // most; refuse the parse if they're empty so the caller can retry rather
  // than persist a row with a blank title.
  if (!title || descriptor.length < 80) return null;

  return {
    title,
    summary,
    use_case,
    complexity,
    content_type,
    key_capabilities,
    tags,
    descriptor,
  };
}

/**
 * Strip code fences, leading prose, and trailing prose to isolate the
 * outermost JSON object. Returns null if no balanced { … } region exists.
 */
function sliceToJsonObject(raw: string): string | null {
  let s = raw.trim();
  // Strip ```json … ``` or ``` … ``` fences.
  const fenceMatch = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) s = fenceMatch[1].trim();

  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return s.slice(start, end + 1);
}
