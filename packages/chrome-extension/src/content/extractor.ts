/**
 * Content script for page extraction.
 * Injected on-demand via chrome.scripting.executeScript.
 * Uses a lightweight readability approach to extract article content.
 */

import type { ExtractedPage } from "@/shared/types";

function detectContentType(url: string): ExtractedPage["contentType"] {
  const hostname = new URL(url).hostname.toLowerCase();

  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return "tweet";
  if (hostname.includes("github.com")) return "github";
  if (hostname.includes("youtube.com") || hostname.includes("youtu.be")) return "youtube";
  if (hostname.includes("reddit.com")) return "reddit";

  return "article";
}

function extractMetadata(): { title: string; siteName?: string; byline?: string; description?: string } {
  const title =
    document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    document.querySelector("title")?.textContent ||
    document.title ||
    "Untitled";

  const siteName =
    document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ||
    undefined;

  const byline =
    document.querySelector('meta[name="author"]')?.getAttribute("content") ||
    document.querySelector('[rel="author"]')?.textContent ||
    undefined;

  const description =
    document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
    document.querySelector('meta[name="description"]')?.getAttribute("content") ||
    undefined;

  return { title: title.trim(), siteName, byline, description };
}

function extractArticleContent(): string {
  // Try to find the main content area
  const selectors = [
    "article",
    '[role="main"]',
    "main",
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "#content",
    ".markdown-body", // GitHub
    ".tweet-text",    // Twitter
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 100) {
      return cleanText(el);
    }
  }

  // Fallback: extract body text, stripping nav/footer/sidebar
  const body = document.body.cloneNode(true) as HTMLElement;
  const removeSelectors = [
    "nav", "footer", "header", "aside",
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    ".sidebar", ".nav", ".footer", ".header", ".menu",
    "script", "style", "noscript", "iframe",
  ];

  for (const sel of removeSelectors) {
    body.querySelectorAll(sel).forEach((el) => el.remove());
  }

  return cleanText(body);
}

function cleanText(el: Element): string {
  // Get text content, preserving some structure
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  let node: Text | null;

  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent?.trim();
    if (text && text.length > 0) {
      texts.push(text);
    }
  }

  return texts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50_000); // Cap at 50k chars
}

function extractTweetContent(): string {
  // Twitter/X specific extraction
  const tweetTexts = document.querySelectorAll('[data-testid="tweetText"]');
  if (tweetTexts.length > 0) {
    return Array.from(tweetTexts)
      .map((el) => el.textContent?.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return extractArticleContent();
}

function extractGitHubContent(): string {
  // GitHub README extraction
  const readme = document.querySelector(".markdown-body");
  if (readme) {
    return cleanText(readme);
  }

  // Fallback to repo description
  const description = document.querySelector('[itemprop="about"]');
  if (description) {
    return description.textContent?.trim() || extractArticleContent();
  }

  return extractArticleContent();
}

// ── Main extraction logic ───────────────────────────────────────────

(function extract(): ExtractedPage {
  const url = window.location.href;
  const contentType = detectContentType(url);
  const metadata = extractMetadata();

  let content: string;

  switch (contentType) {
    case "tweet":
      content = extractTweetContent();
      break;
    case "github":
      content = extractGitHubContent();
      break;
    default:
      content = extractArticleContent();
      break;
  }

  const wordCount = content.split(/\s+/).length;

  const result: ExtractedPage = {
    title: metadata.title,
    content,
    excerpt: (metadata.description || content.slice(0, 200) + "...").slice(0, 300),
    url,
    siteName: metadata.siteName,
    byline: metadata.byline,
    contentType,
    wordCount,
  };

  return result;
})();
