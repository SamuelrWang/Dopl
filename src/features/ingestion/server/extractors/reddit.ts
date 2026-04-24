import { LinkFollowResult } from "../types";
import { extractImage } from "./image";
import { ExtractedSource } from "../types";
import {
  fetchWithTimeout,
  retryWithBackoff,
  downloadImageAsBase64,
} from "../utils";

/**
 * Reddit post extractor using the public JSON API.
 *
 * Reddit exposes any post as JSON by appending `.json` to the URL — no auth needed.
 * Handles both direct post URLs and share shortlinks (e.g. /r/foo/s/xyz).
 */

interface RedditPost {
  title: string;
  author: string;
  subreddit: string;
  selftext: string;
  selftext_html?: string;
  url: string;
  permalink: string;
  created_utc: number;
  ups: number;
  num_comments: number;
  thumbnail?: string;
  preview?: {
    images?: { source?: { url: string } }[];
  };
  is_video?: boolean;
  gallery_data?: { items?: { media_id: string }[] };
  media_metadata?: Record<string, { s?: { u?: string } }>;
  post_hint?: string;
  link_flair_text?: string;
}

interface RedditComment {
  author: string;
  body: string;
  ups: number;
  created_utc: number;
  replies?: unknown;
}

const MAX_COMMENTS = 10; // Top comments to include
const MAX_IMAGES = 10;

export function isRedditUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "").replace("old.", "").replace("new.", "");
    return hostname === "reddit.com" || hostname.endsWith(".reddit.com");
  } catch {
    return false;
  }
}

export function isRedditPostUrl(url: string): boolean {
  if (!isRedditUrl(url)) return false;
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    // Matches /r/{sub}/comments/{id}/... or /r/{sub}/s/{shortcode}
    return /^\/r\/[^/]+\/(comments|s)\//.test(path);
  } catch {
    return false;
  }
}

/**
 * Resolve a Reddit shortlink (/r/foo/s/xyz) to its canonical comments URL.
 * Regular post URLs pass through unchanged.
 */
async function resolveRedditUrl(url: string): Promise<string> {
  try {
    const urlObj = new URL(url);
    // Share shortlinks have /s/ — need to resolve via redirect
    if (!urlObj.pathname.match(/\/s\//)) return url;

    const response = await fetchWithTimeout(url, {
      method: "HEAD",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 SetupIntelligenceEngine/1.0",
      },
      timeoutMs: 10_000,
      redirect: "follow",
    });
    return response.url || url;
  } catch {
    return url;
  }
}

/**
 * Convert a Reddit post URL to its JSON endpoint.
 * /r/foo/comments/abc123/title → /r/foo/comments/abc123.json
 */
function toJsonUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/^(\/r\/[^/]+\/comments\/[^/]+)/);
    if (!match) return null;
    return `https://www.reddit.com${match[1]}.json`;
  } catch {
    return null;
  }
}

export async function extractRedditContent(
  url: string,
  depth: number = 0
): Promise<LinkFollowResult | null> {
  try {
    // Step 1: resolve shortlink if needed
    const resolvedUrl = await resolveRedditUrl(url);
    const jsonUrl = toJsonUrl(resolvedUrl);
    if (!jsonUrl) {
      console.error(`[reddit] Could not derive JSON URL from ${url}`);
      return null;
    }

    // Step 2: fetch the JSON data
    const response = await retryWithBackoff(
      () =>
        fetchWithTimeout(jsonUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 SetupIntelligenceEngine/1.0",
            Accept: "application/json",
          },
          timeoutMs: 15_000,
        }),
      { label: `Reddit:${url}` }
    );

    if (!response.ok) {
      console.error(`[reddit] API error ${response.status} for ${url}`);
      return null;
    }

    const data = (await response.json()) as unknown[];
    if (!Array.isArray(data) || data.length === 0) {
      console.error(`[reddit] Unexpected response shape for ${url}`);
      return null;
    }

    // data[0] = post listing, data[1] = comments listing
    const postListing = data[0] as {
      data?: { children?: { data?: RedditPost }[] };
    };
    const post = postListing?.data?.children?.[0]?.data;
    if (!post) {
      console.error(`[reddit] No post data for ${url}`);
      return null;
    }

    const contentParts: string[] = [];
    const childLinks: string[] = [];
    const canonicalUrl = `https://www.reddit.com${post.permalink || ""}`;

    // ── Header ──
    contentParts.push(`r/${post.subreddit} — u/${post.author}:`);
    contentParts.push(`\n# ${post.title}\n`);

    // ── Post body ──
    if (post.selftext && post.selftext.trim().length > 0) {
      contentParts.push(post.selftext);
    }

    // ── External link (if it's a link post, not a self post) ──
    if (post.url && !post.url.startsWith("https://www.reddit.com") && !isRedditMediaUrl(post.url)) {
      contentParts.push(`\nLinked URL: ${post.url}`);
      childLinks.push(post.url);
    }

    // ── Extract URLs from body text ──
    if (post.selftext) {
      const bodyUrls = extractUrlsFromText(post.selftext);
      for (const u of bodyUrls) {
        if (!childLinks.includes(u) && !isRedditMediaUrl(u)) {
          childLinks.push(u);
        }
      }
    }

    // ── Collect image URLs ──
    const imageUrls = collectImageUrls(post).slice(0, MAX_IMAGES);

    if (imageUrls.length > 0) {
      contentParts.push(`\n[${imageUrls.length} image(s) in post]`);

      const imageResults = await Promise.allSettled(
        imageUrls.map(async (imgUrl) => {
          const result = await downloadImageAsBase64(imgUrl);
          if (!result) return `[Image: could not be downloaded]`;

          const imageSource: ExtractedSource = await extractImage(
            result.base64,
            result.mimeType
          );
          return imageSource.extractedContent || imageSource.rawContent;
        })
      );

      const descriptions = imageResults.map((r, i) =>
        r.status === "fulfilled"
          ? r.value
          : `[Image ${i + 1}: processing failed]`
      );

      contentParts.push("\n--- Image Analysis ---");
      descriptions.forEach((desc, i) => {
        contentParts.push(`\nImage ${i + 1}:\n${desc}`);
      });
    }

    // ── Top comments (often contain valuable context) ──
    const commentsListing = data[1] as {
      data?: { children?: { kind?: string; data?: RedditComment }[] };
    };
    const comments = (commentsListing?.data?.children || [])
      .filter((c) => c.kind === "t1" && c.data?.body)
      .slice(0, MAX_COMMENTS);

    if (comments.length > 0) {
      contentParts.push(`\n--- Top Comments ---`);
      for (const c of comments) {
        const cmt = c.data!;
        contentParts.push(`\nu/${cmt.author} (${cmt.ups} upvotes):\n${cmt.body}`);

        // Also pull URLs from comments
        const commentUrls = extractUrlsFromText(cmt.body);
        for (const u of commentUrls) {
          if (!childLinks.includes(u) && !isRedditMediaUrl(u) && !isRedditUrl(u)) {
            childLinks.push(u);
          }
        }
      }
    }

    // ── Metadata ──
    const thumbnailUrl =
      imageUrls[0] ||
      (post.thumbnail && post.thumbnail.startsWith("http") ? post.thumbnail : null) ||
      null;

    const metadata: Record<string, unknown> = {
      platform: "reddit",
      thumbnail_url: thumbnailUrl,
      author: post.author,
      subreddit: post.subreddit,
      title: post.title,
      permalink: canonicalUrl,
      ups: post.ups,
      num_comments: post.num_comments,
      created_utc: post.created_utc,
      flair: post.link_flair_text,
    };

    return {
      url: canonicalUrl,
      type: "reddit",
      content: contentParts.join("\n"),
      childLinks,
      metadata,
    };
  } catch (error) {
    console.error(`[reddit] Failed to extract ${url}:`, error);
    return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function collectImageUrls(post: RedditPost): string[] {
  const urls: string[] = [];

  // Single image post
  if (post.post_hint === "image" && post.url) {
    urls.push(post.url);
  }

  // Preview image
  const preview = post.preview?.images?.[0]?.source?.url;
  if (preview) {
    urls.push(decodeHtmlEntities(preview));
  }

  // Gallery posts (multi-image)
  if (post.gallery_data?.items && post.media_metadata) {
    for (const item of post.gallery_data.items) {
      const meta = post.media_metadata[item.media_id];
      const url = meta?.s?.u;
      if (url) {
        urls.push(decodeHtmlEntities(url));
      }
    }
  }

  // Deduplicate
  return [...new Set(urls)];
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isRedditMediaUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname.includes("redd.it") ||
      urlObj.hostname.includes("redditmedia.com") ||
      urlObj.hostname.includes("redditstatic.com") ||
      urlObj.hostname === "preview.redd.it" ||
      urlObj.hostname === "i.redd.it" ||
      urlObj.hostname === "v.redd.it"
    );
  } catch {
    return false;
  }
}

function extractUrlsFromText(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s\])"']+)/g;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, "")))];
}
