import { ApifyClient } from "apify-client";
import { LinkFollowResult } from "../types";
import { extractImage } from "./image";
import { ExtractedSource } from "../types";
import { downloadImageAsBase64 } from "../utils";

const APIFY_INSTAGRAM_ACTOR = "apify/instagram-post-scraper";
const APIFY_TIMEOUT_SECS = 120; // 2 minute max for Apify actor run
const MAX_IMAGES_PER_POST = 20; // Instagram carousels max at 20

interface ApifyInstagramResult {
  shortCode?: string;
  caption?: string;
  hashtags?: string[];
  url?: string;
  commentsCount?: number;
  likesCount?: number;
  timestamp?: string;
  ownerUsername?: string;
  ownerFullName?: string;
  images?: string[];
  displayUrl?: string;
  videoUrl?: string;
  type?: string; // "Image", "Video", "Sidecar" (carousel)
  childPosts?: {
    displayUrl?: string;
    videoUrl?: string;
    type?: string;
  }[];
}

/**
 * Extract content from an Instagram post using Apify's Instagram Post Scraper.
 * Handles single images, carousels (sidecars), and videos.
 * Requires APIFY_API_KEY env var.
 */
export async function extractInstagramContent(
  url: string,
  depth: number = 0
): Promise<LinkFollowResult | null> {
  if (!process.env.APIFY_API_KEY) {
    console.error("APIFY_API_KEY not set — cannot extract Instagram content");
    return null;
  }

  try {
    const normalizedUrl = normalizeInstagramUrl(url);
    if (!normalizedUrl) return null;

    const client = new ApifyClient({ token: process.env.APIFY_API_KEY });

    // Run the Instagram Post Scraper actor with timeout
    const run = await client.actor(APIFY_INSTAGRAM_ACTOR).call(
      {
        directUrls: [normalizedUrl],
        resultsLimit: 1,
      },
      { timeout: APIFY_TIMEOUT_SECS }
    );

    // Fetch results from the dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    if (!items || items.length === 0) {
      console.error(`Apify returned no results for ${url}`);
      return null;
    }

    const post = items[0] as ApifyInstagramResult;

    const contentParts: string[] = [];
    const childLinks: string[] = [];
    const metadata: Record<string, unknown> = {
      platform: "instagram",
      author: post.ownerUsername,
      author_name: post.ownerFullName,
      short_code: post.shortCode,
      post_type: post.type,
      thumbnail_url: post.displayUrl || null,
      timestamp: post.timestamp,
      likes: post.likesCount,
      comments: post.commentsCount,
    };

    // -- Caption --
    contentParts.push(`@${post.ownerUsername || "unknown"}:`);
    if (post.caption) {
      contentParts.push(post.caption);
    }

    // -- Hashtags --
    if (post.hashtags && post.hashtags.length > 0) {
      metadata.hashtags = post.hashtags;
    }

    // -- Extract URLs from caption --
    if (post.caption) {
      const captionUrls = extractUrlsFromText(post.caption);
      for (const u of captionUrls) {
        if (!isInstagramUrl(u)) {
          childLinks.push(u);
        }
      }
    }

    // -- Collect all image URLs to process --
    const imageUrls: string[] = [];

    if (post.type === "Sidecar" && post.childPosts) {
      for (const child of post.childPosts) {
        if (child.displayUrl && child.type !== "Video") {
          imageUrls.push(child.displayUrl);
        }
      }
    } else if (post.displayUrl) {
      imageUrls.push(post.displayUrl);
    }

    if (post.images) {
      for (const imgUrl of post.images) {
        if (!imageUrls.includes(imgUrl)) {
          imageUrls.push(imgUrl);
        }
      }
    }

    // Cap images to prevent runaway processing
    const limitedImageUrls = imageUrls.slice(0, MAX_IMAGES_PER_POST);

    // -- Process images through Claude Vision (parallelized) --
    if (limitedImageUrls.length > 0) {
      contentParts.push(`\n[${limitedImageUrls.length} image(s)]`);

      const imageResults = await Promise.allSettled(
        limitedImageUrls.map(async (imgUrl) => {
          const result = await downloadImageAsBase64(imgUrl);
          if (!result) return `[Image: could not be downloaded]`;

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

    // -- Video --
    if (post.videoUrl || post.type === "Video") {
      contentParts.push("\n[Video attached — not analyzed]");
      metadata.has_video = true;
      if (post.videoUrl) metadata.video_url = post.videoUrl;
    }

    if (post.childPosts) {
      const videoChildren = post.childPosts.filter((c) => c.type === "Video");
      if (videoChildren.length > 0) {
        contentParts.push(
          `\n[${videoChildren.length} video(s) in carousel — not analyzed]`
        );
        metadata.has_video = true;
      }
    }

    return {
      url,
      type: "instagram",
      content: contentParts.join("\n"),
      childLinks,
      metadata,
    };
  } catch (error) {
    console.error(`Failed to extract Instagram content from ${url}:`, error);
    return null;
  }
}

// -- Helpers --

export function isInstagramUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "");
    return hostname === "instagram.com" || hostname === "instagr.am";
  } catch {
    return false;
  }
}

export function isInstagramPostUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "");
    if (hostname !== "instagram.com" && hostname !== "instagr.am") return false;

    const path = urlObj.pathname;
    return /^\/(p|reel)\/[\w-]+/.test(path);
  } catch {
    return false;
  }
}

function normalizeInstagramUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace("www.", "");
    if (hostname !== "instagram.com" && hostname !== "instagr.am") return null;

    const path = urlObj.pathname;
    const match = path.match(/^\/(p|reel)\/([\w-]+)/);
    if (!match) return null;

    return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  } catch {
    return null;
  }
}

function extractUrlsFromText(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?)]+$/, "")))];
}
