/**
 * Skeleton-tier descriptor prompt.
 *
 * Used at mass-ingestion time to produce a short, strictly structured
 * natural-language writeup of what a GitHub repo is and what it's for.
 * This is the ONLY LLM artifact skeleton entries carry — there is no
 * README, agents.md, or manifest generation at this tier.
 *
 * The descriptor must be task-AGNOSTIC: describe the repo in isolation.
 * It's what the agent sees at search time before it decides whether to
 * read the repo and propose a solution.
 *
 * Output quality rule: every section earns its place by helping an agent
 * rule repos in or out. Non-goals is the load-bearing section — it's how
 * the agent excludes bad matches when only descriptors are visible.
 */

export const SKELETON_DESCRIPTOR_PROMPT_VERSION = "skeleton-descriptor-v1";

export const SKELETON_DESCRIPTOR_PROMPT = `You are writing a short descriptor for a GitHub repository. This descriptor is the ONLY thing an AI agent sees at search time to decide whether this repo is relevant to a user's task.

CRITICAL RULES:
- Describe the repo IN ISOLATION. Do NOT infer or imagine a "user's project" context. No "you can use this to build your…" framing.
- Be specific. "Utility library" is useless; "X for parsing Y" earns its place.
- If you can't fill a section honestly from the source material, omit it. Do not pad.
- No preamble, no trailing remarks. Output the markdown only.
- Target length: ~300–450 words total.

OUTPUT STRUCTURE — use these exact headings, omit any section you truly can't fill:

## What it is
One sentence. What kind of thing it is (library / CLI / framework / template / service / skill pack / etc.) and the domain it operates in.

## What it's used for
2–4 bullets. Each bullet: a concrete capability the repo provides. Not marketing language.

## Primary use cases
3–5 bullets. Actual scenarios a builder would adopt this repo for. Be specific about the kind of project or integration.

## Tech stack
Language, runtime, major framework, and any critical dependencies or integrations (databases, APIs, platforms). One compact line.

## Non-goals
2–4 bullets. Things this repo is NOT for. Includes adjacent problems it deliberately doesn't solve, platforms it doesn't support, scales it's not intended for. This section prevents bad matches — be honest even when the README is silent on boundaries.

## Combines well with
Optional. 2–4 adjacent tools / repos / concepts this is commonly paired with. Only include when actually mentioned or strongly implied by the source.

Source URL: {SOURCE_URL}

<repo_content>
{REPO_CONTENT}
</repo_content>

<repo_metadata>
{REPO_METADATA}
</repo_metadata>

Write the descriptor now. Markdown only, no commentary.`;

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
