import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { IngestInput, ExtractedSource, ContentType } from "./types";
import { ModelTier } from "@/lib/ai";
import { extractText } from "./extractors/text";
import { extractWebContent, linkResultToSource } from "./extractors/web";
import { extractGitHubContent } from "./extractors/github";

import { extractTweetContent, isTweetUrl } from "./extractors/twitter";
import {
  extractInstagramContent,
  isInstagramPostUrl,
} from "./extractors/instagram";
import {
  extractRedditContent,
  isRedditPostUrl,
} from "./extractors/reddit";
// NOTE: the legacy generators (generators/manifest, generators/readme,
// generators/agents-md, generators/tags, generators/content-classifier,
// generators/content-type-classifier) have been deleted as part of the
// pivot to client-side synthesis. No code in this file or in the
// ingestion flow calls Claude on the server anymore — the agent runs
// prompts via prepare_ingest + submit_ingested_entry and POSTs artifacts
// back to us for embedding + persistence.
import { chunkAndEmbed } from "./embedder";
import { truncateContent } from "./utils";
import { ingestionProgress } from "./progress";
import { MAX_LINK_DEPTH, MAX_CONTENT_FOR_CLAUDE } from "@/lib/config";
import { slugifyEntryTitle, fallbackSlugFromId } from "@/lib/entries/slug";
// Credits removed — access is gated at the HTTP boundary via
// hasActiveAccess(), not via credit math. No refunds needed here.

const PIPELINE_TIMEOUT_MS = 10 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════
// Pipeline strategy — per-content-type behavior
// ════════════════════════════════════════════════════════════════════

interface PipelineStrategy {
  classifyContent: boolean;
  linkDepth: number;
  maxLinks: number;
  generateSecondaryArtifact: boolean;
  models: {
    classifier: ModelTier;
    contentClassifier: ModelTier;
    manifest: ModelTier;
    readme: ModelTier;
    secondary: ModelTier;
    tags: ModelTier;
  };
}

const PIPELINE_STRATEGIES: Record<ContentType, PipelineStrategy> = {
  setup: {
    classifyContent: true, linkDepth: MAX_LINK_DEPTH, maxLinks: 30, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "sonnet", manifest: "sonnet", readme: "sonnet", secondary: "sonnet", tags: "haiku" },
  },
  tutorial: {
    classifyContent: true, linkDepth: MAX_LINK_DEPTH, maxLinks: 30, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "sonnet", manifest: "sonnet", readme: "sonnet", secondary: "sonnet", tags: "haiku" },
  },
  knowledge: {
    classifyContent: false, linkDepth: 1, maxLinks: 10, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "haiku", manifest: "haiku", readme: "haiku", secondary: "haiku", tags: "haiku" },
  },
  article: {
    classifyContent: false, linkDepth: 1, maxLinks: 10, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "haiku", manifest: "haiku", readme: "haiku", secondary: "haiku", tags: "haiku" },
  },
  resource: {
    classifyContent: false, linkDepth: MAX_LINK_DEPTH, maxLinks: 30, generateSecondaryArtifact: false,
    models: { classifier: "haiku", contentClassifier: "haiku", manifest: "haiku", readme: "haiku", secondary: "haiku", tags: "haiku" },
  },
  reference: {
    classifyContent: false, linkDepth: 2, maxLinks: 15, generateSecondaryArtifact: true,
    models: { classifier: "haiku", contentClassifier: "haiku", manifest: "haiku", readme: "haiku", secondary: "haiku", tags: "haiku" },
  },
};

// ════════════════════════════════════════════════════════════════════
// Legacy ingestEntry / runPipeline / step* generators — REMOVED.
//
// This file previously exported `ingestEntry()` which kicked off a full
// server-side Claude pipeline. That path has been retired in favour of
// the agent-driven prepare_ingest + submit_ingested_entry flow. The
// surviving exports below (extractForAgent, persistAgentArtifacts,
// finalizeAgentEntry, plus the step* helpers they share with the old
// flow) are the complete server-side surface now.
// ════════════════════════════════════════════════════════════════════

/**
 * Remove a failed/partial entry from the common DB. Deletes child rows
 * explicitly in case FK cascades aren't fully wired up — so no orphaned
 * sources/tags/chunks/logs are left behind.
 */
export async function deleteFailedEntry(entryId: string): Promise<void> {
  try {
    // Children first (no-op if ON DELETE CASCADE is configured)
    await Promise.all([
      supabase.from("chunks").delete().eq("entry_id", entryId),
      supabase.from("sources").delete().eq("entry_id", entryId),
      supabase.from("tags").delete().eq("entry_id", entryId),
      supabase.from("ingestion_logs").delete().eq("entry_id", entryId),
    ]);
    await supabase.from("entries").delete().eq("id", entryId);
  } catch (err) {
    console.error(`[pipeline] Failed to delete partial entry ${entryId}:`, err);
  }
}

// ════════════════════════════════════════════════════════════════════
// Step functions
//
// NOTE: the legacy `runPipeline()` orchestrator was removed when we
// pivoted ingestion to the client-driven flow. The step functions below
// are still used — extractForAgent() runs fetch/extract/link-following
// during prepare_ingest, and stepGatherContent + storeSources are used
// during submit_ingested_entry to assemble + persist artifacts.
// ════════════════════════════════════════════════════════════════════

/**
 * Bail early when the initial extractor can't reach the source. Emits a
 * terminal "error" event (so the client's existing error path fires:
 * closes the skeleton entry panel, deletes the row, and posts an AI
 * chat message pointing the user at the Chrome extension) and throws
 * so the pipeline stops instead of silently continuing with empty
 * content for 30–120s before MIN_CONTENT_LENGTH finally catches it.
 *
 * Only called when `input.content.text` is empty — when the Chrome
 * extension already provided the page's text client-side, the pipeline
 * falls through to use that instead.
 */
function failUnreachable(
  entryId: string,
  url: string,
  platform: string
): never {
  const reason =
    `Couldn't fetch ${platform} content from ${url}. ` +
    `This usually means the link is paywalled, bot-blocked, deleted, ` +
    `or otherwise inaccessible from the server.`;
  ingestionProgress.emit(entryId, "error", reason, {
    details: { unreachable: true, platform, url },
  });
  throw new Error(reason);
}

/** Step 1.5: Auto-fetch from source platform (tweet/instagram/reddit). */
export async function stepPlatformFetch(
  entryId: string,
  input: IngestInput
): Promise<{ thumbnailUrl: string | null; updatedText?: string; updatedLinks?: string[] }> {
  let thumbnailUrl: string | null = null;

  if (input.content.text) return { thumbnailUrl };

  if (isTweetUrl(input.url)) {
    const stepStart = Date.now();
    await logStep(entryId, "tweet_fetch", "started");
    ingestionProgress.emit(entryId, "step_start", "Fetching tweet content...", { step: "tweet_fetch" });

    const tweetResult = await extractTweetContent(input.url);
    let updatedText: string | undefined;
    let updatedLinks: string[] | undefined;

    if (tweetResult) {
      updatedText = tweetResult.content;
      const existingLinks = input.content.links || [];
      updatedLinks = [...new Set([...existingLinks, ...tweetResult.childLinks])];
      const tweetSource = linkResultToSource(tweetResult, 0);
      await storeSources(entryId, [tweetSource]);
      thumbnailUrl = (tweetResult.metadata.thumbnail_url as string) || null;

      const meta = tweetResult.metadata;
      const photoCount = (tweetResult.content.match(/\[(\d+) image/)?.[1]) || "0";
      const linkCount = tweetResult.childLinks.length;
      const parts = [`Tweet from @${meta.author}`];
      if (parseInt(photoCount) > 0) parts.push(`${photoCount} image(s)`);
      if (linkCount > 0) parts.push(`${linkCount} link(s)`);
      if (meta.has_video) parts.push("video attached");
      ingestionProgress.emit(entryId, "detail", `Found: ${parts.join(", ")}`);
    } else {
      // No Chrome-extension fallback and the remote fetch failed — bail
      // now so the user sees a useful error instead of a hung panel.
      if (!input.content.text) {
        failUnreachable(entryId, input.url, "tweet");
      }
      ingestionProgress.emit(entryId, "detail", "Could not fetch tweet — will use provided content");
    }
    await logStep(entryId, "tweet_fetch", "completed", undefined, Date.now() - stepStart);
    ingestionProgress.emit(entryId, "step_complete", "Tweet content fetched", { step: "tweet_fetch" });
    return { thumbnailUrl, updatedText, updatedLinks };

  } else if (isInstagramPostUrl(input.url)) {
    if (!process.env.APIFY_API_KEY) {
      ingestionProgress.emit(entryId, "detail", "Warning: APIFY_API_KEY not set — Instagram post content cannot be extracted. Set this environment variable to enable Instagram ingestion.");
      return { thumbnailUrl };
    }

    const stepStart = Date.now();
    await logStep(entryId, "instagram_fetch", "started");
    ingestionProgress.emit(entryId, "step_start", "Fetching Instagram post...", { step: "instagram_fetch" });

    const igResult = await extractInstagramContent(input.url);
    let updatedText: string | undefined;
    let updatedLinks: string[] | undefined;

    if (igResult) {
      updatedText = igResult.content;
      const existingLinks = input.content.links || [];
      updatedLinks = [...new Set([...existingLinks, ...igResult.childLinks])];
      const igSource = linkResultToSource(igResult, 0);
      await storeSources(entryId, [igSource]);
      thumbnailUrl = (igResult.metadata.thumbnail_url as string) || null;

      const meta = igResult.metadata;
      const imageMatch = igResult.content.match(/\[(\d+) image/);
      const parts = [`Post from @${meta.author}`];
      if (imageMatch) parts.push(`${imageMatch[1]} image(s)`);
      if (meta.has_video) parts.push("video attached");
      if (igResult.childLinks.length > 0) parts.push(`${igResult.childLinks.length} link(s) in caption`);
      ingestionProgress.emit(entryId, "detail", `Found: ${parts.join(", ")}`);
    } else {
      if (!input.content.text) {
        failUnreachable(entryId, input.url, "Instagram post");
      }
      ingestionProgress.emit(entryId, "detail", "Could not fetch Instagram post — will use provided content");
    }
    await logStep(entryId, "instagram_fetch", "completed", undefined, Date.now() - stepStart);
    ingestionProgress.emit(entryId, "step_complete", "Instagram post fetched", { step: "instagram_fetch" });
    return { thumbnailUrl, updatedText, updatedLinks };

  } else if (isRedditPostUrl(input.url)) {
    const stepStart = Date.now();
    await logStep(entryId, "reddit_fetch", "started");
    ingestionProgress.emit(entryId, "step_start", "Fetching Reddit post...", { step: "reddit_fetch" });

    const redditResult = await extractRedditContent(input.url);
    let updatedText: string | undefined;
    let updatedLinks: string[] | undefined;

    if (redditResult) {
      updatedText = redditResult.content;
      const existingLinks = input.content.links || [];
      updatedLinks = [...new Set([...existingLinks, ...redditResult.childLinks])];
      const redditSource = linkResultToSource(redditResult, 0);
      await storeSources(entryId, [redditSource]);
      thumbnailUrl = (redditResult.metadata.thumbnail_url as string) || null;

      const meta = redditResult.metadata;
      const parts = [`Post from r/${meta.subreddit} by u/${meta.author}`];
      if (typeof meta.ups === "number") parts.push(`${meta.ups} upvotes`);
      if (typeof meta.num_comments === "number") parts.push(`${meta.num_comments} comments`);
      if (redditResult.childLinks.length > 0) parts.push(`${redditResult.childLinks.length} link(s)`);
      ingestionProgress.emit(entryId, "detail", `Found: ${parts.join(", ")}`);
    } else {
      if (!input.content.text) {
        failUnreachable(entryId, input.url, "Reddit post");
      }
      ingestionProgress.emit(entryId, "detail", "Could not fetch Reddit post — will use provided content");
    }
    await logStep(entryId, "reddit_fetch", "completed", undefined, Date.now() - stepStart);
    ingestionProgress.emit(entryId, "step_complete", "Reddit post fetched", { step: "reddit_fetch" });
    return { thumbnailUrl, updatedText, updatedLinks };

  } else if (input.url.includes("github.com")) {
    const stepStart = Date.now();
    await logStep(entryId, "github_fetch", "started");
    ingestionProgress.emit(entryId, "step_start", "Fetching GitHub content...", { step: "github_fetch" });

    const ghResult = await extractGitHubContent(input.url, 0);
    let updatedText: string | undefined;

    if (ghResult) {
      updatedText = ghResult.content;
      const ghSource = linkResultToSource(ghResult, 0);
      await storeSources(entryId, [ghSource]);
      thumbnailUrl = (ghResult.metadata.thumbnail_url as string) || null;

      const parts = [`GitHub repo: ${input.url}`];
      if (ghResult.metadata.stars) parts.push(`${ghResult.metadata.stars} stars`);
      if (ghResult.metadata.language) parts.push(`${ghResult.metadata.language}`);
      ingestionProgress.emit(entryId, "detail", `Found: ${parts.join(", ")}`);
    } else {
      if (!input.content.text) {
        failUnreachable(entryId, input.url, "GitHub");
      }
      ingestionProgress.emit(entryId, "detail", "Could not fetch GitHub content — will use provided content");
    }
    await logStep(entryId, "github_fetch", "completed", undefined, Date.now() - stepStart);
    ingestionProgress.emit(entryId, "step_complete", "GitHub content fetched", { step: "github_fetch" });
    return { thumbnailUrl, updatedText };
  }

  // Generic URL — fetch OG thumbnail via web extractor
  const stepStart = Date.now();
  await logStep(entryId, "web_fetch", "started");
  ingestionProgress.emit(entryId, "step_start", "Fetching web content...", { step: "web_fetch" });

  const webResult = await extractWebContent(input.url, 0);
  let updatedText: string | undefined;
  let updatedLinks: string[] | undefined;

  if (webResult) {
    updatedText = webResult.content;
    const existingLinks = input.content.links || [];
    updatedLinks = [...new Set([...existingLinks, ...webResult.childLinks])];
    const webSource = linkResultToSource(webResult, 0);
    await storeSources(entryId, [webSource]);
    thumbnailUrl = (webResult.metadata.thumbnail_url as string) || null;

    const parts = [`Web page: ${input.url}`];
    if (webResult.metadata.title) parts.push(`"${webResult.metadata.title}"`);
    ingestionProgress.emit(entryId, "detail", `Found: ${parts.join(", ")}`);
  } else {
    if (!input.content.text) {
      failUnreachable(entryId, input.url, "web page");
    }
    ingestionProgress.emit(entryId, "detail", "Could not fetch web content — will use provided content");
  }

  await logStep(entryId, "web_fetch", "completed", undefined, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", "Web content fetched", { step: "web_fetch" });
  return { thumbnailUrl, updatedText, updatedLinks };
}

/** Step 2: Extract text content and store sources. */
export async function stepTextExtraction(
  entryId: string,
  text: string
): Promise<{ textSources: ExtractedSource[] }> {
  const stepStart = Date.now();
  await logStep(entryId, "text_extraction", "started");
  ingestionProgress.emit(entryId, "step_start", "Analyzing text with Claude...", { step: "text_extraction" });

  const textSources = await extractText(text);
  await storeSources(entryId, textSources);

  const linksFound = textSources.flatMap((s) => s.childLinks || []);
  if (linksFound.length > 0) {
    ingestionProgress.emit(entryId, "detail", `Extracted ${linksFound.length} URL(s) from text`);
  }

  await logStep(entryId, "text_extraction", "completed", undefined, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", "Text analysis complete", { step: "text_extraction" });

  return { textSources };
}

// stepDetectContentType and stepImageProcessing removed — both were
// internal to the deleted runPipeline. The agent now runs content-type
// classification and image vision prompts in its own context during the
// prepare_ingest → submit_ingested_entry flow.

/** Step 4: Follow links recursively and extract content. */
export async function stepLinkFollowing(
  entryId: string,
  input: IngestInput,
  textSources: ExtractedSource[],
  thumbnailUrl: string | null,
  strategy: PipelineStrategy
): Promise<{ thumbnailUrl: string | null }> {
  const allLinks = [
    ...(input.content.links || []),
    ...textSources.flatMap((s) => s.childLinks || []),
  ];
  const uniqueLinks = [...new Set(allLinks)];

  if (uniqueLinks.length === 0) return { thumbnailUrl };

  const { maxLinks, linkDepth } = strategy;

  const stepStart = Date.now();
  await logStep(entryId, "link_following", "started");
  ingestionProgress.emit(
    entryId,
    "step_start",
    `Following ${Math.min(uniqueLinks.length, maxLinks)} link(s) (depth: ${linkDepth})...`,
    { step: "link_following" }
  );

  const visitedUrls = new Set<string>();
  const linksFollowed = { count: 0 };
  const LINK_CONCURRENCY = 5;

  for (let i = 0; i < uniqueLinks.length; i += LINK_CONCURRENCY) {
    if (linksFollowed.count >= maxLinks) {
      ingestionProgress.emit(
        entryId,
        "detail",
        `Link budget reached (${maxLinks} max) — stopping`
      );
      break;
    }
    const batch = uniqueLinks.slice(i, i + LINK_CONCURRENCY);
    await Promise.allSettled(
      batch.map((link) =>
        followAndStore(entryId, link, 1, visitedUrls, linksFollowed, linkDepth, maxLinks)
      )
    );
  }

  // Try to grab a thumbnail from extracted sources if we don't have one yet
  if (!thumbnailUrl) {
    const { data: sources } = await supabase
      .from("sources")
      .select("content_metadata")
      .eq("entry_id", entryId)
      .not("content_metadata", "is", null)
      .limit(20);
    for (const s of sources || []) {
      const meta = s.content_metadata as Record<string, unknown> | null;
      if (meta?.thumbnail_url && typeof meta.thumbnail_url === "string") {
        thumbnailUrl = meta.thumbnail_url;
        break;
      }
    }
  }

  await logStep(entryId, "link_following", "completed", {
    links_followed: linksFollowed.count,
    links_found: uniqueLinks.length,
  }, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", `Followed ${linksFollowed.count} link(s)`, { step: "link_following" });

  return { thumbnailUrl };
}

/** Step 5: Gather all content from DB (no Claude call). */
export async function stepGatherContent(
  entryId: string
): Promise<{ allContent: string; contentForClaude: string }> {
  const allContent = await gatherAllContent(entryId);
  const contentForClaude = truncateContent(allContent, MAX_CONTENT_FOR_CLAUDE);

  ingestionProgress.emit(
    entryId,
    "detail",
    `Gathered ${Math.round(allContent.length / 1000)}K characters of content`
  );

  return { allContent, contentForClaude };
}

// ════════════════════════════════════════════════════════════════════
// Legacy per-step Claude generators — REMOVED.
//
// stepClassifyContent, stepGenerateManifest, stepGenerateReadme,
// stepGenerateSecondaryArtifact, stepGenerateTags, stepPersistEntry,
// and stepChunkAndEmbed were all stages of the old runPipeline flow
// that ran Claude / persisted artifacts server-side. They've been
// replaced by the agent-driven prepare_ingest → submit_ingested_entry
// pair: the agent runs every LLM prompt in its own context, then
// POSTs the finished artifacts to /api/ingest/submit which persists
// them (via persistAgentArtifacts) and embeds the chunks.
// ════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════
// Helper functions
// ════════════════════════════════════════════════════════════════════

async function followAndStore(
  entryId: string,
  url: string,
  depth: number,
  visitedUrls: Set<string>,
  linksFollowed: { count: number },
  maxDepth: number = MAX_LINK_DEPTH,
  maxLinks: number = 30
): Promise<void> {
  if (
    depth > maxDepth ||
    visitedUrls.has(url) ||
    linksFollowed.count >= maxLinks
  ) {
    return;
  }

  visitedUrls.add(url);
  linksFollowed.count++;

  // Describe what we're doing
  const shortUrl = url.length > 80 ? url.slice(0, 77) + "..." : url;
  let description = `Following: ${shortUrl}`;
  if (isTweetUrl(url)) description = `Following tweet: ${shortUrl}`;
  else if (isInstagramPostUrl(url)) description = `Following Instagram post: ${shortUrl}`;
  else if (isRedditPostUrl(url)) description = `Following Reddit post: ${shortUrl}`;
  else if (url.includes("github.com")) description = `Following GitHub: ${shortUrl}`;

  ingestionProgress.emit(entryId, "detail", description);

  let result;
  try {
    if (isTweetUrl(url)) {
      result = await extractTweetContent(url, depth);
    } else if (isInstagramPostUrl(url)) {
      result = await extractInstagramContent(url, depth);
    } else if (isRedditPostUrl(url)) {
      result = await extractRedditContent(url, depth);
    } else if (url.includes("github.com")) {
      result = await extractGitHubContent(url, depth);
    } else {
      result = await extractWebContent(url, depth);
    }
  } catch (error) {
    console.error(`[pipeline] Extractor failed for ${url}:`, error);
    ingestionProgress.emit(entryId, "detail", `Failed to extract: ${shortUrl}`);
    return;
  }

  if (!result) {
    ingestionProgress.emit(entryId, "detail", `No content extracted from: ${shortUrl}`);
    return;
  }

  const source = linkResultToSource(result, depth);
  await storeSources(entryId, [source]);

  // Describe what we found
  const contentLen = result.content.length;
  const childCount = result.childLinks.length;
  const parts = [`${Math.round(contentLen / 1000)}K chars`];
  if (childCount > 0) parts.push(`${childCount} child link(s)`);
  ingestionProgress.emit(entryId, "detail", `Extracted from ${shortUrl}: ${parts.join(", ")}`);

  // Recursively follow child links
  for (const childLink of result.childLinks.slice(0, 5)) {
    if (linksFollowed.count >= maxLinks) break;
    await followAndStore(
      entryId,
      childLink,
      depth + 1,
      visitedUrls,
      linksFollowed,
      maxDepth,
      maxLinks
    );
  }
}

export async function storeSources(
  entryId: string,
  sources: ExtractedSource[]
): Promise<void> {
  if (sources.length === 0) return;

  const rows = sources.map((source) => ({
    entry_id: entryId,
    url: source.url || null,
    source_type: source.sourceType,
    raw_content: source.rawContent,
    extracted_content: source.extractedContent || null,
    content_metadata: source.contentMetadata || null,
    depth: source.depth,
  }));

  const { error } = await supabase.from("sources").insert(rows);

  if (error) {
    // PostgrestError has code / details / hint in addition to message.
    // The previous bubble only included `.message`, which drops the
    // constraint name and the column/value that caused the violation —
    // exactly the info you need to fix it. Surface all four fields in
    // logs and in the thrown error's message.
    const shapeSummary = sources.map((s) => ({
      url: s.url,
      source_type: s.sourceType,
      raw_content_len: s.rawContent?.length ?? null,
      extracted_content_len: s.extractedContent?.length ?? null,
      content_metadata_len: s.contentMetadata
        ? JSON.stringify(s.contentMetadata).length
        : null,
    }));
    console.error(
      `[pipeline] Failed to store ${sources.length} source(s) for entry ${entryId}:`,
      {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        rows: shapeSummary,
      }
    );
    const detail = [
      error.code ? `code=${error.code}` : null,
      error.details ? `details=${error.details}` : null,
      error.hint ? `hint=${error.hint}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    const suffix = detail ? ` (${detail})` : "";
    throw new Error(
      `Database write failed for sources: ${error.message}${suffix}`
    );
  }
}

/**
 * Generate a URL-safe slug for an entry.
 * - Slugifies the title and resolves collisions against the existing slugs
 *   in the `entries` table (excluding the current row, so re-ingestion of
 *   an existing entry keeps its slug if possible).
 * - Falls back to entry-<short uuid> when the title is empty/missing.
 */
async function generateEntrySlug(
  entryId: string,
  title: string
): Promise<string> {
  const { data: existing } = await supabase
    .from("entries")
    .select("slug")
    .neq("id", entryId);

  const existingSlugs = (existing || [])
    .map((r) => (r as { slug: string | null }).slug)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  if (!title || title.trim() === "" || title === "Untitled") {
    const fallback = fallbackSlugFromId(entryId);
    // The UUID-derived fallback is deterministic; collisions only happen if
    // a previous row shared the exact same 8-char prefix, which is astronomically
    // unlikely but handle it anyway.
    if (!existingSlugs.includes(fallback)) return fallback;
    return slugifyEntryTitle(fallback, existingSlugs);
  }

  return slugifyEntryTitle(title, existingSlugs);
}

async function gatherAllContent(entryId: string): Promise<string> {
  const { data: sources } = await supabase
    .from("sources")
    .select("*")
    .eq("entry_id", entryId)
    .order("depth", { ascending: true })
    .limit(200);

  if (!sources || sources.length === 0) return "";

  const parts = sources.map((s) => {
    const header = `--- [${s.source_type}] ${s.url || "inline"} (depth: ${s.depth}) ---`;
    const content = s.extracted_content || s.raw_content || "";
    return `${header}\n${content}`;
  });

  return parts.join("\n\n");
}

export function detectPlatform(url: string): string {
  if (isTweetUrl(url)) return "x";
  if (isInstagramPostUrl(url)) return "instagram";
  if (isRedditPostUrl(url)) return "reddit";
  if (url.includes("github.com")) return "github";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("news.ycombinator.com")) return "hackernews";
  if (url.includes("stackoverflow.com")) return "stackoverflow";
  if (url.includes("medium.com")) return "medium";
  if (url.includes("substack.com") || url.includes(".substack.")) return "substack";
  if (url.includes("dev.to")) return "devto";
  if (url.includes("arxiv.org")) return "arxiv";

  return "web";
}

// NOTE: getSecondaryArtifactLabel + getSecondaryArtifactFilename were
// helpers for the removed stepGenerateSecondaryArtifact. Deleted — no
// live callers.

export async function logStep(
  entryId: string,
  step: string,
  status: "started" | "completed" | "error",
  details?: Record<string, unknown>,
  durationMs?: number
): Promise<void> {
  await supabase.from("ingestion_logs").insert({
    entry_id: entryId,
    step,
    status,
    details: details || null,
    duration_ms: durationMs || null,
  });
}

// ════════════════════════════════════════════════════════════════════
// Agent-driven ingest — exposed helpers for /api/ingest/prepare and
// /api/ingest/submit. Fetching stays on the server; AI generation runs
// in the user's Claude Code. See docs in src/lib/ingestion/agent-bundle.ts
// and the plan file for the full contract.
// ════════════════════════════════════════════════════════════════════

/**
 * Run the fetch + link-follow + gather phases of the pipeline without
 * touching Claude/OpenAI. Called by /api/ingest/prepare.
 *
 * Preserves every source-table write the legacy pipeline performs, so a
 * later submit_ingested_entry call lands in an entry row that is
 * indistinguishable from one produced by `ingestEntry` except that the
 * AI-generated columns come from the agent's output instead of ours.
 *
 * Uses the "setup" pipeline strategy for link-following (max 30 links,
 * max depth = MAX_LINK_DEPTH) because content type isn't classified until
 * the agent runs its own prompt — using the most generous strategy means
 * we don't under-fetch content the agent might later want.
 */
export async function extractForAgent(
  entryId: string,
  input: IngestInput
): Promise<{
  gatheredContent: string;
  thumbnailUrl: string | null;
  sourcePlatform: string;
}> {
  const sourcePlatform = detectPlatform(input.url);

  const fetchResult = await stepPlatformFetch(entryId, input);
  let thumbnailUrl = fetchResult.thumbnailUrl;
  if (fetchResult.updatedText !== undefined) {
    input.content.text = fetchResult.updatedText;
  }
  if (fetchResult.updatedLinks !== undefined) {
    input.content.links = fetchResult.updatedLinks;
  }

  const { textSources } = await stepTextExtraction(
    entryId,
    input.content.text || ""
  );

  // Use setup-tier link-following aggressiveness. The agent can ignore
  // content it doesn't need, but we can't re-fetch after the fact.
  const strategy = PIPELINE_STRATEGIES.setup;
  const linkResult = await stepLinkFollowing(
    entryId,
    input,
    textSources,
    thumbnailUrl,
    strategy
  );
  thumbnailUrl = linkResult.thumbnailUrl;

  const { allContent } = await stepGatherContent(entryId);

  return {
    gatheredContent: allContent,
    thumbnailUrl,
    sourcePlatform,
  };
}

/**
 * Persist an entry's agent-generated artifacts. Called by /api/ingest/submit.
 *
 * Mirrors the column set written by `stepPersistEntry` exactly:
 *   - UPDATE entries with title, summary, use_case, complexity, content_type,
 *     thumbnail_url, readme, agents_md, manifest, raw_content, slug,
 *     ingested_at, updated_at.
 *   - INSERT tags rows ({entry_id, tag_type, tag_value}) for every tag.
 *   - Slug collision retry loop, same 5-attempt strategy + random suffix.
 *
 * Leaves `status` as "processing" — caller flips it to "complete" after
 * embeddings finish (same split the legacy pipeline uses).
 *
 * Throws on DB failure so the caller can refund credits + delete the entry.
 */
export async function persistAgentArtifacts(args: {
  entryId: string;
  sourceUrl: string;
  manifest: Record<string, unknown>;
  readme: string;
  agentsMd: string;
  tags: Array<{ tag_type: string; tag_value: string }>;
  gatheredContent: string;
  thumbnailUrl: string | null;
  contentType: ContentType;
}): Promise<{ slug: string }> {
  const {
    entryId,
    sourceUrl,
    manifest,
    readme,
    agentsMd,
    tags,
    gatheredContent,
    thumbnailUrl: initialThumbnail,
    contentType,
  } = args;

  const title = (manifest as Record<string, string>).title || "Untitled";
  const summary = (manifest as Record<string, string>).description || "";
  const useCase =
    ((manifest as Record<string, Record<string, string>>).use_case
      ?.primary as string) || "other";
  const complexity =
    (manifest as Record<string, string>).complexity || "moderate";

  // Same thumbnail-fallback ladder as the legacy path.
  let thumbnailUrl = initialThumbnail;
  if (!thumbnailUrl && sourceUrl.includes("github.com")) {
    const ghMatch = sourceUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (ghMatch) {
      const params = new URLSearchParams({
        owner: ghMatch[1],
        repo: ghMatch[2],
      });
      thumbnailUrl = `/api/og/github?${params.toString()}`;
    }
  }
  if (!thumbnailUrl && sourceUrl) {
    thumbnailUrl = `https://image.thum.io/get/${encodeURI(sourceUrl)}`;
  }

  // Same slug retry loop as legacy stepPersistEntry.
  const initialSlug = await generateEntrySlug(entryId, title);
  const maxAttempts = 5;
  let candidate = initialSlug;
  let finalSlug: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { error } = await supabase
      .from("entries")
      .update({
        title,
        summary,
        use_case: useCase,
        complexity,
        content_type: contentType,
        thumbnail_url: thumbnailUrl,
        readme,
        agents_md: agentsMd || null,
        manifest,
        raw_content: { gathered: gatheredContent },
        slug: candidate,
        status: "processing",
        ingested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId);

    if (!error) {
      finalSlug = candidate;
      break;
    }

    // 23505 = unique_violation on slug. Retry with a random suffix.
    if ((error as { code?: string }).code === "23505") {
      const suffix = Math.random().toString(36).slice(2, 6);
      candidate = `${initialSlug}-${suffix}`;
      continue;
    }

    throw new Error(`Failed to update entry: ${error.message}`);
  }

  if (!finalSlug) {
    throw new Error(
      `Failed to assign a unique slug for entry ${entryId} after ${maxAttempts} attempts`
    );
  }

  if (tags.length > 0) {
    const tagRows = tags.map((t) => ({
      entry_id: entryId,
      tag_type: t.tag_type,
      tag_value: t.tag_value,
    }));
    const { error: tagError } = await supabase.from("tags").insert(tagRows);
    if (tagError) {
      // Legacy pipeline treats tag insert failure as non-fatal; match that so
      // a bad tag row doesn't poison an otherwise-good ingest.
      console.error("[pipeline] Failed to store tags:", tagError);
    }
  }

  return { slug: finalSlug };
}

/**
 * Flip an entry's status to "complete" and write the final pipeline_complete
 * log. Called by /api/ingest/submit after embeddings land.
 *
 * Also fires the first_ingest_completed conversion event the first time
 * a given user reaches completion (for the launch-metrics funnel).
 */
export async function finalizeAgentEntry(entryId: string): Promise<void> {
  await supabase
    .from("entries")
    .update({
      status: "complete",
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  await logStep(entryId, "pipeline_complete", "completed");

  // Fire first_ingest_completed event. Best-effort — lookup the owner
  // and skip silently if we can't resolve it.
  try {
    const { data: entry } = await supabase
      .from("entries")
      .select("ingested_by")
      .eq("id", entryId)
      .single();
    const userId = entry?.ingested_by as string | null;
    if (userId) {
      const { logConversionEvent, hasFiredEvent } = await import(
        "@/lib/analytics/conversion-events"
      );
      const already = await hasFiredEvent(userId, "first_ingest_completed");
      if (!already) {
        await logConversionEvent({
          userId,
          eventType: "first_ingest_completed",
          metadata: { entry_id: entryId },
        });
      }
    }
  } catch {
    // Never block pipeline completion on event logging.
  }
}
