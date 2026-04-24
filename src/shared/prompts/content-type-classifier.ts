export const CONTENT_TYPE_CLASSIFIER_PROMPT = `Classify this content into one of six content types. The content can be from any source — a blog post, news article, GitHub repo, social media post, documentation page, forum discussion, or any other URL.

<content>
{POST_TEXT}
</content>

## Content Types

**setup** — A specific implementation that someone could replicate. Signals:
- Code snippets, configs, or commands
- "Here's how I built…" or "Step-by-step guide to…"
- Specific tool combinations with implementation details
- Prompts or templates meant to be copied
- GitHub repos with setup/install instructions
- Workflows, servers, agent architectures with concrete details

**tutorial** — Educational walkthrough that teaches a concept through guided steps, but isn't a specific "copy this setup" implementation. Signals:
- "How to build…", "Getting started with…", "Learn to…"
- Step-by-step teaching with explanations of WHY each step matters
- Focus on learning and understanding, not just replicating
- May include code examples but as illustrations, not as a complete setup
- Course materials, guided exercises, workshop content

**knowledge** — Explains a concept, shares insight, or educates without a specific replicable setup. Signals:
- "How X works", "Why X matters", "X vs Y comparison"
- Opinions, analysis, predictions about technology
- Best practices discussed at a high level (no specific code)
- Explanations of techniques, architectures, or concepts
- Industry trends, commentary, deep dives

**article** — News reporting, opinion pieces, analysis, or commentary from publications and blogs. Signals:
- Published by a news outlet, magazine, or editorial blog
- Reports on events, announcements, research findings
- Author byline, publication date, editorial structure
- Journalism: interviews, investigations, reviews
- HackerNews discussions, forum threads with substantive debate

**reference** — Documentation, API references, specification pages, or technical reference material. Signals:
- API documentation, SDK references, man pages
- Specification documents, RFCs, standards
- Configuration reference tables, parameter lists
- Official product/tool documentation
- Structured technical reference meant for repeated lookup

**resource** — Primarily pointing to an external tool, repo, or document. The content is thin but the linked resource has the real value. Signals:
- Short content (< 200 words) with a prominent URL
- "Check out this…", "Just discovered…", "This is amazing…"
- Essentially a recommendation/share, not original content

## Rules
- If the content has BOTH knowledge AND setup elements, classify as **setup** (preserves implementation details)
- If unsure between article and knowledge, prefer **knowledge** (better extraction pipeline)
- A GitHub repo WITH explanation of how to use it = **setup**
- A GitHub repo with just "this is cool" = **resource**
- News about a product launch = **article**
- Documentation pages = **reference**
- Default to **knowledge** if truly ambiguous (good general-purpose pipeline)

Respond with ONLY this JSON:
{
  "content_type": "setup" | "tutorial" | "knowledge" | "article" | "reference" | "resource",
  "source_type": "blog_post" | "news_article" | "github_repo" | "social_media_post" | "documentation" | "forum_discussion" | "video_transcript" | "academic_paper" | "product_page" | "other",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why"
}`;

export function buildContentTypeClassifierPrompt(postText: string): string {
  return CONTENT_TYPE_CLASSIFIER_PROMPT.replace("{POST_TEXT}", postText);
}
