import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { extractTweetContent, isTweetUrl } from "@/lib/ingestion/extractors/twitter";
import {
  extractInstagramContent,
  isInstagramPostUrl,
} from "@/lib/ingestion/extractors/instagram";
import {
  extractRedditContent,
  isRedditPostUrl,
} from "@/lib/ingestion/extractors/reddit";
import { extractGitHubContent } from "@/lib/ingestion/extractors/github";
import {
  ExtractorError,
  extractWebContent,
  linkResultToSource,
  shouldSkipLink,
} from "@/lib/ingestion/extractors/web";
import { storeSources } from "@/lib/ingestion/pipeline";
import { normalizeUrl } from "@/lib/ingestion/url";
import { logSystemEvent } from "@/lib/analytics/system-events";
import { assertPublicHttpUrl, UnsafeUrlError } from "@/lib/ingestion/url-safety";
import type { SourceStatusReason } from "@/lib/ingestion/types";

export const dynamic = "force-dynamic";

const supabase = supabaseAdmin();

/**
 * POST /api/ingest/follow-links
 *
 * Companion to `prepare_ingest`'s split-flow model. The agent inspects
 * `detected_links[]` in the prepare response, decides which links add
 * signal, then calls this endpoint with the chosen URLs. The server
 * extracts each URL's content (platform-specific extractor per URL)
 * and appends the results to the entry's `sources` table as `depth=1`
 * rows. Subsequent `get_ingest_content` calls will include them.
 *
 * Why this exists rather than running links inside prepare:
 * - Link-following the old way (up to 30 links × 5-15s each) routinely
 *   blew Vercel's 60s function timeout.
 * - Most ingests don't need follow-up links — the primary URL content
 *   is sufficient. Defaulting OFF saves ~50% of extraction time on the
 *   common case.
 * - When follow-up is worthwhile, the agent has better taste than a
 *   default BFS: it can pick the 2-3 actually-useful linked docs
 *   instead of following all 30 README links.
 *
 * Bounded cost: each URL gets one extractor pass at depth=1 (no
 * recursive child-link following). At most `MAX_URLS_PER_CALL` per
 * call. The endpoint is safe to call multiple times as the agent
 * iterates — each call is idempotent via the sources-table dedup on
 * (entry_id, normalized_url).
 */

const MAX_URLS_PER_CALL = 8;

const RequestSchema = z.object({
  entry_id: z.string().uuid(),
  urls: z.array(z.string().url()).min(1).max(MAX_URLS_PER_CALL),
});

interface LinkResult {
  url: string;
  status: "ok" | "failed" | "skipped";
  status_reason?: SourceStatusReason;
  chars?: number;
  source_type?: string;
}

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { entry_id, urls } = parsed.data;

    // Access gate: only the original ingester can follow more links.
    // (Unlike get_ingest_content, this WRITES to the entry — public
    // read access doesn't extend to write access.)
    const { data: entry } = await supabase
      .from("entries")
      .select("id, ingested_by, status")
      .eq("id", entry_id)
      .maybeSingle();
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }
    const entryRow = entry as {
      id: string;
      ingested_by: string | null;
      status: string | null;
    };
    if (entryRow.ingested_by !== userId) {
      return NextResponse.json(
        { error: "Only the entry's owner may follow additional links" },
        { status: 403 }
      );
    }

    const results: LinkResult[] = [];

    for (const rawUrl of urls) {
      const url = normalizeUrl(rawUrl);

      // Pre-filter: skip low-value paths without burning an extractor
      // slot. Covers CI workflows, tests, lockfiles — the same set the
      // default link-follower skips.
      if (shouldSkipLink(url)) {
        results.push({
          url,
          status: "skipped",
          status_reason: "unsupported_content_type",
        });
        continue;
      }

      // SSRF guard — same check the link-follower does before hitting
      // the wire. Refuse private/loopback/metadata URLs even if the
      // caller tries to slip them through via the agent-exposed list.
      try {
        await assertPublicHttpUrl(url);
      } catch (err) {
        if (err instanceof UnsafeUrlError) {
          results.push({
            url,
            status: "failed",
            status_reason: "unsupported_content_type",
          });
          continue;
        }
        throw err;
      }

      // Dispatch to the platform-appropriate extractor. Same selection
      // logic as `followAndStore` in pipeline.ts — keeping one source
      // of truth here would be ideal, but the pipeline's version runs
      // inside a recursive follower we deliberately don't invoke.
      try {
        let result;
        if (isTweetUrl(url)) result = await extractTweetContent(url, 1);
        else if (isInstagramPostUrl(url)) result = await extractInstagramContent(url, 1);
        else if (isRedditPostUrl(url)) result = await extractRedditContent(url, 1);
        else if (url.includes("github.com")) result = await extractGitHubContent(url, 1);
        else result = await extractWebContent(url, 1);

        if (!result) {
          await storeSources(entry_id, [
            {
              url,
              sourceType: "other",
              rawContent: "",
              depth: 1,
              status: "failed",
              statusReason: "empty_content",
            },
          ]);
          results.push({
            url,
            status: "failed",
            status_reason: "empty_content",
          });
          continue;
        }

        const source = linkResultToSource(result, 1);
        await storeSources(entry_id, [source]);
        results.push({
          url,
          status: "ok",
          chars: (source.extractedContent ?? source.rawContent ?? "").length,
          source_type: source.sourceType,
        });
      } catch (error) {
        const isTyped = error instanceof ExtractorError;
        const statusReason: SourceStatusReason = isTyped
          ? error.statusReason
          : "extractor_error";
        const fetchStatusCode = isTyped ? error.fetchStatusCode : null;
        console.error(`[follow-links] extractor failed for ${url}:`, error);
        try {
          await storeSources(entry_id, [
            {
              url,
              sourceType: "other",
              rawContent: "",
              depth: 1,
              status: "failed",
              statusReason,
              fetchStatusCode: fetchStatusCode ?? undefined,
            },
          ]);
        } catch (persistErr) {
          console.error(
            `[follow-links] failed to persist audit row for ${url}:`,
            persistErr
          );
        }
        results.push({
          url,
          status: "failed",
          status_reason: statusReason,
        });
      }
    }

    void logSystemEvent({
      severity: "info",
      category: "ingestion",
      source: "POST /api/ingest/follow-links",
      message: `Followed ${results.length} link(s) for entry ${entry_id}`,
      fingerprintKeys: ["ingestion", "follow_links"],
      metadata: {
        entry_id,
        ok: results.filter((r) => r.status === "ok").length,
        failed: results.filter((r) => r.status === "failed").length,
        skipped: results.filter((r) => r.status === "skipped").length,
      },
      userId,
    });

    return NextResponse.json({
      entry_id,
      results,
      summary: {
        total: results.length,
        ok: results.filter((r) => r.status === "ok").length,
        failed: results.filter((r) => r.status === "failed").length,
        skipped: results.filter((r) => r.status === "skipped").length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const name = error instanceof Error ? error.name : "UnknownError";
    console.error("[follow-links] endpoint threw:", message);
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "POST /api/ingest/follow-links",
      message: `Follow-links endpoint threw: ${message}`,
      fingerprintKeys: ["ingestion", "follow_links_throw", name],
      metadata: { error_name: name },
    });
    return NextResponse.json(
      { error: "Follow-links failed", message },
      { status: 500 }
    );
  }
}

export const POST = withUserAuth(handlePost);
