import { supabaseAdmin } from "@/lib/supabase";
import { IngestInput, ContentType } from "../types";
import { shouldSkipLink } from "../extractors/web";
import { normalizeUrl } from "../url";
import { normalizeTag } from "../tags";
import { detectPlatform, logStep } from "./util";
import { stepPlatformFetch } from "./platform-fetch";
import {
  stepTextExtraction,
  stepLinkFollowing,
  stepGatherContent,
} from "./links";
import { generateEntrySlug } from "./storage";
import { PIPELINE_STRATEGIES } from "./strategy";

const supabase = supabaseAdmin();

/**
 * Run the fetch + link-follow + gather phases of the pipeline without
 * touching Claude/OpenAI. Called by /api/ingest/prepare.
 *
 * Preserves every source-table write the legacy pipeline performs, so a
 * later submit_ingested_entry call lands in an entry row that is
 * indistinguishable from one produced by `ingestEntry` except that the
 * AI-generated columns come from the agent's output instead of ours.
 *
 * Uses the "setup" pipeline strategy for link-following (max 30 links,
 * max depth = MAX_LINK_DEPTH) because content type isn't classified until
 * the agent runs its own prompt — using the most generous strategy means
 * we don't under-fetch content the agent might later want.
 */
export async function extractForAgent(
  entryId: string,
  input: IngestInput,
  options: { followLinks?: boolean } = {}
): Promise<{
  gatheredContent: string;
  thumbnailUrl: string | null;
  sourcePlatform: string;
  detectedLinks: string[];
}> {
  const sourcePlatform = detectPlatform(input.url);

  const fetchResult = await stepPlatformFetch(entryId, input);
  let thumbnailUrl = fetchResult.thumbnailUrl;
  if (fetchResult.updatedText !== undefined) {
    input.content.text = fetchResult.updatedText;
  }
  if (fetchResult.updatedLinks !== undefined) {
    input.content.links = fetchResult.updatedLinks;
  }

  const { textSources } = await stepTextExtraction(
    entryId,
    input.content.text || ""
  );

  // Collect all child links the primary extractors discovered.
  // When link-following is disabled (the default for prepare_ingest),
  // these come back to the caller as `detectedLinks` so the agent can
  // review them AFTER the primary entry is submitted, filter out
  // noise, and offer any distinct external sources to the user as
  // candidates for separate KB entries (two-entry model — the primary
  // entry stays focused, any referenced distinct source gets its own
  // entry on user approval). Skip-list filtering is applied up front
  // so low-value paths (CI files, lockfiles, tests) never reach the
  // agent's visibility surface.
  const allLinks = [
    ...(input.content.links || []),
    ...textSources.flatMap((s) => s.childLinks || []),
  ];
  const detectedLinks = [
    ...new Set(allLinks.map((l) => normalizeUrl(l))),
  ].filter((url) => !shouldSkipLink(url));

  // Opt-in link-following. Default is OFF because the old synchronous
  // link-follow step routinely blew Vercel's 60s function timeout on
  // link-heavy READMEs (the voicebox monorepo hit 120s). The prepare
  // flow now returns `detectedLinks` for the agent to offer as
  // candidate separate entries to the user; there's no
  // into-the-same-entry follow path exposed to clients. The
  // `options.followLinks` flag remains for internal callers (e.g.
  // batch ingestion scripts) that need the old recursive behavior;
  // `prepare_ingest` never sets it.
  if (options.followLinks) {
    const strategy = PIPELINE_STRATEGIES.setup;
    const linkResult = await stepLinkFollowing(
      entryId,
      input,
      textSources,
      thumbnailUrl,
      strategy
    );
    thumbnailUrl = linkResult.thumbnailUrl;
  }

  const { allContent } = await stepGatherContent(entryId);

  return {
    gatheredContent: allContent,
    thumbnailUrl,
    sourcePlatform,
    detectedLinks,
  };
}

/**
 * Persist an entry's agent-generated artifacts. Called by /api/ingest/submit.
 *
 * Mirrors the column set written by `stepPersistEntry` exactly:
 *   - UPDATE entries with title, summary, use_case, complexity, content_type,
 *     thumbnail_url, readme, agents_md, manifest, raw_content, slug,
 *     ingested_at, updated_at.
 *   - INSERT tags rows ({entry_id, tag_type, tag_value}) for every tag.
 *   - Slug collision retry loop, same 5-attempt strategy + random suffix.
 *
 * Leaves `status` as "processing" — caller flips it to "complete" after
 * embeddings finish (same split the legacy pipeline uses).
 *
 * Throws on DB failure so the caller can refund credits + delete the entry.
 */
export async function persistAgentArtifacts(args: {
  entryId: string;
  sourceUrl: string;
  manifest: Record<string, unknown>;
  readme: string;
  agentsMd: string;
  tags: Array<{ tag_type: string; tag_value: string }>;
  gatheredContent: string;
  thumbnailUrl: string | null;
  contentType: ContentType;
}): Promise<{ slug: string }> {
  const {
    entryId,
    sourceUrl,
    manifest,
    readme,
    agentsMd,
    tags,
    gatheredContent,
    thumbnailUrl: initialThumbnail,
    contentType,
  } = args;

  const title = (manifest as Record<string, string>).title || "Untitled";
  const summary = (manifest as Record<string, string>).description || "";
  const useCase =
    ((manifest as Record<string, Record<string, string>>).use_case
      ?.primary as string) || "other";
  const complexity =
    (manifest as Record<string, string>).complexity || "moderate";

  // Same thumbnail-fallback ladder as the legacy path.
  let thumbnailUrl = initialThumbnail;
  if (!thumbnailUrl && sourceUrl.includes("github.com")) {
    const ghMatch = sourceUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (ghMatch) {
      const params = new URLSearchParams({
        owner: ghMatch[1],
        repo: ghMatch[2],
      });
      thumbnailUrl = `/api/og/github?${params.toString()}`;
    }
  }
  if (!thumbnailUrl && sourceUrl) {
    thumbnailUrl = `https://image.thum.io/get/${encodeURI(sourceUrl)}`;
  }

  // Same slug retry loop as legacy stepPersistEntry.
  const initialSlug = await generateEntrySlug(entryId, title);
  const maxAttempts = 5;
  let candidate = initialSlug;
  let finalSlug: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { error } = await supabase
      .from("entries")
      .update({
        title,
        summary,
        use_case: useCase,
        complexity,
        content_type: contentType,
        thumbnail_url: thumbnailUrl,
        readme,
        agents_md: agentsMd || null,
        manifest,
        raw_content: { gathered: gatheredContent },
        slug: candidate,
        status: "processing",
        // Always full tier here. When this is an upgrade from skeleton,
        // flipping the tier and clearing the skeleton-only descriptor
        // fields keeps the row schema-consistent — search and detail
        // pages key behavior off ingestion_tier.
        ingestion_tier: "full",
        descriptor: null,
        descriptor_prompt_version: null,
        ingested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", entryId);

    if (!error) {
      finalSlug = candidate;
      break;
    }

    // 23505 = unique_violation on slug. Retry with a random suffix.
    if ((error as { code?: string }).code === "23505") {
      const suffix = Math.random().toString(36).slice(2, 6);
      candidate = `${initialSlug}-${suffix}`;
      continue;
    }

    throw new Error(`Failed to update entry: ${error.message}`);
  }

  if (!finalSlug) {
    throw new Error(
      `Failed to assign a unique slug for entry ${entryId} after ${maxAttempts} attempts`
    );
  }

  // Replace tags rather than append. On a skeleton→full upgrade the row
  // already has skeleton-derived tags (popularity, activity, framework
  // detection from package.json, etc.); the full pipeline produces its
  // own canonical tag set and we want that set as the source of truth.
  // Delete-then-insert is safe even on first ingestion (delete is a
  // no-op against an empty tag set).
  const { error: tagDeleteError } = await supabase
    .from("tags")
    .delete()
    .eq("entry_id", entryId);
  if (tagDeleteError) {
    console.error(
      "[pipeline] Failed to clear existing tags before upgrade:",
      tagDeleteError
    );
  }

  if (tags.length > 0) {
    // Normalize agent-supplied tags so case/whitespace differences don't
    // fragment the tag namespace (see ../tags.ts).
    const normalized = tags
      .map((t) => normalizeTag({ tag_type: t.tag_type, tag_value: t.tag_value }))
      .filter((t): t is { tag_type: string; tag_value: string } => t !== null);
    if (normalized.length > 0) {
      const tagRows = normalized.map((t) => ({
        entry_id: entryId,
        tag_type: t.tag_type,
        tag_value: t.tag_value,
      }));
      const { error: tagError } = await supabase.from("tags").insert(tagRows);
      if (tagError) {
        // Legacy pipeline treats tag insert failure as non-fatal; match that so
        // a bad tag row doesn't poison an otherwise-good ingest.
        console.error("[pipeline] Failed to store tags:", tagError);
      }
    }
  }

  return { slug: finalSlug };
}

/**
 * Flip an entry's status to "complete" and write the final pipeline_complete
 * log. Called by /api/ingest/submit after embeddings land.
 *
 * Also fires the first_ingest_completed conversion event the first time
 * a given user reaches completion (for the launch-metrics funnel).
 */
export async function finalizeAgentEntry(entryId: string): Promise<void> {
  await supabase
    .from("entries")
    .update({
      status: "complete",
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  await logStep(entryId, "pipeline_complete", "completed");

  // Fire first_ingest_completed event. Best-effort — lookup the owner
  // and skip silently if we can't resolve it.
  try {
    const { data: entry } = await supabase
      .from("entries")
      .select("ingested_by")
      .eq("id", entryId)
      .single();
    const userId = entry?.ingested_by as string | null;
    if (userId) {
      const { logConversionEvent, hasFiredEvent } = await import(
        "@/lib/analytics/conversion-events"
      );
      const already = await hasFiredEvent(userId, "first_ingest_completed");
      if (!already) {
        await logConversionEvent({
          userId,
          eventType: "first_ingest_completed",
          metadata: { entry_id: entryId },
        });
      }
    }
  } catch {
    // Never block pipeline completion on event logging.
  }
}
