import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { logSystemEvent } from "@/lib/analytics/system-events";
import { normalizeTag } from "../tags";
import { octokit, type GitHubFacts } from "./github";

export interface SkeletonTag {
  tag_type: string;
  tag_value: string;
}

/**
 * Tags pulled directly from GitHub's structured fields. Always present,
 * always trustworthy — these are the floor.
 */
export function deriveGithubMetadataTags(facts: GitHubFacts): SkeletonTag[] {
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
export function deriveHeuristicTags(facts: GitHubFacts): SkeletonTag[] {
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
export async function detectFrameworkTags(facts: GitHubFacts): Promise<SkeletonTag[]> {
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

export function dedupeTags(tags: SkeletonTag[]): SkeletonTag[] {
  // Normalize before dedup so 'Claude' and 'claude' collapse to one row.
  // The per-source tag builders in this file already lowercase inline,
  // but routing through normalizeTag centralizes the contract and
  // guards against a future path that forgets.
  const seen = new Set<string>();
  const out: SkeletonTag[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (!n) continue;
    const key = `${n.tag_type}::${n.tag_value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export async function writeSkeletonTags(
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
