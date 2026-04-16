import { ExtractedSource, LinkFollowResult } from "../types";
import { fetchWithTimeout, retryWithBackoff } from "../utils";
import { assertPublicHttpUrl } from "../url-safety";
import { MAX_LINK_DEPTH } from "@/lib/config";
const MAX_CONTENT_LENGTH = 50_000; // 50K chars max per page

export async function extractWebContent(
  url: string,
  depth: number = 0
): Promise<LinkFollowResult | null> {
  if (depth > MAX_LINK_DEPTH) return null;

  try {
    let content: string;
    let metadata: Record<string, unknown> = {};

    if (process.env.FIRECRAWL_API_KEY) {
      const result = await retryWithBackoff(
        () => fetchWithFirecrawl(url),
        { label: `Firecrawl:${url}` }
      );
      content = result.content;
      metadata = result.metadata;
    } else if (process.env.JINA_API_KEY) {
      const result = await retryWithBackoff(
        () => fetchWithJina(url),
        { label: `Jina:${url}` }
      );
      content = result.content;
      metadata = result.metadata;
    } else {
      console.warn(`[web] No FIRECRAWL_API_KEY or JINA_API_KEY set — using basic HTML fallback for ${url}. Content quality may be degraded.`);
      const result = await fetchSimple(url);
      content = result.content;
      metadata = result.metadata;
    }

    const childLinks = extractUrls(content);

    return {
      url,
      type: "other",
      content,
      childLinks,
      metadata,
    };
  } catch (error) {
    console.error(`Failed to extract web content from ${url}:`, error);
    return null;
  }
}

async function fetchWithFirecrawl(
  url: string
): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const response = await fetchWithTimeout(
    "https://api.firecrawl.dev/v1/scrape",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        onlyMainContent: true,
        formats: ["markdown"],
      }),
      timeoutMs: 30_000,
    }
  );

  if (!response.ok) {
    throw new Error(`Firecrawl error: ${response.status}`);
  }

  const data = await response.json();
  const content = (data.data?.markdown || data.data?.content || "").slice(
    0,
    MAX_CONTENT_LENGTH
  );

  return {
    content,
    metadata: {
      title: data.data?.metadata?.title,
      description: data.data?.metadata?.description,
      thumbnail_url: data.data?.metadata?.ogImage || data.data?.metadata?.["og:image"] || null,
    },
  };
}

async function fetchWithJina(
  url: string
): Promise<{ content: string; metadata: Record<string, unknown> }> {
  const response = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
    headers: {
      Authorization: `Bearer ${process.env.JINA_API_KEY}`,
      Accept: "application/json",
    },
    timeoutMs: 30_000,
  });

  if (!response.ok) {
    throw new Error(`Jina error: ${response.status}`);
  }

  const data = await response.json();
  const content = (data.content || data.text || "").slice(
    0,
    MAX_CONTENT_LENGTH
  );

  return {
    content,
    metadata: {
      title: data.title,
      thumbnail_url: data.image || data.data?.image || null,
    },
  };
}

async function fetchSimple(
  url: string
): Promise<{ content: string; metadata: Record<string, unknown> }> {
  // SSRF guard — refuse to fetch private / loopback / metadata URLs
  // even if the user tries to sneak them through via redirect-chasing
  // or hand-crafted inputs.
  await assertPublicHttpUrl(url);

  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; DoplBot/1.0; +https://example.com/bot)",
    },
    timeoutMs: 15_000,
  });

  if (!response.ok) {
    throw new Error(`Fetch error: ${response.status}`);
  }

  const html = await response.text();

  // Extract OG metadata before stripping HTML
  const ogImage = extractOgImage(html);
  const ogTitle = extractMetaContent(html, "og:title");
  const ogDescription = extractMetaContent(html, "og:description");

  // Strip non-content elements first (nav, header, footer, aside, script, style)
  let cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "");

  // Try to extract content from <main> or <article> tags first
  const mainMatch = cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const articleMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const contentHtml = mainMatch?.[1] || articleMatch?.[1] || cleaned;

  const text = contentHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    content: text.slice(0, MAX_CONTENT_LENGTH),
    metadata: {
      thumbnail_url: ogImage,
      title: ogTitle,
      description: ogDescription,
    },
  };
}

function extractMetaContent(html: string, property: string): string | null {
  const match = html.match(
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, "i")
  ) || html.match(
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, "i")
  );
  return match?.[1] || null;
}

function extractUrls(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s)"']+)/g;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?]+$/, "")))];
}

function extractOgImage(html: string): string | null {
  const match = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
  ) || html.match(
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i
  );
  return match?.[1] || null;
}

const linkTypeToSourceType: Record<string, ExtractedSource["sourceType"]> = {
  blog: "blog_post",
  github_repo: "github_repo",
  github_file: "github_file",
  tweet: "tweet_text",
  instagram: "instagram_post",
  reddit: "reddit_post",
};

export function linkResultToSource(
  result: LinkFollowResult,
  depth: number
): ExtractedSource {
  return {
    url: result.url,
    sourceType: linkTypeToSourceType[result.type] || "other",
    rawContent: result.content,
    contentMetadata: result.metadata,
    depth,
    childLinks: result.childLinks,
  };
}
