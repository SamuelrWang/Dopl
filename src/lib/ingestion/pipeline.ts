import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { IngestInput, ExtractedSource, ContentType } from "./types";
import { ModelTier } from "@/lib/ai";
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
import { slugifyEntryTitle, fallbackSlugFromId } from "@/lib/entries/slug";
import { logSystemEvent } from "@/lib/analytics/system-events";
import { grantCredits, CREDIT_COSTS } from "@/lib/credits";

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
// Public entry point
// ════════════════════════════════════════════════════════════════════

/**
 * Start the ingestion pipeline. Creates the entry record and returns the ID
 * immediately. The pipeline runs in the background — clients should connect
 * to the SSE stream at /api/ingest/{id}/stream to watch progress.
 */
export async function ingestEntry(input: IngestInput): Promise<string> {
  // Generate the entry id client-side so we can supply both `id` and the
  // derived `slug` in a single INSERT. `slug` is NOT NULL on the entries
  // table (see migration 033) and has no DB default, so inserting without
  // it fails with 23502 — which took down ALL ingestion earlier today.
  // The pipeline's stepPersistEntry later replaces this fallback with a
  // real title-based slug.
  const entryId = crypto.randomUUID();

  const { error: createError } = await supabase.from("entries").insert({
    id: entryId,
    source_url: input.url,
    source_platform: detectPlatform(input.url),
    status: "processing",
    ingested_by: input.userId ?? null,
    slug: fallbackSlugFromId(entryId),
    // moderation_status defaults to 'pending' via the DB default.
  });

  if (createError) {
    throw new Error(`Failed to create entry: ${createError.message}`);
  }

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
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const isTimeout = errorMessage.includes("timed out");
      // If the root cause was a Postgres/Supabase error, pull out the
      // structured fields so logs + the client stream + system_events
      // all name the exact constraint instead of swallowing it behind
      // a generic "database error" message. Structural check keeps us
      // from depending on PostgrestError types inside the pipeline.
      const pgFields = extractPgErrorFields(error);
      // Emit the error event so the client knows BEFORE we nuke the
      // entry row (the stream endpoint reads back from the DB on
      // reconnect, but active subscribers get the event in-flight).
      ingestionProgress.emit(
        entryId,
        "error",
        `Ingestion failed: ${errorMessage}`,
        pgFields ? { details: { pg: pgFields } } : undefined
      );
      console.error(
        `[pipeline] Entry ${entryId} failed:`,
        errorMessage,
        pgFields ? { pg: pgFields } : ""
      );
      // Log the failure into system_events BEFORE deleting the row so
      // the health dashboard can attribute and count it. Downstream
      // external-API failures (anthropic/openai/etc.) are logged
      // separately by callExternal — this entry captures the pipeline-
      // level outcome (e.g. timeout, aggregate failure).
      void logSystemEvent({
        severity: isTimeout ? "critical" : "error",
        category: "ingestion",
        source: "pipeline.runPipeline",
        message: `Ingestion failed: ${errorMessage}`,
        fingerprintKeys: ["ingestion", isTimeout ? "timeout" : errorName],
        metadata: {
          entry_id: entryId,
          source_url: input.url,
          timed_out: isTimeout,
          ...(pgFields && {
            pg_code: pgFields.code,
            pg_details: pgFields.details,
            pg_hint: pgFields.hint,
            pg_constraint: pgFields.constraint,
          }),
        },
        userId: input.userId ?? null,
      });
      // Delete any partial data from the common DB — no half-ingested
      // entries are ever allowed to persist.
      await deleteFailedEntry(entryId);

      // Refund the 20 credits we deducted upfront at the HTTP boundary.
      // The user got nothing (no entry, no readme, no agents.md), so
      // charging them would be punitive. This covers pipeline timeouts,
      // LLM outages, fetch failures, paywalls, and empty-extraction
      // cases alike — from the user's POV they all look the same.
      // We don't refund on moderation denial because in that case the
      // entry WAS produced, it just isn't public.
      if (input.userId) {
        grantCredits(
          input.userId,
          CREDIT_COSTS.ingestion,
          "ingestion_pipeline_refund",
          {
            entry_id: entryId,
            source_url: input.url,
            reason: isTimeout ? "timeout" : errorName,
          }
        ).catch((refundErr) => {
          logSystemEvent({
            severity: "error",
            category: "other",
            source: "pipeline.refund",
            message: `Credit refund failed after pipeline error: ${refundErr instanceof Error ? refundErr.message : String(refundErr)}`,
            fingerprintKeys: ["refund_failed", "pipeline"],
            metadata: { entry_id: entryId, user_id: input.userId },
            userId: input.userId,
          }).catch(() => {});
        });
      }
    }
  );

  return entryId;
}

/**
 * If the error (or its `cause`) is a PostgrestError / Postgres error,
 * return its structured fields. Lets the pipeline bubble the exact
 * constraint / column up to logs + the client stream without importing
 * Supabase types. Also tries to parse a constraint name out of the
 * message when the raw field isn't present (Supabase sometimes only
 * includes the constraint in the message text).
 */
function extractPgErrorFields(err: unknown): {
  code?: string;
  details?: string;
  hint?: string;
  constraint?: string;
} | null {
  const seen = new Set<unknown>();
  let cursor: unknown = err;
  while (cursor && typeof cursor === "object" && !seen.has(cursor)) {
    seen.add(cursor);
    const obj = cursor as Record<string, unknown>;
    const hasPgShape =
      typeof obj.code === "string" ||
      typeof obj.details === "string" ||
      typeof obj.hint === "string" ||
      typeof obj.constraint === "string";
    if (hasPgShape) {
      const fields: {
        code?: string;
        details?: string;
        hint?: string;
        constraint?: string;
      } = {};
      if (typeof obj.code === "string") fields.code = obj.code;
      if (typeof obj.details === "string") fields.details = obj.details;
      if (typeof obj.hint === "string") fields.hint = obj.hint;
      if (typeof obj.constraint === "string") fields.constraint = obj.constraint;
      if (!fields.constraint && typeof obj.message === "string") {
        const m = obj.message.match(/constraint "([^"]+)"/);
        if (m) fields.constraint = m[1];
      }
      return fields;
    }
    cursor = obj.cause;
  }
  return null;
}

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

  // ── Detect content type ──
  const { contentType, sourceType } = await stepDetectContentType(entryId, input.content.text || "");
  const strategy = PIPELINE_STRATEGIES[contentType];

  ingestionProgress.emit(entryId, "detail", `Using ${contentType} pipeline (models: manifest=${strategy.models.manifest}, readme=${strategy.models.readme})`);

  await stepImageProcessing(entryId, input.content.images);

  const linkResult = await stepLinkFollowing(entryId, input, textSources, thumbnailUrl, strategy);
  thumbnailUrl = linkResult.thumbnailUrl;

  // ── Gather content ──
  const { allContent, contentForClaude } = await stepGatherContent(entryId);

  // ── Check for empty content (paywall, bot block, empty page) ──
  const MIN_CONTENT_LENGTH = 100; // Less than this = nothing useful was extracted
  if (contentForClaude.trim().length < MIN_CONTENT_LENGTH) {
    const reason = "Content appears empty or inaccessible. The source may be behind a paywall, require authentication, or block automated access.";
    ingestionProgress.emit(entryId, "error", reason, { step: "content_check" });

    // Log as a warn (not error) — this is usually a property of the
    // source URL (paywall/bot-block), not a bug. A sudden spike still
    // shows up on the health dashboard as abnormal.
    void logSystemEvent({
      severity: "warn",
      category: "ingestion",
      source: "pipeline.contentCheck",
      message: "Empty/inaccessible content rejected",
      fingerprintKeys: ["ingestion", "empty_content"],
      metadata: { entry_id: entryId, source_url: input.url, length: contentForClaude.trim().length },
      userId: input.userId ?? null,
    });
    // No useful content extracted — delete the entry so nothing
    // partial ends up in the common DB.
    await deleteFailedEntry(entryId);
    return;
  }

  // ── Generate artifacts (strategy-driven) ──
  let manifest: Record<string, unknown>;
  let readme: string;
  let agentsMd: string;
  let tags: Array<{ tag_type: string; tag_value: string }>;
  let classification: ContentClassification | undefined;

  if (strategy.classifyContent) {
    // Setup/tutorial: classify content + generate manifest in parallel
    const [classificationResult, manifestResult] = await Promise.all([
      stepClassifyContent(entryId, contentForClaude, strategy.models.contentClassifier),
      stepGenerateManifest(entryId, contentForClaude, contentType, sourceType, strategy.models.manifest, { thumbnailUrl, sourceUrl: input.url }),
    ]);
    manifest = manifestResult.manifest;
    classification = classificationResult.classification;
  } else {
    // Knowledge/article/reference/resource: just manifest
    ingestionProgress.emit(entryId, "detail", `${contentType} content — skipping content classification`);
    ({ manifest } = await stepGenerateManifest(entryId, contentForClaude, contentType, sourceType, strategy.models.manifest, { thumbnailUrl, sourceUrl: input.url }));
  }

  // For setup/tutorial: agents.md no longer depends on readme, so run
  // all three generators in parallel after manifest.
  // For knowledge/article: agents.md (insights) still needs readme, so
  // run readme+tags first, then secondary artifact.
  const isSetupType = contentType === "setup" || contentType === "tutorial";

  if (isSetupType && strategy.generateSecondaryArtifact) {
    // README + tags + agents.md all in parallel
    const [readmeResult, tagsResult, agentsMdResult] = await Promise.all([
      stepGenerateReadme(entryId, contentForClaude, manifest, contentType, strategy.models.readme),
      stepGenerateTags(entryId, manifest, strategy.models.tags),
      stepGenerateSecondaryArtifact(entryId, contentForClaude, manifest, "", classification, input.url, contentType, strategy.models.secondary),
    ]);
    readme = readmeResult.readme;
    tags = tagsResult.tags;
    agentsMd = agentsMdResult.agentsMd;
  } else {
    // README + tags in parallel, then secondary artifact (needs readme)
    [{ readme }, { tags }] = await Promise.all([
      stepGenerateReadme(entryId, contentForClaude, manifest, contentType, strategy.models.readme),
      stepGenerateTags(entryId, manifest, strategy.models.tags),
    ]);

    if (strategy.generateSecondaryArtifact) {
      ({ agentsMd } = await stepGenerateSecondaryArtifact(entryId, contentForClaude, manifest, readme, classification, input.url, contentType, strategy.models.secondary));
    } else {
      agentsMd = "";
    }
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
    ingestionProgress.emit(entryId, "detail", "Could not fetch web content — will use provided content");
  }

  await logStep(entryId, "web_fetch", "completed", undefined, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", "Web content fetched", { step: "web_fetch" });
  return { thumbnailUrl, updatedText, updatedLinks };
}

/** Step 2: Extract text content and store sources. */
async function stepTextExtraction(
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

/** Step 2.5: Detect content type. */
async function stepDetectContentType(
  entryId: string,
  text: string
): Promise<{ contentType: ContentType; sourceType: string }> {
  if (!text || text.trim().length === 0) return { contentType: "knowledge", sourceType: "other" };

  const stepStart = Date.now();
  await logStep(entryId, "content_type_detection", "started");
  ingestionProgress.emit(entryId, "step_start", "Detecting content type...", { step: "content_type_detection" });

  const result = await classifyContentType(text, "haiku");

  await logStep(entryId, "content_type_detection", "completed", {
    content_type: result.content_type,
    source_type: result.source_type,
    confidence: result.confidence,
    reasoning: result.reasoning,
  }, Date.now() - stepStart);
  ingestionProgress.emit(
    entryId,
    "step_complete",
    `Content type: ${result.content_type} / ${result.source_type} (confidence: ${(result.confidence * 100).toFixed(0)}% — ${result.reasoning})`,
    { step: "content_type_detection" }
  );

  return { contentType: result.content_type, sourceType: result.source_type };
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
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error("[pipeline] Image extraction failed:", reason);
      // Surface to the health dashboard so chronic image-extractor
      // failures (vision API outages, quota exhaustion) are visible
      // instead of silently dropping user data.
      void logSystemEvent({
        severity: "warn",
        category: "ingestion",
        source: "pipeline.image_extract",
        message: `Image extraction failed: ${reason}`,
        fingerprintKeys: ["image_extract_fail"],
        metadata: { entry_id: entryId, reason },
      });
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
  contentForClaude: string,
  model?: ModelTier
): Promise<{ classification: ContentClassification }> {
  const stepStart = Date.now();
  await logStep(entryId, "content_classification", "started");
  ingestionProgress.emit(entryId, "step_start", "Classifying content sections...", { step: "content_classification" });

  const classification = await classifyContent(contentForClaude, model);

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
  sourceType: string = "other",
  model?: ModelTier,
  meta?: { thumbnailUrl: string | null; sourceUrl: string }
): Promise<{ manifest: Record<string, unknown> }> {
  const s = Date.now();
  await logStep(entryId, "manifest_generation", "started");
  ingestionProgress.emit(entryId, "step_start", `Generating manifest (${contentType})...`, { step: "manifest_generation" });

  const manifest = await generateManifest(contentForClaude, contentType, sourceType, model);

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
  contentType: ContentType = "setup",
  model?: ModelTier
): Promise<{ readme: string }> {
  const s = Date.now();
  await logStep(entryId, "readme_generation", "started");
  ingestionProgress.emit(entryId, "step_start", `Generating README (${contentType})...`, { step: "readme_generation" });

  const readme = await generateReadme(contentForClaude, manifest, contentType, model);

  await logStep(entryId, "readme_generation", "completed", undefined, Date.now() - s);
  ingestionProgress.emit(entryId, "step_complete", `README generated (${Math.round(readme.length / 1000)}K chars)`, {
    step: "readme_generation",
    details: { readme },
  });

  return { readme };
}

/** Step 8: Generate secondary artifact (agents.md / insights / reference guide). */
async function stepGenerateSecondaryArtifact(
  entryId: string,
  contentForClaude: string,
  manifest: Record<string, unknown>,
  readme: string,
  classification: ContentClassification | undefined,
  sourceUrl: string | undefined,
  contentType: ContentType = "setup",
  model?: ModelTier
): Promise<{ agentsMd: string }> {
  const artifactLabel = getSecondaryArtifactLabel(contentType);
  const s = Date.now();
  await logStep(entryId, "agents_md_generation", "started");
  ingestionProgress.emit(entryId, "step_start", `Generating ${artifactLabel}...`, { step: "agents_md_generation" });

  const agentsMd = await generateAgentsMd(contentForClaude, manifest, readme, classification, sourceUrl, contentType, model);

  await logStep(entryId, "agents_md_generation", "completed", undefined, Date.now() - s);
  ingestionProgress.emit(entryId, "step_complete", `${artifactLabel} generated (${Math.round(agentsMd.length / 1000)}K chars)`, {
    step: "agents_md_generation",
    details: { agentsMd },
  });

  return { agentsMd };
}

/** Step 9: Generate searchable tags from manifest. */
async function stepGenerateTags(
  entryId: string,
  manifest: Record<string, unknown>,
  model?: ModelTier
): Promise<{ tags: Array<{ tag_type: string; tag_value: string }> }> {
  const s = Date.now();
  await logStep(entryId, "tag_generation", "started");
  ingestionProgress.emit(entryId, "step_start", "Generating searchable tags...", { step: "tag_generation" });

  const tags = await generateTags(manifest, model);

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

  // Universal fallback: use thum.io to generate a screenshot of the source page.
  // This is a free service that renders the URL on-demand when the image loads.
  // No API call during ingestion, zero latency added.
  if (!thumbnailUrl && input.url) {
    thumbnailUrl = `https://image.thum.io/get/${encodeURI(input.url)}`;
  }

  // Generate a public slug from the title and persist the row. Two
  // concurrent ingestions with the same title can race through
  // generateEntrySlug (both see the same "existing slugs" snapshot and
  // pick the same candidate), so the UPDATE wins only once. On
  // unique-violation (Postgres 23505), retry with a random suffix —
  // faster than another round-trip query, and guarantees termination.
  async function persistWithSlugRetry(initialSlug: string): Promise<void> {
    const maxAttempts = 5;
    let candidate = initialSlug;
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
          raw_content: { gathered: allContent },
          slug: candidate,
          status: "processing",
          ingested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", entryId);

      if (!error) return;

      // 23505 = unique violation — collision on slug column.
      if ((error as { code?: string }).code === "23505") {
        const suffix = Math.random().toString(36).slice(2, 6);
        candidate = `${initialSlug}-${suffix}`;
        continue;
      }

      throw new Error(`Failed to update entry: ${error.message}`);
    }
    throw new Error(
      `Failed to assign a unique slug for entry ${entryId} after ${maxAttempts} attempts`
    );
  }

  const slug = await generateEntrySlug(entryId, title);
  await persistWithSlugRetry(slug);

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

function detectPlatform(url: string): string {
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

/** Get the human-readable label for the secondary artifact based on content type. */
export function getSecondaryArtifactLabel(contentType: string): string {
  switch (contentType) {
    case "setup":
    case "tutorial":
      return "agents.md";
    case "knowledge":
    case "article":
      return "Key Insights";
    case "reference":
      return "Reference Guide";
    default:
      return "agents.md";
  }
}

/** Get the download filename for the secondary artifact. */
export function getSecondaryArtifactFilename(contentType: string): string {
  switch (contentType) {
    case "setup":
    case "tutorial":
      return "agents.md";
    case "knowledge":
    case "article":
      return "key-insights.md";
    case "reference":
      return "reference-guide.md";
    default:
      return "agents.md";
  }
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
