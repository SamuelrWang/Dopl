import { IngestInput } from "../types";
import { extractTweetContent, isTweetUrl } from "../extractors/twitter";
import {
  extractInstagramContent,
  isInstagramPostUrl,
} from "../extractors/instagram";
import {
  extractRedditContent,
  isRedditPostUrl,
} from "../extractors/reddit";
import { extractGitHubContent } from "../extractors/github";
import {
  extractWebContent,
  linkResultToSource,
  ExtractorError,
} from "../extractors/web";
import { ingestionProgress } from "../progress";
import { logStep } from "./util";
import { storeSources } from "./storage";

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

  let webResult: Awaited<ReturnType<typeof extractWebContent>> = null;
  try {
    webResult = await extractWebContent(input.url, 0);
  } catch (error) {
    // Record the failure as a source row so it surfaces on the prepare
    // response's fetch_warnings. extractWebContent now throws (instead
    // of catching+returning null) so typed ExtractorError reasons
    // propagate here — preserve them when persisting. Audit-write
    // failure must not crash the step; we'd rather lose the audit
    // breadcrumb than block the whole ingest for sibling content.
    const isTyped = error instanceof ExtractorError;
    console.error(`[pipeline] Web extractor failed for ${input.url}:`, error);
    try {
      await storeSources(entryId, [
        {
          url: input.url,
          sourceType: "other",
          rawContent: "",
          depth: 0,
          status: "failed",
          statusReason: isTyped ? error.statusReason : "extractor_error",
          fetchStatusCode: isTyped && error.fetchStatusCode !== null ? error.fetchStatusCode : undefined,
        },
      ]);
    } catch (persistErr) {
      console.error(`[pipeline] Failed to persist web-failure audit row for ${input.url}:`, persistErr);
    }
  }
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
