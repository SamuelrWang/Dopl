import { supabaseAdmin } from "@/shared/supabase/admin";
import { IngestInput, ExtractedSource } from "../types";
import { extractText } from "../extractors/text";
import {
  extractWebContent,
  linkResultToSource,
  shouldSkipLink,
  ExtractorError,
} from "../extractors/web";
import { extractGitHubContent } from "../extractors/github";
import { extractTweetContent, isTweetUrl } from "../extractors/twitter";
import {
  extractInstagramContent,
  isInstagramPostUrl,
} from "../extractors/instagram";
import {
  extractRedditContent,
  isRedditPostUrl,
} from "../extractors/reddit";
import { normalizeUrl } from "../url";
import { truncateContent } from "../utils";
import { ingestionProgress } from "../progress";
import {
  MAX_LINK_DEPTH,
  MAX_CONTENT_FOR_CLAUDE,
  GATHERED_CONTENT_MAX,
} from "@/config";
import { logStep } from "./util";
import { storeSources } from "./storage";
import type { PipelineStrategy } from "./strategy";

const supabase = supabaseAdmin();

/** Step 2: Extract text content and store sources. */
export async function stepTextExtraction(
  entryId: string,
  text: string
): Promise<{ textSources: ExtractedSource[] }> {
  const stepStart = Date.now();
  await logStep(entryId, "text_extraction", "started");
  ingestionProgress.emit(entryId, "step_start", "Analyzing text with Claude...", { step: "text_extraction" });

  const textSources = await extractText(text);
  await storeSources(entryId, textSources);

  const linksFound = textSources.flatMap((s) => s.childLinks || []);
  if (linksFound.length > 0) {
    ingestionProgress.emit(entryId, "detail", `Extracted ${linksFound.length} URL(s) from text`);
  }

  await logStep(entryId, "text_extraction", "completed", undefined, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", "Text analysis complete", { step: "text_extraction" });

  return { textSources };
}

/** Step 4: Follow links recursively and extract content. */
export async function stepLinkFollowing(
  entryId: string,
  input: IngestInput,
  textSources: ExtractedSource[],
  thumbnailUrl: string | null,
  strategy: PipelineStrategy
): Promise<{ thumbnailUrl: string | null }> {
  const allLinks = [
    ...(input.content.links || []),
    ...textSources.flatMap((s) => s.childLinks || []),
  ];
  // Dedup by normalized form. Without this, the same URL with different
  // tracking params or case-variants would consume multiple slots of
  // the maxLinks budget. `followAndStore` re-normalizes on arrival so
  // the invariant holds end-to-end.
  const uniqueLinks = [...new Set(allLinks.map((l) => normalizeUrl(l)))];

  if (uniqueLinks.length === 0) return { thumbnailUrl };

  const { maxLinks, linkDepth } = strategy;

  const stepStart = Date.now();
  await logStep(entryId, "link_following", "started");
  ingestionProgress.emit(
    entryId,
    "step_start",
    `Following ${Math.min(uniqueLinks.length, maxLinks)} link(s) (depth: ${linkDepth})...`,
    { step: "link_following" }
  );

  const visitedUrls = new Set<string>();
  const linksFollowed = { count: 0 };
  const LINK_CONCURRENCY = 5;

  for (let i = 0; i < uniqueLinks.length; i += LINK_CONCURRENCY) {
    if (linksFollowed.count >= maxLinks) {
      ingestionProgress.emit(
        entryId,
        "detail",
        `Link budget reached (${maxLinks} max) — stopping`
      );
      break;
    }
    const batch = uniqueLinks.slice(i, i + LINK_CONCURRENCY);
    await Promise.allSettled(
      batch.map((link) =>
        followAndStore(entryId, link, 1, visitedUrls, linksFollowed, linkDepth, maxLinks)
      )
    );
  }

  // Try to grab a thumbnail from extracted sources if we don't have one yet
  if (!thumbnailUrl) {
    const { data: sources } = await supabase
      .from("sources")
      .select("content_metadata")
      .eq("entry_id", entryId)
      .not("content_metadata", "is", null)
      .limit(20);
    for (const s of sources || []) {
      const meta = s.content_metadata as Record<string, unknown> | null;
      if (meta?.thumbnail_url && typeof meta.thumbnail_url === "string") {
        thumbnailUrl = meta.thumbnail_url;
        break;
      }
    }
  }

  await logStep(entryId, "link_following", "completed", {
    links_followed: linksFollowed.count,
    links_found: uniqueLinks.length,
  }, Date.now() - stepStart);
  ingestionProgress.emit(entryId, "step_complete", `Followed ${linksFollowed.count} link(s)`, { step: "link_following" });

  return { thumbnailUrl };
}

/** Step 5: Gather all content from DB (no Claude call). */
export async function stepGatherContent(
  entryId: string
): Promise<{ allContent: string; contentForClaude: string }> {
  const allContent = await gatherAllContent(entryId);
  const contentForClaude = truncateContent(allContent, MAX_CONTENT_FOR_CLAUDE);

  ingestionProgress.emit(
    entryId,
    "detail",
    `Gathered ${Math.round(allContent.length / 1000)}K characters of content`
  );

  return { allContent, contentForClaude };
}

async function followAndStore(
  entryId: string,
  url: string,
  depth: number,
  visitedUrls: Set<string>,
  linksFollowed: { count: number },
  maxDepth: number = MAX_LINK_DEPTH,
  maxLinks: number = 30
): Promise<void> {
  // Normalize on the way in so `visitedUrls` keys on canonical form.
  // Without this, `https://foo.com/x` and `https://foo.com/x?utm=...`
  // are different to the Set — exactly the bug that let the same repo
  // get stored at both depth 0 and depth 1 during the heygen walkthrough.
  const normalized = normalizeUrl(url);

  if (
    depth > maxDepth ||
    visitedUrls.has(normalized) ||
    linksFollowed.count >= maxLinks
  ) {
    return;
  }

  // Skip known-low-value paths (CI workflows, tests, build artifacts,
  // lockfiles) without consuming a maxLinks slot — these are noise that
  // blow the gathered_content budget without improving synthesis.
  if (shouldSkipLink(normalized)) {
    visitedUrls.add(normalized);
    ingestionProgress.emit(entryId, "detail", `Skipped low-value path: ${normalized.length > 80 ? normalized.slice(0, 77) + "..." : normalized}`);
    return;
  }

  visitedUrls.add(normalized);
  linksFollowed.count++;

  // Describe what we're doing
  const shortUrl = normalized.length > 80 ? normalized.slice(0, 77) + "..." : normalized;
  let description = `Following: ${shortUrl}`;
  if (isTweetUrl(normalized)) description = `Following tweet: ${shortUrl}`;
  else if (isInstagramPostUrl(normalized)) description = `Following Instagram post: ${shortUrl}`;
  else if (isRedditPostUrl(normalized)) description = `Following Reddit post: ${shortUrl}`;
  else if (normalized.includes("github.com")) description = `Following GitHub: ${shortUrl}`;

  ingestionProgress.emit(entryId, "detail", description);

  let result;
  try {
    if (isTweetUrl(normalized)) {
      result = await extractTweetContent(normalized, depth);
    } else if (isInstagramPostUrl(normalized)) {
      result = await extractInstagramContent(normalized, depth);
    } else if (isRedditPostUrl(normalized)) {
      result = await extractRedditContent(normalized, depth);
    } else if (normalized.includes("github.com")) {
      result = await extractGitHubContent(normalized, depth);
    } else {
      result = await extractWebContent(normalized, depth);
    }
  } catch (error) {
    // Record the failure as an audit breadcrumb so it appears in
    // fetch_warnings on the prepare response. The agent then knows the
    // URL was attempted but content wasn't retrieved, rather than
    // silently missing from the corpus. Typed ExtractorError carries a
    // precise reason (access_denied_body, http_4xx, empty_content) that
    // we persist verbatim; anything else falls back to extractor_error.
    const isTyped = error instanceof ExtractorError;
    const statusReason = isTyped ? error.statusReason : "extractor_error";
    const fetchStatusCode = isTyped ? error.fetchStatusCode : null;
    console.error(`[pipeline] Extractor failed for ${normalized}:`, error);
    ingestionProgress.emit(entryId, "detail", `Failed to extract: ${shortUrl}`);
    // Audit-write failure should never crash the link-follow. If the DB
    // is unreachable we've already lost the extraction attempt; we
    // shouldn't compound it by breaking the batch for sibling links.
    try {
      await storeSources(entryId, [
        {
          url: normalized,
          sourceType: "other",
          rawContent: "",
          depth,
          status: "failed",
          statusReason,
          fetchStatusCode: fetchStatusCode ?? undefined,
        },
      ]);
    } catch (persistErr) {
      console.error(`[pipeline] Failed to persist failed-source audit row for ${normalized}:`, persistErr);
    }
    return;
  }

  if (!result) {
    ingestionProgress.emit(entryId, "detail", `No content extracted from: ${shortUrl}`);
    try {
      await storeSources(entryId, [
        {
          url: normalized,
          sourceType: "other",
          rawContent: "",
          depth,
          status: "failed",
          statusReason: "empty_content",
        },
      ]);
    } catch (persistErr) {
      console.error(`[pipeline] Failed to persist empty-content audit row for ${normalized}:`, persistErr);
    }
    return;
  }

  const source = linkResultToSource(result, depth);
  await storeSources(entryId, [source]);

  // Describe what we found
  const contentLen = result.content.length;
  const childCount = result.childLinks.length;
  const parts = [`${Math.round(contentLen / 1000)}K chars`];
  if (childCount > 0) parts.push(`${childCount} child link(s)`);
  ingestionProgress.emit(entryId, "detail", `Extracted from ${shortUrl}: ${parts.join(", ")}`);

  // Recursively follow child links
  for (const childLink of result.childLinks.slice(0, 5)) {
    if (linksFollowed.count >= maxLinks) break;
    await followAndStore(
      entryId,
      childLink,
      depth + 1,
      visitedUrls,
      linksFollowed,
      maxDepth,
      maxLinks
    );
  }
}

/**
 * Assemble all `status='ok'` source rows for an entry into a single
 * markdown-style blob for downstream synthesis. Higher-depth rows drop
 * from the tail when the total exceeds `GATHERED_CONTENT_MAX`; depth-0
 * (primary content) is always kept.
 */
async function gatherAllContent(entryId: string): Promise<string> {
  // Filter on status='ok' — failed/skipped rows are audit breadcrumbs
  // from the hardened extractor, not real content. Including them
  // would inject empty headers into the downstream embedding corpus.
  const { data: sources } = await supabase
    .from("sources")
    .select("*")
    .eq("entry_id", entryId)
    .eq("status", "ok")
    .order("depth", { ascending: true })
    .limit(200);

  if (!sources || sources.length === 0) return "";

  const kept: string[] = [];
  let totalChars = 0;
  let droppedCount = 0;
  let droppedChars = 0;
  const droppedByType: Record<string, number> = {};

  for (const s of sources) {
    const header = `--- [${s.source_type}] ${s.url || "inline"} (depth: ${s.depth}) ---`;
    const content = s.extracted_content || s.raw_content || "";
    const sourceText = `${header}\n${content}`;

    // Depth-0 sources are the primary content (README / tweet text / main
    // article) — always kept. Higher-depth followed links drop from the tail
    // once the budget is exhausted.
    if (s.depth === 0 || totalChars + sourceText.length <= GATHERED_CONTENT_MAX) {
      kept.push(sourceText);
      totalChars += sourceText.length + 2; // +2 for the "\n\n" join
    } else {
      droppedCount++;
      droppedChars += sourceText.length;
      droppedByType[s.source_type] = (droppedByType[s.source_type] || 0) + 1;
    }
  }

  let result = kept.join("\n\n");
  if (droppedCount > 0) {
    const typesSummary = Object.entries(droppedByType)
      .map(([type, count]) => `${count}× ${type}`)
      .join(", ");
    result += `\n\n[TRUNCATED: ${droppedCount} source(s) omitted (~${Math.round(droppedChars / 1000)}K chars): ${typesSummary}. Budget was ${Math.round(GATHERED_CONTENT_MAX / 1000)}K chars. Use \`get_setup\` after submit or re-run prepare with a narrower URL if specific sections are needed.]`;
  }
  return result;
}
