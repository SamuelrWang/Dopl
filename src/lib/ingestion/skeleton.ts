import { Octokit } from "@octokit/rest";
import { callClaude, generateEmbedding } from "@/lib/ai";
import { supabaseAdmin } from "@/lib/supabase";
import { slugifyEntryTitle, fallbackSlugFromId } from "@/lib/entries/slug";
import { logSystemEvent } from "@/lib/analytics/system-events";
import {
  SKELETON_DESCRIPTOR_PROMPT_VERSION,
  buildSkeletonDescriptorPrompt,
} from "@/lib/prompts/skeleton-descriptor";

/**
 * Skeleton-tier ingestion pipeline.
 *
 * Replaces the full manifest + README + agents.md + multi-chunk-embedding
 * flow with one Sonnet call that produces a task-agnostic descriptor,
 * plus a single embedding for search. Much cheaper than full ingestion
 * (one LLM call instead of three, single chunk instead of dozens).
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

  const { error: createError } = await supabase.from("entries").insert({
    id: entryId,
    source_url: input.url,
    source_platform: "github",
    status: "processing",
    ingestion_tier: "skeleton",
    ingested_by: input.userId ?? null,
    slug: fallbackSlugFromId(entryId),
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

    const descriptor = await callClaude(
      "You produce tight, task-agnostic repo descriptors. Markdown only, no preamble.",
      prompt,
      { model: "sonnet", maxTokens: 1500 }
    );

    const trimmed = descriptor.trim();
    if (trimmed.length < 80) {
      await failEntry(entryId, "Descriptor generation returned empty content");
      return;
    }

    const title = `${facts.owner}/${facts.repo}`;
    const summary = extractSummary(trimmed, facts.description);
    const slug = await generateSkeletonSlug(entryId, title);

    // Embed FIRST so search is functional the moment status flips to
    // "complete". Tags and descriptor update only run after the chunk
    // lands — otherwise a poller seeing "complete" might find an entry
    // that isn't searchable yet, or read a descriptor that a subsequent
    // embedding failure would orphan.
    await embedDescriptor(entryId, trimmed);

    // Tags from GitHub metadata — no LLM pass needed at skeleton tier.
    await writeSkeletonTags(entryId, facts);

    // Final write: content fields + status=complete in one atomic update.
    const { error: updateError } = await supabase
      .from("entries")
      .update({
        status: "complete",
        ingestion_tier: "skeleton",
        title,
        summary,
        slug,
        descriptor: trimmed,
        github_sha: facts.headSha,
        descriptor_prompt_version: SKELETON_DESCRIPTOR_PROMPT_VERSION,
        content_type: "setup",
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
        descriptor_chars: trimmed.length,
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
  try {
    const tree = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: defaultBranch,
      recursive: "false",
    });
    headSha = tree.data.sha ?? null;
    fileTree = tree.data.tree
      .slice(0, 60)
      .map((item) => `${item.type === "tree" ? "d" : "f"} ${item.path}`)
      .join("\n");
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

// ── Side-effect writes ───────────────────────────────────────────────

async function writeSkeletonTags(
  entryId: string,
  facts: GitHubFacts
): Promise<void> {
  const supabase = supabaseAdmin();
  const rows: Array<{ entry_id: string; tag_type: string; tag_value: string }> = [];

  if (facts.language) {
    rows.push({ entry_id: entryId, tag_type: "language", tag_value: facts.language });
  }
  for (const topic of facts.topics.slice(0, 20)) {
    rows.push({ entry_id: entryId, tag_type: "topic", tag_value: topic });
  }
  if (facts.license) {
    rows.push({ entry_id: entryId, tag_type: "license", tag_value: facts.license });
  }

  if (rows.length === 0) return;

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
