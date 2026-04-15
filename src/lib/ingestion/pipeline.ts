import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { IngestInput, ExtractedSource, ContentType } from "./types";
import { extractText } from "./extractors/text";
import { extractImage } from "./extractors/image";
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
import { generateManifest } from "./generators/manifest";
import { generateReadme } from "./generators/readme";
import { generateAgentsMd } from "./generators/agents-md";
import { generateTags } from "./generators/tags";
import { classifyContent, ContentClassification } from "./generators/content-classifier";
import { classifyContentType } from "./generators/content-type-classifier";
import { chunkAndEmbed } from "./embedder";
import { truncateContent } from "./utils";
import { ingestionProgress } from "./progress";
import { MAX_LINK_DEPTH, MAX_CONTENT_FOR_CLAUDE, MAX_IMAGES_PER_ENTRY } from "@/lib/config";

const MAX_LINKS_PER_ENTRY = 30;
const KNOWLEDGE_MAX_LINKS = 10;
const KNOWLEDGE_MAX_LINK_DEPTH = 1;
const PIPELINE_TIMEOUT_MS = 10 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════
// Public entry point
// ════════════════════════════════════════════════════════════════════

/**
 * Start the ingestion pipeline. Creates the entry record and returns the ID
 * immediately. The pipeline runs in the background — clients should connect
 * to the SSE stream at /api/ingest/{id}/stream to watch progress.
 */
export async function ingestEntry(input: IngestInput): Promise<string> {
  const { data: entry, error: createError } = await supabase
    .from("entries")
    .insert({
      source_url: input.url,
      source_platform: detectPlatform(input.url),
      status: "processing",
    })
    .select("id")
    .single();

  if (createError || !entry) {
    throw new Error(`Failed to create entry: ${createError?.message}`);
  }

  const entryId = entry.id;

  // Run pipeline in the background — don't await
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Pipeline timed out after ${PIPELINE_TIMEOUT_MS}ms`)),
      PIPELINE_TIMEOUT_MS
    )
  );

  Promise.race([runPipeline(entryId, input), timeoutPromise]).catch(
    async (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await supabase
        .from("entries")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", entryId);
      await logStep(entryId, "pipeline_error", "error", {
        error: errorMessage,
      });
      ingestionProgress.emit(
        entryId,
        "error",
        `Ingestion failed: ${errorMessage}`
      );
      console.error(`[pipeline] Entry ${entryId} failed:`, errorMessage);
    }
  );

  return entryId;
}

// ════════════════════════════════════════════════════════════════════
// Pipeline orchestrator
// ════════════════════════════════════════════════════════════════════

async function runPipeline(
  entryId: string,
  input: IngestInput
): Promise<void> {
  await logStep(entryId, "pipeline_start", "started");
  ingestionProgress.emit(entryId, "info", `Starting ingestion for ${input.url}`);

  // ── Extract content from source ──
  const fetchResult = await stepPlatformFetch(entryId, input);
  let thumbnailUrl = fetchResult.thumbnailUrl;
  if (fetchResult.updatedText !== undefined) input.content.text = fetchResult.updatedText;
  if (fetchResult.updatedLinks !== undefined) input.content.links = fetchResult.updatedLinks;

  const { textSources } = await stepTextExtraction(entryId, input.content.text || "");

  // ── Detect content type (setup / knowledge / resource) ──
  const contentType = await stepDetectContentType(entryId, input.content.text || "");

  await stepImageProcessing(entryId, input.content.images);

  const linkResult = await stepLinkFollowing(entryId, input, textSources, thumbnailUrl, contentType);
  thumbnailUrl = linkResult.thumbnailUrl;

  // ── Gather content ──
  const { allContent, contentForClaude } = await stepGatherContent(entryId);

  // ── Branch generation based on content type ──
  let manifest: Record<string, unknown>;
  let readme: string;
  let agentsMd: string;
  let tags: Array<{ tag_type: string; tag_value: string }>;

  if (contentType === "knowledge") {
    // Knowledge branch — no content classification, no agents.md
    ingestionProgress.emit(entryId, "detail", "Knowledge content detected — using knowledge-optimized pipeline");

    ({ manifest } = await stepGenerateManifest(entryId, contentForClaude, contentType, { thumbnailUrl, sourceUrl: input.url }));
    [{ readme }, { tags }] = await Promise.all([
      stepGenerateReadme(entryId, contentForClaude, manifest, contentType),
      stepGenerateTags(entryId, manifest),
    ]);
    agentsMd = "";
  } else {
    // Setup / Resource branch — full pipeline
    const [classificationResult, manifestResult] = await Promise.all([
      stepClassifyContent(entryId, contentForClaude),
      stepGenerateManifest(entryId, contentForClaude, contentType, { thumbnailUrl, sourceUrl: input.url }),
    ]);
    manifest = manifestResult.manifest;
    const classification = classificationResult.classification;

    [{ readme }, { tags }] = await Promise.all([
      stepGenerateReadme(entryId, contentForClaude, manifest, contentType),
      stepGenerateTags(entryId, manifest),
    ]);
    ({ agentsMd } = await stepGenerateAgentsMd(entryId, contentForClaude, manifest, readme, classification, input.url));
  }

  // ── Persist ──
  await stepPersistEntry(entryId, input, manifest, readme, agentsMd, tags, allContent, thumbnailUrl, contentType);
  await stepChunkAndEmbed(entryId, readme, agentsMd, allContent);

  // Mark complete only after ALL steps succeed (including embeddings)
  await supabase
    .from("entries")
    .update({ status: "complete", updated_at: new Date().toISOString() })
    .eq("id", entryId);

  // ── Done ──
  await logStep(entryId, "pipeline_complete", "completed");
  const title = (manifest as Record<string, string>).title || "Untitled";
  const useCase = ((manifest as Record<string, Record<string, string>>).use_case?.primary as string) || "other";
  const complexity = (manifest as Record<string, string>).complexity || "moderate";
  ingestionProgress.emit(entryId, "complete", `Ingestion complete — "${title}" [${contentType}]`, {
    details: { entry_id: entryId, title, use_case: useCase, complexity, content_type: contentType },
  });
}

// ════════════════════════════════════════════════════════════════════
// Step functions
// ════════════════════════════════════════════════════════════════════

/** Step 1.5: Auto-fetch from source platform (tweet/instagram/reddit). */
async function stepPlatformFetch(
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
      ingestionProgress.emit(entryId, "detail", "Could not fetch GitHub content — will use provided content");
    }
    await logStep(entryId, "github_fetch", "completed", undefined, Date.now() - stepStart);
    ingestionProgress.emit(entryId, "step_complete", "GitHub content fetched", { step: "github_fetch" });
    return { thumbnailUrl, updatedText };
  }

  return { thumbnailUrl };
}

/** Step 2: Extract text content and store sources. */
async function stepTextExtraction(
  entryId: string,
  text: string
): Promise<{ textSources: ExtractedSource[] }> {
  const stepStart = Date.now();
  await logStep(entryId, "text_extraction", "started");
  ingestionProgress.emit(entryId, "step_start", "Analyzing post text with Claude...", { step: "text_extraction" });

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

/** Step 2.5: Detect content type (setup / knowledge / resource). */
async function stepDetectContentType(
  entryId: string,
  text: string
): Promise<ContentType> {
  if (!text || text.trim().length === 0) return "setup";

  const stepStart = Date.now();
  await logStep(entryId, "content_type_detection", "started");
  ingestionProgress.emit(entryId, "step_start", "Detecting content type...", { step: "content_type_detection" });

  const result = await classifyContentType(text);

  await logStep(entryId, "content_type_detection", "completed", {
    content_type: result.content_type,
    confidence: result.confidence,
    reasoning: result.reasoning,
  }, Date.now() - stepStart);
  ingestionProgress.emit(
    entryId,
    "step_complete",
    `Content type: ${result.content_type} (confidence: ${(result.confidence * 100).toFixed(0)}% — ${result.reasoning})`,
    { step: "content_type_detection" }
  );

  return result.content_type;
}

/** Step 3: Process images in parallel with Claude Vision. */
async function stepImageProcessing(
  entryId: string,
  images: string[] | undefined
): Promise<void> {
  if (!images || images.length === 0) return;

  const stepStart = Date.now();
  await logStep(entryId, "image_extraction", "started");

  const limitedImages = images.slice(0, MAX_IMAGES_PER_ENTRY);
  ingestionProgress.emit(
    entryId,
    "step_start",
    `Processing ${limitedImages.length} image(s) with Claude Vision...`,
    { step: "image_extraction" }
  );

  const imageResults = await Promise.allSettled(
    limitedImages.map(async (imageBase64, idx) => {
      ingestionProgress.emit(entryId, "detail", `Analyzing image ${idx + 1}/${limitedImages.length}...`);
      const result = await extractImage(imageBase64);
      const imageType = result.contentMetadata?.imageType || "image";
      ingestionProgress.emit(entryId, "detail", `Image ${idx + 1}: detected ${imageType}`);
      return result;
    })
  );

  const successfulSources: ExtractedSource[] = [];
  for (const result of imageResults) {
    if (result.status === "fulfilled") {
      successfulSources.push(result.value);
    } else {
      console.error("[pipeline] Image extraction failed:", result.reason);
    }
  }
  if (successfulSources.length > 0) {
    await storeSources(entryId, successfulSources);
  }

  const failed = imageResults.length - successfulSources.length;
  const msg = failed > 0
    ? `Processed ${successfulSources.length} image(s), ${failed} failed`
    : `All ${successfulSources.length} image(s) processed`;

  await logStep(entryId, "image_extraction", "completed", {
    processed: imageResults.length,
    succeeded: successfulSources.length,
    failed,
  }, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", msg, { step: "image_extraction" });
}

/** Step 4: Follow links recursively and extract content. */
async function stepLinkFollowing(
  entryId: string,
  input: IngestInput,
  textSources: ExtractedSource[],
  thumbnailUrl: string | null,
  contentType: ContentType = "setup"
): Promise<{ thumbnailUrl: string | null }> {
  const allLinks = [
    ...(input.content.links || []),
    ...textSources.flatMap((s) => s.childLinks || []),
  ];
  const uniqueLinks = [...new Set(allLinks)];

  if (uniqueLinks.length === 0) return { thumbnailUrl };

  const maxLinks = contentType === "knowledge" ? KNOWLEDGE_MAX_LINKS : MAX_LINKS_PER_ENTRY;

  const stepStart = Date.now();
  await logStep(entryId, "link_following", "started");
  ingestionProgress.emit(
    entryId,
    "step_start",
    `Following ${Math.min(uniqueLinks.length, maxLinks)} link(s)${contentType === "knowledge" ? " (knowledge mode — reduced)" : ""}...`,
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
    const maxDepth = contentType === "knowledge" ? KNOWLEDGE_MAX_LINK_DEPTH : MAX_LINK_DEPTH;
    const batch = uniqueLinks.slice(i, i + LINK_CONCURRENCY);
    await Promise.allSettled(
      batch.map((link) =>
        followAndStore(entryId, link, 1, visitedUrls, linksFollowed, maxDepth)
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
async function stepGatherContent(
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

/** Step 5.5: Classify content sections with Claude. */
async function stepClassifyContent(
  entryId: string,
  contentForClaude: string
): Promise<{ classification: ContentClassification }> {
  const stepStart = Date.now();
  await logStep(entryId, "content_classification", "started");
  ingestionProgress.emit(entryId, "step_start", "Classifying content sections...", { step: "content_classification" });

  const classification = await classifyContent(contentForClaude);

  await logStep(entryId, "content_classification", "completed", {
    stats: classification.stats,
    preservation_notes: classification.preservation_notes,
  }, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", "Content classified", { step: "content_classification" });

  return { classification };
}

/** Step 6: Generate structured manifest from content. */
async function stepGenerateManifest(
  entryId: string,
  contentForClaude: string,
  contentType: ContentType = "setup",
  meta?: { thumbnailUrl: string | null; sourceUrl: string }
): Promise<{ manifest: Record<string, unknown> }> {
  const s = Date.now();
  await logStep(entryId, "manifest_generation", "started");
  ingestionProgress.emit(entryId, "step_start", `Generating manifest (${contentType})...`, { step: "manifest_generation" });

  const manifest = await generateManifest(contentForClaude, contentType);

  const m = manifest as Record<string, unknown>;
  const tools = (Array.isArray(m.tools) ? m.tools : []) as { name?: string }[];
  const integrations = Array.isArray(m.integrations) ? m.integrations : [];
  const parts: string[] = [];
  if (tools.length > 0) {
    const toolNames = tools.map((t) => (typeof t === "string" ? t : t.name || "unknown")).slice(0, 5);
    parts.push(`${tools.length} tool(s): ${toolNames.join(", ")}`);
  }
  if (integrations.length > 0) parts.push(`${integrations.length} integration(s)`);
  parts.push(`complexity: ${m.complexity || "unknown"}`);

  await logStep(entryId, "manifest_generation", "completed", undefined, Date.now() - s);
  ingestionProgress.emit(entryId, "step_complete", `Manifest generated — ${parts.join(", ")}`, {
    step: "manifest_generation",
    details: {
      manifest,
      title: (m.title as string) || "Untitled",
      summary: (m.description as string) || "",
      useCase: ((m.use_case as Record<string, string>)?.primary as string) || "other",
      complexity: (m.complexity as string) || "moderate",
      contentType,
      thumbnailUrl: meta?.thumbnailUrl ?? null,
      sourceUrl: meta?.sourceUrl ?? "",
      sourcePlatform: meta?.sourceUrl ? detectPlatform(meta.sourceUrl) : null,
    },
  });

  return { manifest };
}

/** Step 7: Generate human-readable README. */
async function stepGenerateReadme(
  entryId: string,
  contentForClaude: string,
  manifest: Record<string, unknown>,
  contentType: ContentType = "setup"
): Promise<{ readme: string }> {
  const s = Date.now();
  await logStep(entryId, "readme_generation", "started");
  ingestionProgress.emit(entryId, "step_start", `Generating README (${contentType})...`, { step: "readme_generation" });

  const readme = await generateReadme(contentForClaude, manifest, contentType);

  await logStep(entryId, "readme_generation", "completed", undefined, Date.now() - s);
  ingestionProgress.emit(entryId, "step_complete", `README generated (${Math.round(readme.length / 1000)}K chars)`, {
    step: "readme_generation",
    details: { readme },
  });

  return { readme };
}

/** Step 8: Generate agents.md (AI setup instructions). */
async function stepGenerateAgentsMd(
  entryId: string,
  contentForClaude: string,
  manifest: Record<string, unknown>,
  readme: string,
  classification: ContentClassification,
  sourceUrl?: string
): Promise<{ agentsMd: string }> {
  const s = Date.now();
  await logStep(entryId, "agents_md_generation", "started");
  ingestionProgress.emit(entryId, "step_start", "Generating agents.md (AI setup instructions)...", { step: "agents_md_generation" });

  const agentsMd = await generateAgentsMd(contentForClaude, manifest, readme, classification, sourceUrl);

  await logStep(entryId, "agents_md_generation", "completed", undefined, Date.now() - s);
  ingestionProgress.emit(entryId, "step_complete", `agents.md generated (${Math.round(agentsMd.length / 1000)}K chars)`, {
    step: "agents_md_generation",
    details: { agentsMd },
  });

  return { agentsMd };
}

/** Step 9: Generate searchable tags from manifest. */
async function stepGenerateTags(
  entryId: string,
  manifest: Record<string, unknown>
): Promise<{ tags: Array<{ tag_type: string; tag_value: string }> }> {
  const s = Date.now();
  await logStep(entryId, "tag_generation", "started");
  ingestionProgress.emit(entryId, "step_start", "Generating searchable tags...", { step: "tag_generation" });

  const tags = await generateTags(manifest);

  await logStep(entryId, "tag_generation", "completed", undefined, Date.now() - s);
  if (tags.length > 0) {
    const tagSummary = tags.slice(0, 8).map((t) => t.tag_value).join(", ");
    ingestionProgress.emit(entryId, "step_complete", `Generated ${tags.length} tag(s): ${tagSummary}`, {
      step: "tag_generation",
      details: { tags },
    });
  } else {
    ingestionProgress.emit(entryId, "step_complete", "No tags generated", {
      step: "tag_generation",
      details: { tags: [] },
    });
  }

  return { tags };
}

/** Steps 10 + 11: Update entry record and store tags. */
async function stepPersistEntry(
  entryId: string,
  input: IngestInput,
  manifest: Record<string, unknown>,
  readme: string,
  agentsMd: string,
  tags: Array<{ tag_type: string; tag_value: string }>,
  allContent: string,
  thumbnailUrl: string | null,
  contentType: ContentType = "setup"
): Promise<void> {
  const title = (manifest as Record<string, string>).title || "Untitled";
  const summary = (manifest as Record<string, string>).description || "";
  const useCase = ((manifest as Record<string, Record<string, string>>).use_case?.primary as string) || "other";
  const complexity = (manifest as Record<string, string>).complexity || "moderate";

  // Generate GitHub OG thumbnail if source is GitHub and no thumbnail yet
  if (!thumbnailUrl && input.url.includes("github.com")) {
    const ghMatch = input.url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (ghMatch) {
      const params = new URLSearchParams({ owner: ghMatch[1], repo: ghMatch[2] });
      thumbnailUrl = `/api/og/github?${params.toString()}`;
    }
  }

  const { error: updateError } = await supabase
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
      raw_content: { gathered: allContent },
      status: "processing",
      ingested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  if (updateError) {
    throw new Error(`Failed to update entry: ${updateError.message}`);
  }

  if (tags.length > 0) {
    const tagRows = tags.map((t) => ({
      entry_id: entryId,
      tag_type: t.tag_type,
      tag_value: t.tag_value,
    }));
    const { error: tagError } = await supabase.from("tags").insert(tagRows);
    if (tagError) {
      console.error("[pipeline] Failed to store tags:", tagError);
      ingestionProgress.emit(entryId, "step_error", `Tag insertion failed: ${tagError.message}`, {
        step: "tag_insertion",
        details: { error: tagError.message },
      });
    }
  }
}

/** Step 12: Chunk content and generate vector embeddings. */
async function stepChunkAndEmbed(
  entryId: string,
  readme: string,
  agentsMd: string,
  allContent: string
): Promise<void> {
  const stepStart = Date.now();
  await logStep(entryId, "embedding", "started");
  ingestionProgress.emit(entryId, "step_start", "Chunking content and generating embeddings...", { step: "embedding" });

  await chunkAndEmbed(entryId, { readme, agentsMd, rawContent: allContent });

  await logStep(entryId, "embedding", "completed", undefined, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", "Embeddings generated", { step: "embedding" });
}

// ════════════════════════════════════════════════════════════════════
// Helper functions
// ════════════════════════════════════════════════════════════════════

async function followAndStore(
  entryId: string,
  url: string,
  depth: number,
  visitedUrls: Set<string>,
  linksFollowed: { count: number },
  maxDepth: number = MAX_LINK_DEPTH
): Promise<void> {
  if (
    depth > maxDepth ||
    visitedUrls.has(url) ||
    linksFollowed.count >= MAX_LINKS_PER_ENTRY
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
    if (linksFollowed.count >= MAX_LINKS_PER_ENTRY) break;
    await followAndStore(
      entryId,
      childLink,
      depth + 1,
      visitedUrls,
      linksFollowed,
      maxDepth
    );
  }
}

async function storeSources(
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
    console.error(
      `[pipeline] Failed to store ${sources.length} source(s) for entry ${entryId}:`,
      error
    );
    throw new Error(`Database write failed for sources: ${error.message}`);
  }
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

function detectPlatform(url: string): string {
  if (isTweetUrl(url)) return "x";
  if (isInstagramPostUrl(url)) return "instagram";
  if (isRedditPostUrl(url)) return "reddit";
  if (url.includes("github.com")) return "github";

  return "web";
}

async function logStep(
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
