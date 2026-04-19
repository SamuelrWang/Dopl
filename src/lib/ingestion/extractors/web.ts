import { ExtractedSource, LinkFollowResult, SourceStatusReason } from "../types";
import { fetchWithTimeout, retryWithBackoff } from "../utils";
import { assertPublicHttpUrl } from "../url-safety";
import { MAX_LINK_DEPTH } from "@/lib/config";
const MAX_CONTENT_LENGTH = 50_000; // 50K chars max per page

/**
 * Typed extractor failure. Thrown from content validators so the caller
 * (followAndStore) can read a precise `statusReason` and persist a
 * meaningful failed-source row for audit / agent-visible fetch_warnings.
 *
 * Also mirrors `fetchStatusCode` as `.status` on the Error instance.
 * `utils.isTransientError` (the retry guard used by Firecrawl/Jina
 * wrappers in retryWithBackoff) follows the SDK convention of reading
 * `.status` off the error — without this, 429/5xx responses from the
 * extraction services wouldn't trigger the exponential-backoff retry
 * loop, and transient upstream errors would fail ingests that should
 * have succeeded on the second attempt.
 */
export class ExtractorError extends Error {
  readonly statusReason: SourceStatusReason;
  readonly fetchStatusCode: number | null;
  readonly status?: number;
  constructor(statusReason: SourceStatusReason, message: string, fetchStatusCode: number | null = null) {
    super(message);
    this.name = "ExtractorError";
    this.statusReason = statusReason;
    this.fetchStatusCode = fetchStatusCode;
    if (fetchStatusCode !== null) {
      this.status = fetchStatusCode;
    }
  }
}

const MIN_ACCEPTABLE_CONTENT_CHARS = 100;

/**
 * Detect content bodies that look like valid HTTP responses but are
 * actually disguised errors — the pipeline was previously storing these
 * as if they were real content and poisoning downstream prompts.
 *
 * Cases caught:
 *   - S3 AccessDenied XML returned with 200 from origin (hotlink-
 *     protected assets). Shape: starts with `<?xml` + contains
 *     `AccessDenied` / `<Error>`.
 *   - Vendor-served 404 pages (Mintlify, npm) returned with HTTP 200.
 *     Shape: title matches "Page Not Found" / "not found" /
 *     "Route not found", body is small-ish boilerplate.
 *   - Empty or near-empty bodies — nothing to synthesize from.
 *
 * Throws `ExtractorError` with a precise `statusReason`. The callers
 * are the fetch wrappers (Firecrawl, Jina, simple) — running validation
 * there (as opposed to downstream after storage) means garbage never
 * touches the `sources` table as a successful row.
 */
export function validateExtractedContent(content: string, url: string): void {
  const trimmed = content.trim();

  if (trimmed.length < MIN_ACCEPTABLE_CONTENT_CHARS) {
    throw new ExtractorError(
      "empty_content",
      `Extractor returned <${MIN_ACCEPTABLE_CONTENT_CHARS} chars for ${url}`
    );
  }

  // S3-style error XML. These come in several flavors (AccessDenied,
  // NoSuchKey, PermanentRedirect) but all start with <?xml and have
  // <Error>/<Code> markers within the first ~500 chars.
  const head = trimmed.slice(0, 500);
  if (head.startsWith("<?xml") && (/\bAccessDenied\b/.test(head) || /<Error>/.test(head))) {
    throw new ExtractorError(
      "access_denied_body",
      `Origin returned XML error body for ${url}`
    );
  }

  // Vendor 404 pages served with HTTP 200. We can't tell from the status
  // line; the signal is in the content. Common patterns from Mintlify
  // (docs.*), Vercel, npm registry pages, and GitHub Pages "not found"
  // templates.
  const notFoundSignatures = [
    /<title>[^<]{0,40}(Page Not Found|Not Found|Route not found)/i,
    /^#?\s*not found\s*$/im,
    /Route not found!/i,
  ];
  // Only treat as 404-page if the body is also small (real pages that
  // mention "not found" in prose are long). This keeps false positives
  // low while catching boilerplate 404 bodies.
  if (trimmed.length < 4_000 && notFoundSignatures.some((r) => r.test(trimmed))) {
    throw new ExtractorError(
      "http_4xx",
      `Origin served a 404 page body for ${url}`
    );
  }
}

export async function extractWebContent(
  url: string,
  depth: number = 0
): Promise<LinkFollowResult | null> {
  if (depth > MAX_LINK_DEPTH) return null;

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

  // Validate AFTER fetch: catches garbage that slipped through the HTTP
  // status check (S3 AccessDenied XML returned with 200, Mintlify 404
  // pages, empty bodies). Throws ExtractorError which bubbles to
  // followAndStore; followAndStore records the failure as a status='failed'
  // source row for audit and for the agent's fetch_warnings surface.
  validateExtractedContent(content, url);

  const childLinks = extractUrls(content);

  return {
    url,
    type: "other",
    content,
    childLinks,
    metadata,
  };
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
    throw new ExtractorError(
      response.status >= 500 ? "http_5xx" : "http_4xx",
      `Firecrawl error: ${response.status}`,
      response.status
    );
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
    throw new ExtractorError(
      response.status >= 500 ? "http_5xx" : "http_4xx",
      `Jina error: ${response.status}`,
      response.status
    );
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
    throw new ExtractorError(
      response.status >= 500 ? "http_5xx" : "http_4xx",
      `Fetch error: ${response.status}`,
      response.status
    );
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

/**
 * Skip-list for link-following. Matches path segments and file extensions
 * that are known-low-value (CI configs, tests, build artifacts, lockfiles) —
 * these rarely add synthesis signal and often blow the gathered_content
 * budget. Called by the pipeline before spending a maxLinks slot.
 *
 * Keep the patterns broad enough to handle both raw GitHub URLs
 * (github.com/owner/repo/tree/main/tests) and docs-site URLs
 * (site.com/docs/.github/workflows/...). Matches path only, not query string.
 */
const SKIP_PATH_PATTERNS: RegExp[] = [
  /\/\.github\/workflows\//i,
  /\/\.github\/actions\//i,
  /\/tests?\//i,
  /\/__tests__\//i,
  /\/spec\//i,
  /\/e2e\//i,
  /\/dist\//i,
  /\/build\//i,
  /\/out\//i,
  /\/node_modules\//i,
];

const SKIP_EXT_PATTERNS: RegExp[] = [
  /\.lock$/i,
  /\.lockb$/i,
  /\.min\.js$/i,
  /\.min\.css$/i,
  /\.map$/i,
];

export function shouldSkipLink(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    if (SKIP_PATH_PATTERNS.some((p) => p.test(pathname))) return true;
    if (SKIP_EXT_PATTERNS.some((p) => p.test(pathname))) return true;
    return false;
  } catch {
    // Malformed URL — let the downstream fetcher deal with it rather than
    // silently dropping it here.
    return false;
  }
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
