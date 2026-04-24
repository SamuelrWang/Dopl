import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugifyEntryTitle, fallbackSlugFromId } from "@/features/entries/server/slug";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import {
  SKELETON_DESCRIPTOR_PROMPT_VERSION,
  buildSkeletonDescriptorPrompt,
} from "@/shared/prompts/skeleton-descriptor";
import {
  gatherGitHubFacts,
  parseRepoUrl,
} from "./skeleton/github";
import {
  deriveGithubMetadataTags,
  deriveHeuristicTags,
  detectFrameworkTags,
  dedupeTags,
  writeSkeletonTags,
} from "./skeleton/tags";
import {
  generateStructuredDescriptor,
  composeDescriptorMarkdown,
} from "./skeleton/descriptor";
import { embedDescriptor, embedTitleSummary } from "./skeleton/embed";

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


interface SkeletonInput {
  entryId: string;
  url: string;
  userId?: string;
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

    // Short-query retrieval parity with full ingest. Skeletons now carry
    // a dedicated title_summary chunk alongside the descriptor so that
    // title-shaped queries ("clone website", "polymarket bot") rank
    // skeletons competitively. Failure here degrades search quality but
    // doesn't justify failing the whole entry — log and move on.
    await embedTitleSummary(
      entryId,
      title,
      summary,
      allTags.map((t) => t.tag_value)
    );

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
