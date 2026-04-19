import { Octokit } from "@octokit/rest";
import { fetchWithTimeout } from "./utils";
import { assertPublicHttpUrl, UnsafeUrlError } from "./url-safety";

/**
 * Lightweight per-URL metadata fetcher. Powers the `describe_link`
 * MCP tool — called by the agent AFTER filtering `detected_links[]`
 * locally, only for the handful of candidates (typically 2-5) that
 * the agent might present to the user as separate-entry offers.
 *
 * Key design point: we don't run full extraction here. That already
 * lives in `extractForAgent` and is bounded to ~15s per call. Here
 * we want <1s per URL by fetching only the source's OWN self-
 * description — repo description from the GitHub API, og:description
 * from an HTML meta tag, arxiv abstract excerpt. Those are always
 * more informative than "surrounding text" heuristics on the primary
 * README (most README links are bullet-list or badge refs with no
 * meaningful surrounding context anyway).
 *
 * The Octokit instance is module-scoped (singleton) so the same auth
 * token is reused across calls. GitHub API calls are cheap and cached
 * by GitHub's CDN; repeated calls for the same repo return in ~50ms.
 */

const DESCRIBE_TIMEOUT_MS = 5_000;

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: { timeout: DESCRIBE_TIMEOUT_MS },
});

export type LinkType =
  | "github_repo"
  | "github_org"
  | "github_user"
  | "github_path"
  | "arxiv_paper"
  | "npm_package"
  | "youtube_video"
  | "web_page"
  | "unknown";

export interface LinkDescription {
  url: string;
  type: LinkType;
  title: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  /** Present only when the fetch failed; caller decides whether to surface. */
  error?: string;
}

export async function describeLink(url: string): Promise<LinkDescription> {
  // SSRF guard — the same check the extractor's fetch wrappers apply.
  // Mirrors /api/ingest/content which also gates on public HTTP URLs.
  try {
    await assertPublicHttpUrl(url);
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return failure(url, "unknown", err.message);
    }
    throw err;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return failure(url, "unknown", "Invalid URL");
  }

  const host = parsed.hostname.toLowerCase();

  try {
    if (host === "github.com" || host.endsWith(".github.com")) {
      return await describeGithub(parsed);
    }
    if (host === "arxiv.org" || host.endsWith(".arxiv.org")) {
      return await describeArxiv(parsed);
    }
    if (host === "www.npmjs.com" || host === "npmjs.com") {
      return await describeNpm(parsed);
    }
    if (host === "youtube.com" || host === "www.youtube.com" || host === "youtu.be") {
      return await describeWebPage(url, "youtube_video");
    }
    return await describeWebPage(url, "web_page");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(url, "unknown", message);
  }
}

function failure(url: string, type: LinkType, error: string): LinkDescription {
  return { url, type, title: null, description: null, metadata: {}, error };
}

/**
 * GitHub URL dispatch. Routes repo URLs (`/owner/repo`) through the
 * repos API for the canonical description; org URLs (`/owner`)
 * through the orgs/users API. Path URLs (`/owner/repo/tree/...`)
 * are treated as repo descriptions — the path itself is rarely
 * informative compared to the parent repo's one-liner.
 */
async function describeGithub(parsed: URL): Promise<LinkDescription> {
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return {
      url: parsed.toString(),
      type: "unknown",
      title: "GitHub",
      description: "Code hosting and collaboration platform.",
      metadata: {},
    };
  }
  if (parts.length === 1) {
    // Owner root — could be an org or a user. Try orgs first since
    // octokit returns the right error code for users.
    const owner = parts[0];
    try {
      const org = await octokit.orgs.get({ org: owner });
      return {
        url: parsed.toString(),
        type: "github_org",
        title: org.data.name ?? org.data.login,
        description: org.data.description ?? null,
        metadata: {
          login: org.data.login,
          public_repos: org.data.public_repos,
          blog: org.data.blog,
        },
      };
    } catch {
      // Fallback: treat as user account.
      try {
        const user = await octokit.users.getByUsername({ username: owner });
        return {
          url: parsed.toString(),
          type: "github_user",
          title: user.data.name ?? user.data.login,
          description: user.data.bio ?? null,
          metadata: {
            login: user.data.login,
            public_repos: user.data.public_repos,
            company: user.data.company,
          },
        };
      } catch (userErr) {
        const msg = userErr instanceof Error ? userErr.message : "unknown";
        return failure(parsed.toString(), "github_user", msg);
      }
    }
  }

  // Repo URL or deeper. Always describe the repo, not the sub-path —
  // the sub-path's contents don't have their own description, and the
  // repo's one-liner is the most useful signal for a "should I ingest
  // this as a separate entry" decision.
  const owner = parts[0];
  const repo = parts[1];
  const isSubPath = parts.length > 2;

  const repoInfo = await octokit.repos.get({ owner, repo });
  return {
    url: parsed.toString(),
    type: isSubPath ? "github_path" : "github_repo",
    title: `${owner}/${repo}`,
    description: repoInfo.data.description ?? null,
    metadata: {
      owner,
      repo,
      stars: repoInfo.data.stargazers_count,
      language: repoInfo.data.language,
      license: repoInfo.data.license?.spdx_id ?? null,
      pushed_at: repoInfo.data.pushed_at,
      topics: repoInfo.data.topics ?? [],
      ...(isSubPath ? { sub_path: parts.slice(2).join("/") } : {}),
    },
  };
}

/**
 * arxiv URL. The canonical `/abs/<id>` route renders a human-readable
 * abstract page whose HTML `<title>` and `citation_title` meta tag
 * carry the paper title, and `citation_abstract` carries the full
 * abstract. We pull those directly rather than scraping the full page.
 */
async function describeArxiv(parsed: URL): Promise<LinkDescription> {
  const response = await fetchWithTimeout(parsed.toString(), {
    timeoutMs: DESCRIBE_TIMEOUT_MS,
    headers: { Accept: "text/html" },
  });
  if (!response.ok) {
    return failure(parsed.toString(), "arxiv_paper", `arxiv fetch failed: ${response.status}`);
  }
  const html = await response.text();
  const title = extractMetaContent(html, "citation_title") ?? extractTitleTag(html);
  const abstract = extractMetaContent(html, "citation_abstract");
  // arxiv abstracts are long; cap to keep the describe response tight.
  const description = abstract ? truncateAtSentence(abstract, 400) : null;
  const authors = extractMetaContentAll(html, "citation_author");
  return {
    url: parsed.toString(),
    type: "arxiv_paper",
    title,
    description,
    metadata: {
      authors,
      arxiv_id: parsed.pathname.replace(/^\/abs\//, "").replace(/\/$/, ""),
    },
  };
}

/**
 * npm package URL. npmjs.com pages embed the package manifest in a
 * `<script id="__NEXT_DATA__">` block, but pulling the HTML meta
 * description is easier and usually sufficient. The og:description
 * is the package's own description field.
 */
async function describeNpm(parsed: URL): Promise<LinkDescription> {
  const packagePath = parsed.pathname.replace(/^\/package\//, "");
  return describeWebPage(parsed.toString(), "npm_package", { package: packagePath });
}

async function describeWebPage(
  url: string,
  type: LinkType,
  extraMetadata: Record<string, unknown> = {}
): Promise<LinkDescription> {
  const response = await fetchWithTimeout(url, {
    timeoutMs: DESCRIBE_TIMEOUT_MS,
    headers: {
      Accept: "text/html",
      "User-Agent":
        "Mozilla/5.0 (compatible; DoplLinkDescriber/1.0; +https://www.usedopl.com)",
    },
  });
  if (!response.ok) {
    return failure(url, type, `fetch failed: ${response.status}`);
  }
  const html = await response.text();
  // Prefer OG/Twitter description (author-curated) over the generic meta,
  // which is sometimes auto-generated boilerplate.
  const description =
    extractMetaContent(html, "og:description") ??
    extractMetaContent(html, "twitter:description") ??
    extractMetaContent(html, "description");
  const title =
    extractMetaContent(html, "og:title") ??
    extractMetaContent(html, "twitter:title") ??
    extractTitleTag(html);
  const siteName = extractMetaContent(html, "og:site_name");
  return {
    url,
    type,
    title,
    description,
    metadata: {
      ...(siteName ? { site_name: siteName } : {}),
      ...extraMetadata,
    },
  };
}

function extractMetaContent(html: string, name: string): string | null {
  // Handles both <meta name="x" content="..."> and property="x",
  // and the reverse attribute order. Case-insensitive.
  const patterns = [
    new RegExp(
      `<meta[^>]*(?:name|property)=["']${escapeRe(name)}["'][^>]*content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${escapeRe(name)}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return decodeHtmlEntities(match[1]);
  }
  return null;
}

function extractMetaContentAll(html: string, name: string): string[] {
  const re = new RegExp(
    `<meta[^>]*(?:name|property)=["']${escapeRe(name)}["'][^>]*content=["']([^"']+)["']`,
    "gi"
  );
  const results: string[] = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    results.push(decodeHtmlEntities(match[1]));
  }
  return results;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Truncate a string at a sentence boundary if possible, otherwise a
 * word boundary. Used for arxiv abstracts and long meta descriptions
 * so the describe response stays tight.
 */
function truncateAtSentence(s: string, maxLength: number): string {
  if (s.length <= maxLength) return s;
  const slice = s.slice(0, maxLength);
  const lastSentence = slice.lastIndexOf(". ");
  if (lastSentence > maxLength * 0.6) return slice.slice(0, lastSentence + 1);
  const lastSpace = slice.lastIndexOf(" ");
  return lastSpace > 0 ? slice.slice(0, lastSpace) + "…" : slice + "…";
}
