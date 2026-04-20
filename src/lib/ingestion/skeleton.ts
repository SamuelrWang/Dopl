import { Octokit } from "@octokit/rest";
import { callClaude, generateEmbedding } from "@/lib/ai";
import { supabaseAdmin } from "@/lib/supabase";
import { slugifyEntryTitle, fallbackSlugFromId } from "@/lib/entries/slug";
import { logSystemEvent } from "@/lib/analytics/system-events";
import {
  SKELETON_DESCRIPTOR_PROMPT_VERSION,
  buildSkeletonDescriptorPrompt,
  parseSkeletonStructuredOutput,
  type SkeletonStructuredOutput,
} from "@/lib/prompts/skeleton-descriptor";

/**
 * Skeleton-tier ingestion pipeline.
 *
 * Replaces the full manifest + README + agents.md + multi-chunk-embedding
 * flow with one Sonnet call that produces a structured descriptor (title,
 * summary, tags, classification, prose), plus a single embedding for
 * search and GitHub-derived metadata for browse cards. Much cheaper than
 * full ingestion (one LLM call instead of three, single chunk instead of
 * dozens) but rich enough to be searchable and recognizable.
 *
 * Runs in the background just like the full pipeline — the admin-only
 * caller (api/admin/skeleton-ingest/route.ts) POSTs a URL, we insert the
 * row at tier="skeleton" / status="processing" and kick off the pipeline
 * without awaiting.
 */

const GITHUB_TIMEOUT_MS = 15_000;

const SKELETON_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Public entry point called by POST /api/ingest when tier="skeleton".
 *
 * Mirrors the shape of `ingestEntry` in pipeline.ts: creates the row,
 * returns the id immediately, runs the pipeline in the background.
 */
export async function ingestEntrySkeleton(input: {
  url: string;
  userId?: string;
}): Promise<string> {
  const supabase = supabaseAdmin();
  const entryId = crypto.randomUUID();

  // Set the GitHub social-preview image as the thumbnail at row creation
  // time. It's deterministic per repo, free, and turns the browse card
  // from "untitled grey square" into a recognizable preview the moment
  // the row exists — well before the LLM finishes the descriptor.
  const parsedRepo = parseRepoUrl(input.url);
  const thumbnailUrl = parsedRepo
    ? `https://opengraph.githubassets.com/1/${parsedRepo.owner}/${parsedRepo.repo}`
    : null;

  const { error: createError } = await supabase.from("entries").insert({
    id: entryId,
    source_url: input.url,
    source_platform: "github",
    status: "processing",
    ingestion_tier: "skeleton",
    ingested_by: input.userId ?? null,
    slug: fallbackSlugFromId(entryId),
    thumbnail_url: thumbnailUrl,
    // Skeleton ingestion is admin-only — auto-approve so entries are
    // searchable immediately without a human moderation queue.
    moderation_status: "approved",
  });

  if (createError) {
    throw new Error(`Failed to create skeleton entry: ${createError.message}`);
  }

  // Background with a hard timeout — keeps a wedged external API from
  // leaving the row in "processing" forever.
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Skeleton pipeline timed out after ${SKELETON_TIMEOUT_MS}ms`)),
      SKELETON_TIMEOUT_MS
    )
  );

  void Promise.race([
    runSkeletonIngest({ entryId, url: input.url, userId: input.userId }),
    timeoutPromise,
  ]).catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    await failEntry(entryId, message);
  });

  return entryId;
}


// Anonymous GitHub API access is limited to 60 req/hr, which a mass
// skeleton ingest run will exhaust in under a minute. Surface the
// missing-token case at module load so ops catches it before a batch.
if (!process.env.GITHUB_TOKEN) {
  console.warn(
    "[skeleton] GITHUB_TOKEN is not set — Octokit will use anonymous 60/hr limit, " +
      "which WILL rate-limit any non-trivial mass ingest."
  );
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: { timeout: GITHUB_TIMEOUT_MS },
});

interface SkeletonInput {
  entryId: string;
  url: string;
  userId?: string;
}

interface GitHubFacts {
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  stars: number;
  license: string | null;
  pushedAt: string | null;
  headSha: string | null;
  topics: string[];
  readmeExcerpt: string;
  fileTree: string;
  topLevelFiles: string[];
  topLevelDirs: string[];
  defaultBranch: string;
}

interface SkeletonTag {
  tag_type: string;
  tag_value: string;
}

export async function runSkeletonIngest(input: SkeletonInput): Promise<void> {
  const supabase = supabaseAdmin();
  const { entryId, url, userId } = input;

  try {
    // gatherGitHubFacts throws on GitHub API errors (rate-limit, 5xx);
    // returns null only when the URL itself isn't a parseable repo URL.
    // The distinction matters — ops needs to see rate-limit separately
    // from user error.
    const facts = await gatherGitHubFacts(url);
    if (!facts) {
      await failEntry(entryId, "Not a recognizable GitHub repo URL");
      return;
    }

    const metadata = {
      owner: facts.owner,
      repo: facts.repo,
      description: facts.description,
      language: facts.language,
      stars: facts.stars,
      license: facts.license,
      pushed_at: facts.pushedAt,
      topics: facts.topics,
    };

    // Build a compact source view for the LLM. The descriptor prompt only
    // needs enough signal to answer "what is this and what is it for" —
    // pouring in more content wastes tokens without sharpening the output.
    const repoContent = [
      `# ${facts.owner}/${facts.repo}`,
      facts.description ? `\nDescription: ${facts.description}` : "",
      facts.language ? `\nPrimary language: ${facts.language}` : "",
      facts.topics.length ? `\nTopics: ${facts.topics.join(", ")}` : "",
      facts.license ? `\nLicense: ${facts.license}` : "",
      `\n\n## README (truncated)\n${facts.readmeExcerpt}`,
      `\n\n## File tree (top level)\n${facts.fileTree}`,
    ]
      .filter(Boolean)
      .join("");

    const prompt = buildSkeletonDescriptorPrompt(repoContent, metadata, url);

    const structured = await generateStructuredDescriptor(prompt);
    if (!structured) {
      await failEntry(entryId, "Descriptor generation returned unparseable output after retry");
      return;
    }

    // Compose final descriptor markdown. Prepend a "Key capabilities"
    // section if the LLM produced one — it lives at the top because it's
    // the most-scanned region of the entry detail page.
    const descriptorBody = composeDescriptorMarkdown(structured);

    const summary = structured.summary || extractSummary(descriptorBody, facts.description);
    const title = structured.title || facts.repo || `${facts.owner}/${facts.repo}`;
    const slug = await generateSkeletonSlug(entryId, title);

    // Embed FIRST so search is functional the moment status flips to
    // "complete". Tags and descriptor update only run after the chunk
    // lands — otherwise a poller seeing "complete" might find an entry
    // that isn't searchable yet, or read a descriptor that a subsequent
    // embedding failure would orphan.
    await embedDescriptor(entryId, descriptorBody);

    // Tags from three sources, deduped:
    //  - GitHub metadata (language, topic, license) — always cheap, always present
    //  - LLM-derived (purpose, framework, integration) — high signal, occasionally hallucinated
    //  - Framework detection from package.json/pyproject.toml — concrete dep evidence
    //  - Heuristic buckets (popularity, activity, presence flags) — UX signals
    const githubMetadataTags = deriveGithubMetadataTags(facts);
    const heuristicTags = deriveHeuristicTags(facts);
    const frameworkTags = await detectFrameworkTags(facts);
    const allTags = dedupeTags([
      ...githubMetadataTags,
      ...heuristicTags,
      ...frameworkTags,
      ...structured.tags,
    ]);
    await writeSkeletonTags(entryId, allTags);

    // Final write: content fields + status=complete in one atomic update.
    const { error: updateError } = await supabase
      .from("entries")
      .update({
        status: "complete",
        ingestion_tier: "skeleton",
        title,
        summary,
        slug,
        descriptor: descriptorBody,
        github_sha: facts.headSha,
        descriptor_prompt_version: SKELETON_DESCRIPTOR_PROMPT_VERSION,
        content_type: structured.content_type,
        complexity: structured.complexity,
        use_case: structured.use_case,
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId);

    if (updateError) {
      throw new Error(`Failed to update entry: ${updateError.message}`);
    }

    void logSystemEvent({
      severity: "info",
      category: "ingestion",
      source: "skeleton.runSkeletonIngest",
      message: "Skeleton ingest complete",
      fingerprintKeys: ["skeleton", "complete"],
      metadata: {
        entry_id: entryId,
        owner: facts.owner,
        repo: facts.repo,
        descriptor_chars: descriptorBody.length,
        tag_count: allTags.length,
        user_id: userId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failEntry(entryId, message);
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "skeleton.runSkeletonIngest",
      message: `Skeleton ingest failed: ${message}`,
      fingerprintKeys: ["skeleton", "failed"],
      metadata: { entry_id: entryId, url, user_id: userId },
    });
  }
}

/**
 * Run the LLM call and parse the structured output. Retries the call once
 * if the first response isn't parseable — Claude occasionally wraps JSON
 * in fences or adds a preamble despite the prompt forbidding it, and a
 * single retry catches almost all of those cases.
 */
async function generateStructuredDescriptor(
  prompt: string
): Promise<SkeletonStructuredOutput | null> {
  const system =
    "You produce structured JSON descriptors of GitHub repositories. Output a single JSON object. No prose, no markdown fences. The first character of your reply must be `{`.";

  const first = await callClaude(system, prompt, { model: "sonnet", maxTokens: 2500 });
  const parsed = parseSkeletonStructuredOutput(first);
  if (parsed) return parsed;

  // One retry with a sharper instruction. Use the prior bad output as
  // negative-example context so Claude knows not to repeat the wrapper.
  const retryPrompt = `${prompt}

Your previous reply was not valid JSON. Output ONLY the JSON object. No fences, no preamble, no commentary. The first character must be \`{\`.`;
  const retry = await callClaude(system, retryPrompt, { model: "sonnet", maxTokens: 2500 });
  return parseSkeletonStructuredOutput(retry);
}

function composeDescriptorMarkdown(s: SkeletonStructuredOutput): string {
  const parts: string[] = [];
  if (s.key_capabilities.length > 0) {
    parts.push("## Key capabilities");
    for (const cap of s.key_capabilities) {
      parts.push(`- ${cap}`);
    }
    parts.push("");
  }
  parts.push(s.descriptor.trim());
  return parts.join("\n");
}

// ── GitHub metadata gathering ────────────────────────────────────────

async function gatherGitHubFacts(url: string): Promise<GitHubFacts | null> {
  const parsed = parseRepoUrl(url);
  if (!parsed) return null; // genuinely not a repo URL
  const { owner, repo } = parsed;

  // repos.get failure is NOT the same as a parse failure — a 403 rate-
  // limit or 5xx here means GitHub is unhappy, and the pipeline should
  // surface that to ops rather than telling the user "not a GitHub URL."
  // README and tree fetches below stay non-fatal; only repos.get is
  // treated as required.
  let repoInfo;
  try {
    repoInfo = await octokit.repos.get({ owner, repo });
  } catch (err) {
    const status = (err as { status?: number } | null)?.status;
    const rateLimitRemaining = (err as { response?: { headers?: Record<string, string> } } | null)
      ?.response?.headers?.["x-ratelimit-remaining"];
    if (status === 404) return null; // repo was deleted / private — treat as not-ingestable
    const reason =
      status === 403 && rateLimitRemaining === "0"
        ? "GitHub rate limit exhausted"
        : status === 403
          ? "GitHub access forbidden"
          : status && status >= 500
            ? `GitHub server error (${status})`
            : `GitHub API error (${status ?? "unknown"})`;
    throw new Error(`${reason} for ${owner}/${repo}`);
  }

  const description = repoInfo.data.description ?? null;
  const language = repoInfo.data.language ?? null;
  const stars = repoInfo.data.stargazers_count ?? 0;
  const license = repoInfo.data.license?.spdx_id ?? null;
  const pushedAt = repoInfo.data.pushed_at ?? null;
  const defaultBranch = repoInfo.data.default_branch ?? "HEAD";
  const topics = Array.isArray(repoInfo.data.topics) ? repoInfo.data.topics : [];

  let readmeExcerpt = "";
  try {
    const readme = await octokit.repos.getReadme({ owner, repo });
    readmeExcerpt = Buffer.from(readme.data.content, "base64")
      .toString("utf-8")
      .slice(0, 8_000); // plenty for descriptor generation
  } catch {
    // many repos have no README — acceptable at skeleton tier
  }

  let fileTree = "";
  let headSha: string | null = null;
  let topLevelFiles: string[] = [];
  let topLevelDirs: string[] = [];
  try {
    const tree = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: "false",
    });
    headSha = tree.data.sha ?? null;
    const items = tree.data.tree.slice(0, 60);
    fileTree = items
      .map((item) => `${item.type === "tree" ? "d" : "f"} ${item.path}`)
      .join("\n");
    topLevelFiles = items
      .filter((item) => item.type === "blob" && typeof item.path === "string")
      .map((item) => item.path as string);
    topLevelDirs = items
      .filter((item) => item.type === "tree" && typeof item.path === "string")
      .map((item) => item.path as string);
  } catch {
    // Non-fatal — descriptor still useful without the tree
  }

  return {
    owner,
    repo,
    description,
    language,
    stars,
    license,
    pushedAt,
    headSha,
    topics,
    readmeExcerpt,
    fileTree,
    topLevelFiles,
    topLevelDirs,
    defaultBranch,
  };
}

function parseRepoUrl(
  url: string
): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("github.com")) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

// ── Tag derivation ───────────────────────────────────────────────────

/**
 * Tags pulled directly from GitHub's structured fields. Always present,
 * always trustworthy — these are the floor.
 */
function deriveGithubMetadataTags(facts: GitHubFacts): SkeletonTag[] {
  const tags: SkeletonTag[] = [];
  if (facts.language) {
    tags.push({ tag_type: "language", tag_value: facts.language.toLowerCase() });
  }
  for (const topic of facts.topics.slice(0, 20)) {
    tags.push({ tag_type: "topic", tag_value: topic.toLowerCase() });
  }
  if (facts.license) {
    tags.push({ tag_type: "license", tag_value: facts.license.toLowerCase() });
  }
  return tags;
}

/**
 * UX-signal tags derived from GitHub metadata + file presence. These
 * help an agent rank results ("active and well-known beats stale and
 * obscure") and help a user filter browse views.
 */
function deriveHeuristicTags(facts: GitHubFacts): SkeletonTag[] {
  const tags: SkeletonTag[] = [];

  // Stars buckets — coarse on purpose. A 10-bucket popularity tag would
  // bloat the tag namespace and the boundaries are arbitrary anyway.
  if (facts.stars >= 1000) {
    tags.push({ tag_type: "popularity", tag_value: "popular" });
  } else if (facts.stars >= 100) {
    tags.push({ tag_type: "popularity", tag_value: "notable" });
  }

  // Activity recency — based on pushed_at, which moves with any commit
  // including merges, so it's a fair "is this maintained" signal.
  if (facts.pushedAt) {
    const pushed = new Date(facts.pushedAt).getTime();
    const ageDays = (Date.now() - pushed) / (1000 * 60 * 60 * 24);
    if (ageDays <= 90) {
      tags.push({ tag_type: "activity", tag_value: "active" });
    } else if (ageDays > 365) {
      tags.push({ tag_type: "activity", tag_value: "stale" });
    }
  }

  // Presence flags from the top-level file/dir listing.
  const fileSet = new Set(facts.topLevelFiles.map((f) => f.toLowerCase()));
  const dirSet = new Set(facts.topLevelDirs.map((d) => d.toLowerCase()));
  if (facts.readmeExcerpt.length > 0) {
    tags.push({ tag_type: "presence", tag_value: "has-readme" });
  }
  if (dirSet.has("examples") || dirSet.has("example")) {
    tags.push({ tag_type: "presence", tag_value: "has-examples" });
  }
  if (dirSet.has("tests") || dirSet.has("test") || dirSet.has("__tests__")) {
    tags.push({ tag_type: "presence", tag_value: "has-tests" });
  }
  if (fileSet.has("dockerfile") || fileSet.has("docker-compose.yml") || fileSet.has("docker-compose.yaml")) {
    tags.push({ tag_type: "pattern", tag_value: "containerized" });
  }

  return tags;
}

/**
 * Concrete framework tags from the repo's dependency manifest. We fetch
 * package.json or pyproject.toml when present and map dep names to
 * canonical framework tag values. This catches frameworks an LLM might
 * miss because they're only mentioned in deps, not the README.
 *
 * One extra Octokit call per ingest (or two if both files exist), which
 * is fine with GITHUB_TOKEN set (5000/hr) and matters less without it
 * since anonymous mass ingest is already gated on rate-limit.
 */
async function detectFrameworkTags(facts: GitHubFacts): Promise<SkeletonTag[]> {
  const tags: SkeletonTag[] = [];
  const fileSet = new Set(facts.topLevelFiles.map((f) => f.toLowerCase()));

  if (fileSet.has("package.json")) {
    const deps = await fetchPackageJsonDeps(facts);
    for (const dep of deps) {
      const tag = mapNpmDepToTag(dep);
      if (tag) tags.push(tag);
    }
  }

  if (fileSet.has("pyproject.toml") || fileSet.has("requirements.txt")) {
    const deps = await fetchPythonDeps(facts);
    for (const dep of deps) {
      const tag = mapPythonDepToTag(dep);
      if (tag) tags.push(tag);
    }
  }

  // Plain-language ecosystem tags from manifest presence — useful even
  // when we couldn't fetch the manifest body (private fork, big file, etc.).
  if (fileSet.has("go.mod")) {
    tags.push({ tag_type: "language", tag_value: "go" });
  }
  if (fileSet.has("cargo.toml")) {
    tags.push({ tag_type: "language", tag_value: "rust" });
  }

  return tags;
}

async function fetchPackageJsonDeps(facts: GitHubFacts): Promise<string[]> {
  try {
    const res = await octokit.repos.getContent({
      owner: facts.owner,
      repo: facts.repo,
      path: "package.json",
      ref: facts.defaultBranch,
    });
    const data = res.data as { content?: string; encoding?: string };
    if (!data.content) return [];
    const text = Buffer.from(data.content, "base64").toString("utf-8");
    const parsed = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return [
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
      ...Object.keys(parsed.peerDependencies ?? {}),
    ];
  } catch {
    return [];
  }
}

async function fetchPythonDeps(facts: GitHubFacts): Promise<string[]> {
  // Prefer pyproject.toml — it's structured. Fall back to requirements.txt
  // which is often a kitchen sink but parseable line-by-line.
  const fileSet = new Set(facts.topLevelFiles.map((f) => f.toLowerCase()));

  if (fileSet.has("pyproject.toml")) {
    try {
      const res = await octokit.repos.getContent({
        owner: facts.owner,
        repo: facts.repo,
        path: "pyproject.toml",
        ref: facts.defaultBranch,
      });
      const data = res.data as { content?: string };
      if (!data.content) return [];
      const text = Buffer.from(data.content, "base64").toString("utf-8");
      // Cheap parse — just pull names from `dependencies = [...]` and
      // `[project] dependencies =`. Full toml parser would be overkill
      // for tag derivation.
      const matches = text.match(/^\s*"?([a-z0-9_\-]+)["~><=\s]/gim) ?? [];
      return matches
        .map((m) => m.replace(/[^a-z0-9_\-]/gi, "").toLowerCase())
        .filter((s) => s.length > 1);
    } catch {
      return [];
    }
  }

  if (fileSet.has("requirements.txt")) {
    try {
      const res = await octokit.repos.getContent({
        owner: facts.owner,
        repo: facts.repo,
        path: "requirements.txt",
        ref: facts.defaultBranch,
      });
      const data = res.data as { content?: string };
      if (!data.content) return [];
      const text = Buffer.from(data.content, "base64").toString("utf-8");
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && !line.startsWith("-"))
        .map((line) => line.split(/[<>=!~;\s]/)[0]?.toLowerCase() ?? "")
        .filter((s) => s.length > 1);
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Map known npm package names to canonical tag values. Only includes
 * packages whose presence is meaningful for search/discovery — generic
 * deps like lodash or zod don't earn a tag.
 */
function mapNpmDepToTag(dep: string): SkeletonTag | null {
  const d = dep.toLowerCase();
  // Frameworks
  if (d === "next") return { tag_type: "framework", tag_value: "nextjs" };
  if (d === "react") return { tag_type: "framework", tag_value: "react" };
  if (d === "vue") return { tag_type: "framework", tag_value: "vue" };
  if (d === "nuxt") return { tag_type: "framework", tag_value: "nuxt" };
  if (d === "svelte" || d === "@sveltejs/kit") return { tag_type: "framework", tag_value: "svelte" };
  if (d === "fastify") return { tag_type: "framework", tag_value: "fastify" };
  if (d === "express") return { tag_type: "framework", tag_value: "express" };
  if (d === "hono") return { tag_type: "framework", tag_value: "hono" };
  if (d === "@nestjs/core") return { tag_type: "framework", tag_value: "nestjs" };
  if (d === "remix" || d === "@remix-run/react") return { tag_type: "framework", tag_value: "remix" };
  if (d === "astro") return { tag_type: "framework", tag_value: "astro" };
  if (d === "electron") return { tag_type: "framework", tag_value: "electron" };
  // AI/agent stack
  if (d === "@anthropic-ai/sdk") return { tag_type: "tool", tag_value: "claude" };
  if (d === "openai") return { tag_type: "tool", tag_value: "openai" };
  if (d === "@modelcontextprotocol/sdk") return { tag_type: "pattern", tag_value: "mcp-server" };
  if (d === "langchain" || d === "@langchain/core") return { tag_type: "framework", tag_value: "langchain" };
  if (d === "ai") return { tag_type: "framework", tag_value: "vercel-ai-sdk" };
  // Browser / scraping
  if (d === "puppeteer" || d === "puppeteer-core") return { tag_type: "tool", tag_value: "puppeteer" };
  if (d === "playwright" || d === "@playwright/test") return { tag_type: "tool", tag_value: "playwright" };
  if (d === "cheerio") return { tag_type: "tool", tag_value: "cheerio" };
  // Data / storage
  if (d === "@supabase/supabase-js") return { tag_type: "platform", tag_value: "supabase" };
  if (d === "@prisma/client" || d === "prisma") return { tag_type: "tool", tag_value: "prisma" };
  if (d === "drizzle-orm") return { tag_type: "tool", tag_value: "drizzle" };
  // Animation / video
  if (d === "gsap") return { tag_type: "tool", tag_value: "gsap" };
  if (d === "fluent-ffmpeg" || d === "ffmpeg-static") return { tag_type: "tool", tag_value: "ffmpeg" };
  return null;
}

function mapPythonDepToTag(dep: string): SkeletonTag | null {
  const d = dep.toLowerCase();
  if (d === "fastapi") return { tag_type: "framework", tag_value: "fastapi" };
  if (d === "flask") return { tag_type: "framework", tag_value: "flask" };
  if (d === "django") return { tag_type: "framework", tag_value: "django" };
  if (d === "starlette") return { tag_type: "framework", tag_value: "starlette" };
  if (d === "anthropic") return { tag_type: "tool", tag_value: "claude" };
  if (d === "openai") return { tag_type: "tool", tag_value: "openai" };
  if (d === "langchain" || d === "langchain-core") return { tag_type: "framework", tag_value: "langchain" };
  if (d === "llama-index" || d === "llama_index") return { tag_type: "framework", tag_value: "llama-index" };
  if (d === "transformers") return { tag_type: "framework", tag_value: "huggingface" };
  if (d === "torch" || d === "pytorch") return { tag_type: "framework", tag_value: "pytorch" };
  if (d === "tensorflow") return { tag_type: "framework", tag_value: "tensorflow" };
  if (d === "playwright") return { tag_type: "tool", tag_value: "playwright" };
  if (d === "selenium") return { tag_type: "tool", tag_value: "selenium" };
  if (d === "beautifulsoup4" || d === "bs4") return { tag_type: "tool", tag_value: "beautifulsoup" };
  if (d === "scrapy") return { tag_type: "framework", tag_value: "scrapy" };
  if (d === "supabase") return { tag_type: "platform", tag_value: "supabase" };
  if (d === "psycopg2" || d === "psycopg") return { tag_type: "tool", tag_value: "postgres" };
  return null;
}

function dedupeTags(tags: SkeletonTag[]): SkeletonTag[] {
  const seen = new Set<string>();
  const out: SkeletonTag[] = [];
  for (const t of tags) {
    const key = `${t.tag_type}::${t.tag_value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ── Side-effect writes ───────────────────────────────────────────────

async function writeSkeletonTags(
  entryId: string,
  tags: SkeletonTag[]
): Promise<void> {
  if (tags.length === 0) return;

  const supabase = supabaseAdmin();
  const rows = tags.map((t) => ({
    entry_id: entryId,
    tag_type: t.tag_type,
    tag_value: t.tag_value,
  }));

  // Non-fatal on error — tags are searchable metadata, not correctness
  // for the entry itself. But log so a broken schema/constraint is
  // visible in the health dashboard rather than silently degrading
  // tag-based search.
  const { error } = await supabase.from("tags").insert(rows);
  if (error) {
    console.warn(`[skeleton] Tag insert failed for entry ${entryId}:`, error.message);
    void logSystemEvent({
      severity: "warn",
      category: "ingestion",
      source: "skeleton.writeSkeletonTags",
      message: `Tag insert failed: ${error.message}`,
      fingerprintKeys: ["skeleton", "tag_insert_failed"],
      metadata: { entry_id: entryId, tag_count: rows.length },
    });
  }
}

async function embedDescriptor(
  entryId: string,
  descriptor: string
): Promise<void> {
  const supabase = supabaseAdmin();

  // Clear any pre-existing chunks for this entry so a re-ingest yields
  // a clean single-chunk row set.
  await supabase.from("chunks").delete().eq("entry_id", entryId);

  const embedding = await generateEmbedding(descriptor);

  const { error } = await supabase.from("chunks").insert({
    entry_id: entryId,
    content: descriptor,
    chunk_type: "descriptor",
    chunk_index: 0,
    embedding: JSON.stringify(embedding),
  });
  if (error) {
    throw new Error(`Failed to insert descriptor chunk: ${error.message}`);
  }
}

async function failEntry(entryId: string, reason: string): Promise<void> {
  const supabase = supabaseAdmin();
  await supabase
    .from("entries")
    .update({
      status: "error",
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);
  console.error(`[skeleton] Entry ${entryId} failed: ${reason}`);
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Produce a unique, URL-safe slug for a skeleton entry.
 *
 * Matches the full pipeline's `generateEntrySlug` pattern — query for
 * collisions first so `slugifyEntryTitle` can disambiguate with a numeric
 * suffix. Scopes the lookup to slugs starting with the computed base
 * (e.g. "anthropic-claude-code") so we don't pull the entire entries
 * table on every ingest.
 */
async function generateSkeletonSlug(
  entryId: string,
  title: string
): Promise<string> {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!base) return fallbackSlugFromId(entryId);

  const supabase = supabaseAdmin();
  const { data: existing } = await supabase
    .from("entries")
    .select("slug")
    .neq("id", entryId)
    .ilike("slug", `${base}%`);

  const existingSlugs = (existing || [])
    .map((r) => (r as { slug: string | null }).slug)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  return slugifyEntryTitle(title, existingSlugs);
}

function extractSummary(
  descriptor: string,
  fallback: string | null
): string {
  // Use the first non-heading line of "## What it is" if we can find it,
  // else fall back to the GitHub description, else empty string.
  const match = descriptor.match(/##\s+What it is\s*\n+([^\n]+)/i);
  if (match && match[1]) {
    return match[1].trim().slice(0, 280);
  }
  if (fallback) return fallback.slice(0, 280);
  return "";
}
