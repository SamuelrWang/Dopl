import { supabaseAdmin } from "@/lib/supabase";
const supabase = supabaseAdmin();
import { IngestInput, ExtractedSource } from "./types";
import { extractText } from "./extractors/text";
import { extractImage } from "./extractors/image";
import { extractWebContent, linkResultToSource } from "./extractors/web";
import { extractGitHubContent } from "./extractors/github";
import { extractYouTubeTranscript } from "./extractors/youtube";
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
import { classifyContent } from "./generators/content-classifier";
import { chunkAndEmbed } from "./embedder";
import { truncateContent } from "./utils";
import { ingestionProgress } from "./progress";

const MAX_DEPTH = parseInt(process.env.MAX_LINK_DEPTH || "3", 10);
const MAX_LINKS_PER_ENTRY = 30;
const MAX_CONTENT_FOR_CLAUDE = 100_000;
const MAX_IMAGES_PER_ENTRY = 20;
const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;

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

async function runPipeline(
  entryId: string,
  input: IngestInput
): Promise<void> {
  await logStep(entryId, "pipeline_start", "started");
  ingestionProgress.emit(entryId, "info", `Starting ingestion for ${input.url}`);

  // Track thumbnail URL for browse page cards
  let thumbnailUrl: string | null = null;

  // ── 1.5 Auto-fetch from source platform ──────────────────────────
  if (!input.content.text) {
    if (isTweetUrl(input.url)) {
      const stepStart = Date.now();
      await logStep(entryId, "tweet_fetch", "started");
      ingestionProgress.emit(entryId, "step_start", "Fetching tweet content...", { step: "tweet_fetch" });

      const tweetResult = await extractTweetContent(input.url);
      if (tweetResult) {
        input.content.text = tweetResult.content;
        const existingLinks = input.content.links || [];
        input.content.links = [
          ...new Set([...existingLinks, ...tweetResult.childLinks]),
        ];
        const tweetSource = linkResultToSource(tweetResult, 0);
        await storeSources(entryId, [tweetSource]);
        thumbnailUrl = (tweetResult.metadata.thumbnail_url as string) || null;

        // Rich context from the tweet
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

    } else if (isInstagramPostUrl(input.url)) {
      const stepStart = Date.now();
      await logStep(entryId, "instagram_fetch", "started");
      ingestionProgress.emit(entryId, "step_start", "Fetching Instagram post...", { step: "instagram_fetch" });

      const igResult = await extractInstagramContent(input.url);
      if (igResult) {
        input.content.text = igResult.content;
        const existingLinks = input.content.links || [];
        input.content.links = [
          ...new Set([...existingLinks, ...igResult.childLinks]),
        ];
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

    } else if (isRedditPostUrl(input.url)) {
      const stepStart = Date.now();
      await logStep(entryId, "reddit_fetch", "started");
      ingestionProgress.emit(entryId, "step_start", "Fetching Reddit post...", { step: "reddit_fetch" });

      const redditResult = await extractRedditContent(input.url);
      if (redditResult) {
        input.content.text = redditResult.content;
        const existingLinks = input.content.links || [];
        input.content.links = [
          ...new Set([...existingLinks, ...redditResult.childLinks]),
        ];
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
    }
  }

  // ── 2. Text extraction ────────────────────────────────────────────
  let textSources;
  {
    const stepStart = Date.now();
    await logStep(entryId, "text_extraction", "started");
    ingestionProgress.emit(entryId, "step_start", "Analyzing post text with Claude...", { step: "text_extraction" });

    textSources = await extractText(input.content.text || "");
    await storeSources(entryId, textSources);

    const linksFound = textSources.flatMap((s) => s.childLinks || []);
    if (linksFound.length > 0) {
      ingestionProgress.emit(entryId, "detail", `Extracted ${linksFound.length} URL(s) from text`);
    }

    await logStep(entryId, "text_extraction", "completed", undefined, Date.now() - stepStart);
    ingestionProgress.emit(entryId, "step_complete", "Text analysis complete", { step: "text_extraction" });
  }

  // ── 3. Image processing (parallelized) ────────────────────────────
  if (input.content.images && input.content.images.length > 0) {
    const stepStart = Date.now();
    await logStep(entryId, "image_extraction", "started");

    const limitedImages = input.content.images.slice(0, MAX_IMAGES_PER_ENTRY);
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
        ingestionProgress.emit(
          entryId,
          "detail",
          `Image ${idx + 1}: detected ${imageType}`
        );
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

  // ── 4. Link following ─────────────────────────────────────────────
  const allLinks = [
    ...(input.content.links || []),
    ...textSources.flatMap((s) => s.childLinks || []),
  ];
  const uniqueLinks = [...new Set(allLinks)];

  if (uniqueLinks.length > 0) {
    const stepStart = Date.now();
    await logStep(entryId, "link_following", "started");
    ingestionProgress.emit(
      entryId,
      "step_start",
      `Following ${uniqueLinks.length} link(s)...`,
      { step: "link_following" }
    );

    const visitedUrls = new Set<string>();
    let linksFollowed = 0;

    for (const link of uniqueLinks) {
      if (linksFollowed >= MAX_LINKS_PER_ENTRY) {
        ingestionProgress.emit(
          entryId,
          "detail",
          `Link budget reached (${MAX_LINKS_PER_ENTRY} max) — stopping`
        );
        break;
      }
      linksFollowed = await followAndStore(
        entryId,
        link,
        1,
        visitedUrls,
        linksFollowed
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
      links_followed: linksFollowed,
      links_found: uniqueLinks.length,
    }, Date.now() - stepStart);
    ingestionProgress.emit(
      entryId,
      "step_complete",
      `Followed ${linksFollowed} link(s)`,
      { step: "link_following" }
    );
  }

  // ── 5. Gather content ─────────────────────────────────────────────
  const allContent = await gatherAllContent(entryId);
  const contentForClaude = truncateContent(allContent, MAX_CONTENT_FOR_CLAUDE);

  ingestionProgress.emit(
    entryId,
    "detail",
    `Gathered ${Math.round(allContent.length / 1000)}K characters of content`
  );

  // ── 5.5. Classify content ─────────────────────────────────────────
  let classification;
  {
    const stepStart = Date.now();
    await logStep(entryId, "content_classification", "started");
    ingestionProgress.emit(entryId, "step_start", "Classifying content sections...", { step: "content_classification" });

    classification = await classifyContent(contentForClaude);

    await logStep(entryId, "content_classification", "completed", {
      stats: classification.stats,
      preservation_notes: classification.preservation_notes,
    }, Date.now() - stepStart);
    ingestionProgress.emit(entryId, "step_complete", "Content classified", { step: "content_classification" });
  }

  // ── 6. Generate manifest ──────────────────────────────────────────
  let manifest;
  {
    const s = Date.now();
    await logStep(entryId, "manifest_generation", "started");
    ingestionProgress.emit(entryId, "step_start", "Generating manifest...", { step: "manifest_generation" });

    manifest = await generateManifest(contentForClaude);

    // Extract rich context from manifest
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
    ingestionProgress.emit(entryId, "step_complete", `Manifest generated — ${parts.join(", ")}`, { step: "manifest_generation" });
  }

  // ── 7. Generate README ────────────────────────────────────────────
  let readme;
  {
    const s = Date.now();
    await logStep(entryId, "readme_generation", "started");
    ingestionProgress.emit(entryId, "step_start", "Generating README...", { step: "readme_generation" });

    readme = await generateReadme(contentForClaude, manifest);

    await logStep(entryId, "readme_generation", "completed", undefined, Date.now() - s);
    ingestionProgress.emit(entryId, "step_complete", `README generated (${Math.round(readme.length / 1000)}K chars)`, { step: "readme_generation" });
  }

  // ── 8. Generate agents.md ─────────────────────────────────────────
  let agentsMd;
  {
    const s = Date.now();
    await logStep(entryId, "agents_md_generation", "started");
    ingestionProgress.emit(entryId, "step_start", "Generating agents.md (AI setup instructions)...", { step: "agents_md_generation" });

    agentsMd = await generateAgentsMd(contentForClaude, manifest, readme, classification);

    await logStep(entryId, "agents_md_generation", "completed", undefined, Date.now() - s);
    ingestionProgress.emit(entryId, "step_complete", `agents.md generated (${Math.round(agentsMd.length / 1000)}K chars)`, { step: "agents_md_generation" });
  }

  // ── 9. Generate tags ──────────────────────────────────────────────
  let tags;
  {
    const s = Date.now();
    await logStep(entryId, "tag_generation", "started");
    ingestionProgress.emit(entryId, "step_start", "Generating searchable tags...", { step: "tag_generation" });

    tags = await generateTags(manifest);

    await logStep(entryId, "tag_generation", "completed", undefined, Date.now() - s);
    if (tags.length > 0) {
      const tagSummary = tags.slice(0, 8).map((t) => t.tag_value).join(", ");
      ingestionProgress.emit(entryId, "step_complete", `Generated ${tags.length} tag(s): ${tagSummary}`, { step: "tag_generation" });
    } else {
      ingestionProgress.emit(entryId, "step_complete", "No tags generated", { step: "tag_generation" });
    }
  }

  // ── 10. Update entry ──────────────────────────────────────────────
  const title =
    (manifest as Record<string, string>).title || "Untitled Setup";
  const summary =
    (manifest as Record<string, string>).description || "";
  const useCase =
    ((manifest as Record<string, Record<string, string>>).use_case
      ?.primary as string) || "other";
  const complexity =
    (manifest as Record<string, string>).complexity || "moderate";

  // Generate GitHub OG thumbnail if source is GitHub and no thumbnail yet
  if (!thumbnailUrl && input.url.includes("github.com")) {
    const ghMatch = input.url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (ghMatch) {
      thumbnailUrl = `https://opengraph.githubassets.com/1/${ghMatch[1]}/${ghMatch[2]}`;
    }
  }

  const { error: updateError } = await supabase
    .from("entries")
    .update({
      title,
      summary,
      use_case: useCase,
      complexity,
      thumbnail_url: thumbnailUrl,
      readme,
      agents_md: agentsMd,
      manifest,
      raw_content: { gathered: allContent },
      status: "complete",
      ingested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  if (updateError) {
    throw new Error(`Failed to update entry: ${updateError.message}`);
  }

  // ── 11. Store tags ────────────────────────────────────────────────
  if (tags.length > 0) {
    const tagRows = tags.map((t) => ({
      entry_id: entryId,
      tag_type: t.tag_type,
      tag_value: t.tag_value,
    }));
    const { error: tagError } = await supabase.from("tags").insert(tagRows);
    if (tagError) {
      console.error("[pipeline] Failed to store tags:", tagError);
    }
  }

  // ── 12. Chunk and embed ───────────────────────────────────────────
  {
    const stepStart = Date.now();
    await logStep(entryId, "embedding", "started");
    ingestionProgress.emit(entryId, "step_start", "Chunking content and generating embeddings...", { step: "embedding" });

    await chunkAndEmbed(entryId, { readme, agentsMd, rawContent: allContent });

    await logStep(entryId, "embedding", "completed", undefined, Date.now() - stepStart);
    ingestionProgress.emit(entryId, "step_complete", "Embeddings generated", { step: "embedding" });
  }

  // ── Done ──────────────────────────────────────────────────────────
  await logStep(entryId, "pipeline_complete", "completed");
  ingestionProgress.emit(
    entryId,
    "complete",
    `Ingestion complete — "${title}"`,
    { details: { entry_id: entryId, title, use_case: useCase, complexity } }
  );
}

async function followAndStore(
  entryId: string,
  url: string,
  depth: number,
  visitedUrls: Set<string>,
  linksFollowed: number
): Promise<number> {
  if (
    depth > MAX_DEPTH ||
    visitedUrls.has(url) ||
    linksFollowed >= MAX_LINKS_PER_ENTRY
  ) {
    return linksFollowed;
  }

  visitedUrls.add(url);
  linksFollowed++;

  // Describe what we're doing
  const shortUrl = url.length > 80 ? url.slice(0, 77) + "..." : url;
  let description = `Following: ${shortUrl}`;
  if (isTweetUrl(url)) description = `Following tweet: ${shortUrl}`;
  else if (isInstagramPostUrl(url)) description = `Following Instagram post: ${shortUrl}`;
  else if (isRedditPostUrl(url)) description = `Following Reddit post: ${shortUrl}`;
  else if (url.includes("github.com")) description = `Following GitHub: ${shortUrl}`;
  else if (url.includes("youtube.com") || url.includes("youtu.be")) description = `Following YouTube: ${shortUrl}`;

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
    } else if (url.includes("youtube.com") || url.includes("youtu.be")) {
      result = await extractYouTubeTranscript(url, depth);
    } else {
      result = await extractWebContent(url, depth);
    }
  } catch (error) {
    console.error(`[pipeline] Extractor failed for ${url}:`, error);
    ingestionProgress.emit(entryId, "detail", `Failed to extract: ${shortUrl}`);
    return linksFollowed;
  }

  if (!result) {
    ingestionProgress.emit(entryId, "detail", `No content extracted from: ${shortUrl}`);
    return linksFollowed;
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
    if (linksFollowed >= MAX_LINKS_PER_ENTRY) break;
    linksFollowed = await followAndStore(
      entryId,
      childLink,
      depth + 1,
      visitedUrls,
      linksFollowed
    );
  }

  return linksFollowed;
}

async function storeSources(
  entryId: string,
  sources: ExtractedSource[]
): Promise<void> {
  for (const source of sources) {
    const { error } = await supabase.from("sources").insert({
      entry_id: entryId,
      url: source.url || null,
      source_type: source.sourceType,
      raw_content: source.rawContent,
      extracted_content: source.extractedContent || null,
      content_metadata: source.contentMetadata || null,
      depth: source.depth,
    });

    if (error) {
      console.error(
        `[pipeline] Failed to store source (type=${source.sourceType}, url=${source.url}):`,
        error
      );
      throw new Error(`Database write failed for source: ${error.message}`);
    }
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
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
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
