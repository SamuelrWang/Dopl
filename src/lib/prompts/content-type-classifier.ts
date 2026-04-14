export const CONTENT_TYPE_CLASSIFIER_PROMPT = `Classify this social media post about AI/automation into one of three content types.

<post_content>
{POST_TEXT}
</post_content>

## Content Types

**setup** — The post describes a specific implementation that someone could replicate. Signals:
- Code snippets, configs, or commands
- "Here's how I built…" or "Step-by-step guide to…"
- Specific tool combinations with implementation details
- Prompts or templates meant to be copied
- GitHub repos with setup/install instructions
- n8n workflows, MCP servers, agent architectures with concrete details

**knowledge** — The post explains a concept, shares insight, or educates without a specific replicable setup. Signals:
- "How X works", "Why X matters", "X vs Y comparison"
- Opinions, analysis, predictions about AI/tech
- Best practices discussed at a high level (no specific code)
- Explanations of techniques (RAG, fine-tuning, embeddings, etc.)
- Industry trends, news commentary
- Tips/tricks that are conceptual rather than step-by-step

**resource** — The post is primarily pointing to an external tool, repo, or document. The post text is thin but the linked resource has the real value. Signals:
- Short post text (< 200 words) with a prominent URL
- "Check out this…", "Just discovered…", "This repo is amazing…"
- The post is essentially a recommendation/share, not original content
- The linked URL (GitHub, docs, product page) is the main attraction

## Rules
- If the post has BOTH knowledge AND setup elements, classify as **setup** (we want to preserve the implementation details)
- If unsure, default to **setup** (it's the most thorough pipeline)
- A post that shares a GitHub repo WITH explanation of how to use it = **setup**
- A post that shares a GitHub repo with just "this is cool" = **resource**

Respond with ONLY this JSON:
{
  "content_type": "setup" | "knowledge" | "resource",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why"
}`;

export function buildContentTypeClassifierPrompt(postText: string): string {
  return CONTENT_TYPE_CLASSIFIER_PROMPT.replace("{POST_TEXT}", postText);
}
