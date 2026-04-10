import { LinkFollowResult } from "../types";
import { extractImage } from "./image";
import { ExtractedSource } from "../types";
import {
  fetchWithTimeout,
  retryWithBackoff,
  downloadImageAsBase64,
} from "../utils";

interface FxTweetResponse {
  code: number;
  message: string;
  tweet?: {
    id: string;
    text: string;
    author: {
      name: string;
      screen_name: string;
      avatar_url?: string;
    };
    created_at: string;
    likes: number;
    retweets: number;
    replies: number;
    views?: number;
    media?: {
      all?: FxTweetMedia[];
      photos?: FxTweetMedia[];
      videos?: FxTweetMedia[];
    };
    quote?: {
      id: string;
      text: string;
      author: {
        name: string;
        screen_name: string;
      };
      media?: {
        all?: FxTweetMedia[];
        photos?: FxTweetMedia[];
        videos?: FxTweetMedia[];
      };
    };
    urls?: {
      url: string;
      expanded_url: string;
      display_url: string;
    }[];
    article?: {
      title?: string;
      preview_text?: string;
      cover_media?: {
        media_info?: {
          original_img_url?: string;
        };
      };
      content?: {
        blocks?: {
          text: string;
          type: string;
          entityRanges?: { key: number; length: number; offset: number }[];
        }[];
        entityMap?: Record<
          string,
          { type: string; data?: { url?: string } }
        >;
      };
    };
  };
}

interface FxTweetMedia {
  type: "photo" | "video" | "gif";
  url: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
}

const MAX_IMAGES_PER_TWEET = 10;

/**
 * Extract content from a Twitter/X post using the FxTwitter API.
 * Returns structured content with text, image descriptions, and child links
 * for quoted tweets and expanded URLs.
 */
export async function extractTweetContent(
  url: string,
  depth: number = 0
): Promise<LinkFollowResult | null> {
  try {
    const parsed = parseTweetUrl(url);
    if (!parsed) return null;

    const apiUrl = `https://api.fxtwitter.com/${parsed.username}/status/${parsed.tweetId}`;

    const response = await retryWithBackoff(
      () =>
        fetchWithTimeout(apiUrl, {
          headers: { "User-Agent": "SetupIntelligenceEngine/1.0" },
          timeoutMs: 15_000,
        }),
      { label: `FxTwitter:${parsed.tweetId}` }
    );

    if (!response.ok) {
      console.error(`FxTwitter API error: ${response.status} for ${url}`);
      return null;
    }

    const data: FxTweetResponse = await response.json();
    if (!data.tweet) {
      console.error(`FxTwitter returned no tweet data for ${url}`);
      return null;
    }

    const tweet = data.tweet;
    const contentParts: string[] = [];
    const childLinks: string[] = [];
    // Thumbnail: first photo, article cover, or author avatar as fallback
    const thumbnailUrl =
      tweet.media?.photos?.[0]?.url ||
      tweet.article?.cover_media?.media_info?.original_img_url ||
      tweet.author.avatar_url ||
      null;

    const metadata: Record<string, unknown> = {
      platform: "x",
      thumbnail_url: thumbnailUrl,
      author: tweet.author.screen_name,
      author_name: tweet.author.name,
      tweet_id: tweet.id,
      created_at: tweet.created_at,
      likes: tweet.likes,
      retweets: tweet.retweets,
      replies: tweet.replies,
      views: tweet.views,
    };

    // -- Tweet text --
    contentParts.push(`@${tweet.author.screen_name} (${tweet.author.name}):`);
    if (tweet.text) {
      contentParts.push(tweet.text);
    }

    // -- Article content (X Articles / long-form posts) --
    if (tweet.article) {
      const article = tweet.article;
      metadata.has_article = true;
      metadata.article_title = article.title;

      if (article.title) {
        contentParts.push(`\n## ${article.title}\n`);
      }

      // Parse Draft.js block format into plain text
      if (article.content?.blocks) {
        const articleText = parseArticleBlocks(
          article.content.blocks,
          article.content.entityMap
        );
        contentParts.push(articleText);

        // Extract URLs from article entity map
        if (article.content.entityMap) {
          for (const entity of Object.values(article.content.entityMap)) {
            if (entity.type === "LINK" && entity.data?.url) {
              const linkUrl = entity.data.url;
              if (!isTweetUrl(linkUrl) && !isTwitterMedia(linkUrl)) {
                childLinks.push(linkUrl);
              }
            }
          }
        }
      }
    }

    // -- Expanded URLs → child links --
    if (tweet.urls) {
      for (const u of tweet.urls) {
        const expanded = u.expanded_url || u.url;
        if (!isTweetUrl(expanded)) {
          childLinks.push(expanded);
        }
      }
    }

    // Also extract any URLs from the tweet text that weren't in the urls array
    const textUrls = extractUrlsFromText(tweet.text);
    for (const u of textUrls) {
      if (!childLinks.includes(u) && !isTweetUrl(u) && !isTwitterMedia(u)) {
        childLinks.push(u);
      }
    }

    // -- Images → download and describe via Claude Vision (parallelized) --
    const photos = (tweet.media?.photos || []).slice(0, MAX_IMAGES_PER_TWEET);
    if (photos.length > 0) {
      contentParts.push(`\n[${photos.length} image(s) attached]`);

      const imageResults = await Promise.allSettled(
        photos.map(async (photo) => {
          const result = await downloadImageAsBase64(photo.url);
          if (!result) return `[Image: ${photo.url} — could not be downloaded]`;

          const imageSource: ExtractedSource = await extractImage(
            result.base64,
            result.mimeType
          );
          return imageSource.extractedContent || imageSource.rawContent;
        })
      );

      const imageDescriptions = imageResults.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : `[Image ${i + 1}: processing failed — ${r.reason}]`
      );

      if (imageDescriptions.length > 0) {
        contentParts.push("\n--- Image Analysis ---");
        imageDescriptions.forEach((desc, i) => {
          contentParts.push(`\nImage ${i + 1}:\n${desc}`);
        });
      }
    }

    // -- Videos → note in metadata --
    const videos = tweet.media?.videos || [];
    if (videos.length > 0) {
      contentParts.push(`\n[${videos.length} video(s) attached — not analyzed]`);
      metadata.has_video = true;
      metadata.video_urls = videos.map((v) => v.url);
    }

    // -- Quoted tweet → add as child link for recursive extraction --
    if (tweet.quote) {
      const quoteUrl = `https://x.com/${tweet.quote.author.screen_name}/status/${tweet.quote.id}`;
      childLinks.push(quoteUrl);
      contentParts.push(
        `\n[Quotes @${tweet.quote.author.screen_name}: "${tweet.quote.text.slice(0, 100)}${tweet.quote.text.length > 100 ? "..." : ""}"]`
      );
    }

    return {
      url,
      type: "tweet",
      content: contentParts.join("\n"),
      childLinks,
      metadata,
    };
  } catch (error) {
    console.error(`Failed to extract tweet content from ${url}:`, error);
    return null;
  }
}

// -- Article parsing --

/**
 * Parse Draft.js-style article blocks into plain text.
 * Handles headers, code blocks, lists, and inline links.
 */
function parseArticleBlocks(
  blocks: { text: string; type: string; entityRanges?: { key: number; length: number; offset: number }[] }[],
  entityMap?: Record<string, { type: string; data?: { url?: string } }>
): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const text = block.text;

    // Skip empty atomic blocks (images, embeds)
    if (block.type === "atomic" && !text.trim()) continue;

    switch (block.type) {
      case "header-one":
        lines.push(`\n# ${text}\n`);
        break;
      case "header-two":
        lines.push(`\n## ${text}\n`);
        break;
      case "header-three":
        lines.push(`\n### ${text}\n`);
        break;
      case "code-block":
        lines.push(`\`\`\`\n${text}\n\`\`\``);
        break;
      case "blockquote":
        lines.push(`> ${text}`);
        break;
      case "unordered-list-item":
        lines.push(`- ${text}`);
        break;
      case "ordered-list-item":
        lines.push(`1. ${text}`);
        break;
      default:
        // For regular text, inline link URLs from entity map
        if (block.entityRanges && entityMap && block.entityRanges.length > 0) {
          let enrichedText = text;
          // Process from end to start so offsets aren't shifted
          const sorted = [...block.entityRanges].sort(
            (a, b) => b.offset - a.offset
          );
          for (const range of sorted) {
            const entity = entityMap[String(range.key)];
            if (entity?.type === "LINK" && entity.data?.url) {
              const linkText = text.substring(
                range.offset,
                range.offset + range.length
              );
              enrichedText =
                enrichedText.substring(0, range.offset) +
                `[${linkText}](${entity.data.url})` +
                enrichedText.substring(range.offset + range.length);
            }
          }
          lines.push(enrichedText);
        } else {
          lines.push(text);
        }
        break;
    }
  }

  return lines.join("\n");
}

// -- Helpers --

interface ParsedTweetUrl {
  username: string;
  tweetId: string;
}

function parseTweetUrl(url: string): ParsedTweetUrl | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "");

    if (hostname !== "x.com" && hostname !== "twitter.com") return null;

    const parts = urlObj.pathname.split("/").filter(Boolean);
    if (parts.length < 3 || parts[1] !== "status") return null;

    const tweetId = parts[2].split("?")[0];
    if (!/^\d+$/.test(tweetId)) return null;

    return { username: parts[0], tweetId };
  } catch {
    return null;
  }
}

export function isTweetUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "");
    return (
      (hostname === "x.com" || hostname === "twitter.com") &&
      urlObj.pathname.includes("/status/")
    );
  } catch {
    return false;
  }
}

function isTwitterMedia(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname.includes("pbs.twimg.com") ||
      urlObj.hostname.includes("video.twimg.com") ||
      urlObj.hostname.includes("t.co")
    );
  } catch {
    return false;
  }
}

function extractUrlsFromText(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, "")))];
}
