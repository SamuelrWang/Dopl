import { NextRequest, NextResponse } from "next/server";
import { IngestSubmitSchema } from "@/types/api";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
// Credits removed — access is gated at prepare; submit does no credit math.
import {
  deleteFailedEntry,
  stepGatherContent,
  storeSources,
  persistAgentArtifacts,
  finalizeAgentEntry,
  logStep,
} from "@/lib/ingestion/pipeline";
import { chunkAndEmbed } from "@/lib/ingestion/embedder";
import { logSystemEvent } from "@/lib/analytics/system-events";
import type { ExtractedSource } from "@/lib/ingestion/types";

/**
 * POST /api/ingest/submit
 *
 * Agent-driven ingestion, step 2/2. The agent posts the artifacts it
 * generated (content_type, manifest, readme, agents.md, tags, optional image
 * analyses, optional content_classification).
 *
 * The server:
 *   1. Verifies the entry belongs to this user and is still processing.
 *   2. Persists any image analyses into the `sources` table.
 *   3. Re-gathers the full raw content from the sources table (written by
 *      /api/ingest/prepare).
 *   4. Writes title/summary/use_case/complexity/content_type/thumbnail_url/
 *      readme/agents_md/manifest/raw_content/slug via persistAgentArtifacts.
 *   5. Inserts tags rows.
 *   6. Chunks + embeds content via chunkAndEmbed (OpenAI).
 *   7. Flips status to "complete".
 *
 * On failure, the entry is deleted and the 1-credit prepare deduction is
 * refunded so the user isn't charged for a busted round trip.
 */
async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  const supabase = supabaseAdmin();

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
  const parsed = IngestSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 }
    );
  }
  const {
    entry_id,
    content_type,
    source_type,
    manifest,
    readme,
    agents_md,
    tags,
    image_analyses,
    content_classification,
  } = parsed.data;

  // ── Atomic claim — combined ownership + state + idempotency check. ──
  // Conditional UPDATE stamps `ingested_at` from NULL → now() only if the
  // entry still belongs to this user, is still "processing", and hasn't
  // already been claimed by a prior submit. A concurrent second submit will
  // match zero rows (ingested_at is no longer null) and get rejected with
  // 409. persistAgentArtifacts later overwrites `ingested_at` with a fresh
  // timestamp — matching legacy semantics — so the lock value is harmless.
  const claimTimestamp = new Date().toISOString();
  const { data: entryRow, error: claimError } = await supabase
    .from("entries")
    .update({ ingested_at: claimTimestamp })
    .eq("id", entry_id)
    .eq("ingested_by", userId)
    .eq("status", "processing")
    .is("ingested_at", null)
    .select("id, source_url, thumbnail_url")
    .maybeSingle();

  if (claimError) {
    return NextResponse.json(
      { error: "Entry lookup failed", message: claimError.message },
      { status: 500 }
    );
  }

  if (!entryRow) {
    // Distinguish the failure modes with a follow-up read so the agent gets a
    // useful error. If the row doesn't exist at all OR belongs to another user,
    // return 404 (non-enumerable). If it's simply already submitted / completed,
    // return 409.
    const { data: diag } = await supabase
      .from("entries")
      .select("ingested_by, status, ingested_at")
      .eq("id", entry_id)
      .maybeSingle();

    if (!diag || diag.ingested_by !== userId) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    if (diag.status !== "processing") {
      return NextResponse.json(
        {
          error: "Entry not in submittable state",
          status: diag.status,
          message:
            "Only entries in 'processing' state can receive a submit. Start a fresh ingest with prepare_ingest.",
        },
        { status: 409 }
      );
    }

    // status=processing but ingested_at already set → a concurrent submit
    // claimed it first. Reject idempotently.
    return NextResponse.json(
      {
        error: "Submit already in progress",
        message:
          "Another submit_ingested_entry call claimed this entry. Wait for it to complete, then poll with get_setup.",
      },
      { status: 409 }
    );
  }

  // From here down we own the entry: any failure deletes it and refunds the
  // 1 credit deducted at prepare time.
  try {
    // ── 1. Persist agent's image analyses into sources table ──
    // Columns mirror the legacy image extractor's ExtractedSource shape.
    // image_id is client-only (tracking between prepare/submit) — not stored.
    if (image_analyses && image_analyses.length > 0) {
      const imageSources: ExtractedSource[] = image_analyses.map((img) => ({
        sourceType: img.source_type,
        rawContent: img.raw_content,
        extractedContent: img.extracted_content,
        contentMetadata: img.metadata ?? {
          mimeType: "image/png",
          imageType: img.source_type,
        },
        depth: 0,
      }));
      await storeSources(entry_id, imageSources);
    }

    // ── 2. Log a content-type-detection step so the ingestion_logs
    //    record matches legacy granularity. ──
    await logStep(entry_id, "content_type_detection", "completed", {
      content_type,
      source_type,
      origin: "agent",
    });

    // If the agent ran the section classifier, log its summary too.
    if (content_classification?.stats) {
      await logStep(entry_id, "content_classification", "completed", {
        stats: content_classification.stats,
        preservation_notes: content_classification.preservation_notes,
        origin: "agent",
      });
    }

    // ── 3. Gather full content from the sources table (written during
    //    prepare). persistAgentArtifacts stores this as entries.raw_content. ──
    const { allContent } = await stepGatherContent(entry_id);

    // ── 4. Resolve a thumbnail from extractor-written source metadata
    //    if one wasn't stamped on the entry row yet. Falls through to
    //    persistAgentArtifacts' GitHub-OG / thum.io ladder if nothing is
    //    found. ──
    let thumbnailUrl: string | null = entryRow.thumbnail_url ?? null;
    if (!thumbnailUrl) {
      const { data: sources } = await supabase
        .from("sources")
        .select("content_metadata")
        .eq("entry_id", entry_id)
        .not("content_metadata", "is", null)
        .limit(20);
      for (const s of sources || []) {
        const meta = (s as { content_metadata: Record<string, unknown> | null })
          .content_metadata;
        if (meta?.thumbnail_url && typeof meta.thumbnail_url === "string") {
          thumbnailUrl = meta.thumbnail_url;
          break;
        }
      }
    }

    // ── 5. Log agent-side artifact-generation steps so the logs table
    //    surfaces what happened. ──
    await logStep(entry_id, "manifest_generation", "completed", {
      origin: "agent",
    });
    await logStep(entry_id, "readme_generation", "completed", {
      origin: "agent",
      chars: readme.length,
    });
    if (agents_md) {
      await logStep(entry_id, "agents_md_generation", "completed", {
        origin: "agent",
        chars: agents_md.length,
      });
    }
    await logStep(entry_id, "tag_generation", "completed", {
      origin: "agent",
      count: tags.length,
    });

    // ── 6. Persist title / summary / use_case / complexity / content_type /
    //    thumbnail_url / readme / agents_md / manifest / raw_content / slug
    //    to the entries row + insert tag rows. ──
    const { slug } = await persistAgentArtifacts({
      entryId: entry_id,
      sourceUrl: entryRow.source_url,
      manifest,
      readme,
      agentsMd: agents_md,
      tags,
      gatheredContent: allContent,
      thumbnailUrl,
      contentType: content_type,
    });

    // ── 7. Embeddings (the only AI call we still run server-side). ──
    await logStep(entry_id, "embedding", "started");
    const embedStart = Date.now();
    await chunkAndEmbed(entry_id, {
      readme,
      agentsMd: agents_md,
      rawContent: allContent,
    });
    await logStep(
      entry_id,
      "embedding",
      "completed",
      undefined,
      Date.now() - embedStart
    );

    // ── 8. Mark complete ──
    await finalizeAgentEntry(entry_id);

    const title = (manifest as Record<string, string>).title || "Untitled";
    const useCase =
      ((manifest as Record<string, Record<string, string>>).use_case
        ?.primary as string) || "other";
    const complexity =
      (manifest as Record<string, string>).complexity || "moderate";

    return NextResponse.json({
      status: "complete",
      entry_id,
      slug,
      title,
      use_case: useCase,
      complexity,
      content_type,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const name = error instanceof Error ? error.name : "UnknownError";
    console.error(`[submit] Entry ${entry_id} failed:`, message);
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "POST /api/ingest/submit",
      message: `Submit failed: ${message}`,
      fingerprintKeys: ["ingestion", "submit_throw", name],
      metadata: { entry_id, error_name: name },
      userId,
    });

    // Clean up partial data. No credit refund needed — access is the
    // only gate, and a failed submit doesn't charge anything.
    await deleteFailedEntry(entry_id).catch((cleanupErr) => {
      console.error("[submit] cleanup failed:", cleanupErr);
    });

    return NextResponse.json(
      { error: "Submit failed", message },
      { status: 500 }
    );
  }
}

export const POST = withUserAuth(handlePost);
