import { NextRequest, NextResponse } from "next/server";
import { IngestRequestSchema } from "@/types/api";
import { withUserAuth, isAdmin } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
import {
  MAX_CONTENT_FOR_CLAUDE,
  MAX_IMAGES_PER_ENTRY,
  MAX_IMAGE_SIZE_BYTES,
} from "@/lib/config";
import { hasActiveAccess, accessDeniedBody } from "@/lib/billing/access";
import { assertPublicHttpUrl, UnsafeUrlError } from "@/lib/ingestion/url-safety";
import { logSystemEvent } from "@/lib/analytics/system-events";
import { detectPlatform, extractForAgent, deleteFailedEntry, logStep } from "@/lib/ingestion/pipeline";
import { fallbackSlugFromId } from "@/lib/entries/slug";
import {
  buildAgentIngestBundle,
  AGENT_INGEST_INSTRUCTIONS,
} from "@/lib/ingestion/agent-bundle";

const MAX_LINKS = 50;
const MAX_URL_LENGTH = 2_048;

/**
 * POST /api/ingest/prepare
 *
 * Agent-driven ingestion, step 1/2. The server:
 *   - Dedup-checks the URL.
 *   - Creates the entry row (status="processing").
 *   - Fetches content via the existing extractors (no AI).
 *   - Returns the gathered content + every prompt the agent needs.
 *
 * The agent then runs the prompts in its own Claude context and POSTs the
 * finished artifacts to /api/ingest/submit.
 *
 * Gated by hasActiveAccess() — trialing or paid users allowed; expired
 * trials hit 402 with a clean trial_expired body.
 */
async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  const supabase = supabaseAdmin();
  let createdEntryId: string | null = null;
  // Hoisted above the try so the catch block can revert a claimed
  // pending_ingestion row back to its queued state on failure.
  let claimedFromPending = false;
  let claimedEntryId: string | null = null;
  let claimedSlug: string | null = null;

  try {
    const body = await request.json();
    const parsed = IngestRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    // ── Input size validation (matches /api/ingest) ──
    if (parsed.data.url.length > MAX_URL_LENGTH) {
      return NextResponse.json(
        { error: "URL too long", max: MAX_URL_LENGTH },
        { status: 400 }
      );
    }

    try {
      await assertPublicHttpUrl(parsed.data.url);
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return NextResponse.json(
          { error: "URL rejected", message: err.message },
          { status: 400 }
        );
      }
      throw err;
    }

    if (
      parsed.data.content.text &&
      parsed.data.content.text.length > MAX_CONTENT_FOR_CLAUDE
    ) {
      return NextResponse.json(
        { error: "Text content too long", max: MAX_CONTENT_FOR_CLAUDE },
        { status: 400 }
      );
    }

    if (
      parsed.data.content.images &&
      parsed.data.content.images.length > MAX_IMAGES_PER_ENTRY
    ) {
      return NextResponse.json(
        { error: `Too many images (max ${MAX_IMAGES_PER_ENTRY})` },
        { status: 400 }
      );
    }

    if (parsed.data.content.images) {
      for (const img of parsed.data.content.images) {
        if (img.length > MAX_IMAGE_SIZE_BYTES) {
          return NextResponse.json(
            { error: "Image too large (max 10MB)" },
            { status: 400 }
          );
        }
      }
    }

    if (parsed.data.content.links && parsed.data.content.links.length > MAX_LINKS) {
      return NextResponse.json(
        { error: `Too many links (max ${MAX_LINKS})` },
        { status: 400 }
      );
    }

    // ── Dedup check — identical rules to /api/ingest, plus pending claim ──
    // A `pending_ingestion` row owned by this user is a skeleton queued
    // from the site chat. We CLAIM it (flip to processing) instead of
    // creating a duplicate row or returning already_exists.
    const normalizedUrl = normalizeUrl(parsed.data.url);
    const urlsToCheck = [normalizedUrl];
    if (parsed.data.url !== normalizedUrl) urlsToCheck.push(parsed.data.url);
    const { data: existing } = await supabase
      .from("entries")
      .select("id, slug, title, status, updated_at, moderation_status, ingested_by")
      .in("source_url", urlsToCheck)
      .in("status", ["complete", "processing", "pending_ingestion"])
      .or(
        `moderation_status.eq.approved,and(ingested_by.eq.${userId},moderation_status.neq.denied)`
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (
        existing.status === "pending_ingestion" &&
        existing.ingested_by === userId
      ) {
        // Atomic claim: only one caller can win this UPDATE because the
        // `status = 'pending_ingestion'` predicate limits the row set.
        // The loser sees 0 affected rows and falls back to the
        // processing/already_exists branch on the next iteration.
        const { data: claimed, error: claimError } = await supabase
          .from("entries")
          .update({
            status: "processing",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .eq("status", "pending_ingestion")
          .select("id, slug")
          .maybeSingle();

        if (claimError) {
          throw new Error(`Failed to claim pending entry: ${claimError.message}`);
        }

        if (claimed) {
          claimedFromPending = true;
          claimedEntryId = claimed.id;
          claimedSlug = claimed.slug ?? null;
          // Fall through to the prepare flow below, reusing this row.
        } else {
          // Lost the race. Re-query and treat as processing.
          return NextResponse.json({
            status: "already_exists",
            entry_id: existing.id,
            slug: existing.slug ?? null,
            title: existing.title,
            message:
              "Another request just claimed this pending ingestion. It's now processing.",
          });
        }
      } else if (existing.status === "processing") {
        const updatedAt = new Date(existing.updated_at).getTime();
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        if (updatedAt < oneHourAgo) {
          // Zombie cleanup — matches /api/ingest behavior.
          void logSystemEvent({
            severity: "warn",
            category: "ingestion",
            source: "ingest.prepare.dedup.zombie",
            message: `Zombie ingestion cleaned up: stuck > 1hr`,
            fingerprintKeys: ["ingestion", "zombie"],
            metadata: { entry_id: existing.id, source_url: normalizedUrl },
            userId,
          });
          await deleteFailedEntry(existing.id);
          // Fall through to fresh prepare.
        } else {
          return NextResponse.json({
            status: "already_exists",
            entry_id: existing.id,
            slug: existing.slug ?? null,
            title: existing.title,
            message:
              "An ingestion for this URL is already processing. Poll get_setup or wait for it to complete.",
          });
        }
      } else if (existing.status === "complete") {
        return NextResponse.json({
          status: "already_exists",
          entry_id: existing.id,
          slug: existing.slug ?? null,
          title: existing.title,
          message: "This URL has already been ingested.",
        });
      }
    }

    // ── Access gate: trialing or paid. Expired trials 402. ──
    const access = await hasActiveAccess(userId);
    if (!access.allowed) {
      return NextResponse.json(accessDeniedBody(access), { status: 402 });
    }

    // ── Create (or reuse claimed) entry row ──
    // When we claimed a pending_ingestion skeleton above, reuse its id
    // and skip the insert. Otherwise mint a fresh processing row.
    let entryId: string;
    if (claimedFromPending && claimedEntryId) {
      entryId = claimedEntryId;
      // createdEntryId stays null: we don't want the catch-block to
      // delete a row we didn't create. If the prepare fails for a
      // claimed entry, we'll revert its status to pending_ingestion.
    } else {
      entryId = crypto.randomUUID();
      const { error: createError } = await supabase.from("entries").insert({
        id: entryId,
        source_url: normalizedUrl,
        source_platform: detectPlatform(normalizedUrl),
        status: "processing",
        ingested_by: userId,
        slug: fallbackSlugFromId(entryId),
        // Admin-ingested entries skip the human moderation queue — they
        // land in the public catalog immediately. Non-admins default to
        // "pending" (via the DB default) and go through /admin/review.
        ...(isAdmin(userId) ? { moderation_status: "approved" } : {}),
      });
      if (createError) {
        throw new Error(`Failed to create entry: ${createError.message}`);
      }
      createdEntryId = entryId;
    }
    // Reference claimed slug so unused-var warnings stay quiet. The
    // slug is already persisted on the claimed row; we just read it for
    // the response.
    void claimedSlug;

    await logStep(entryId, "pipeline_start", "started", {
      flow: "agent",
      from_pending: claimedFromPending,
    });

    // ── Fetch + link-follow (no AI) ──
    const { gatheredContent, thumbnailUrl, sourcePlatform } =
      await extractForAgent(entryId, {
        url: normalizedUrl,
        content: {
          text: parsed.data.content.text ?? "",
          images: parsed.data.content.images,
          links: parsed.data.content.links,
        },
        userId,
      });

    // ── Persist the thumbnail on the entry row so `submit` has a single
    //    source of truth. Legacy path keeps it in memory; the split flow
    //    needs it durable across the prepare → agent → submit boundary. ──
    if (thumbnailUrl) {
      const { error: thumbError } = await supabase
        .from("entries")
        .update({
          thumbnail_url: thumbnailUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", entryId);
      if (thumbError) {
        // Non-fatal: submit will fall back to querying sources.content_metadata
        // which also contains the thumbnail. Log and continue.
        console.error(
          `[prepare] Failed to persist thumbnail_url for ${entryId}:`,
          thumbError.message
        );
      }
    }

    // ── Guard: fetcher couldn't get enough content to work with ──
    const MIN_CONTENT_LENGTH = 100;
    if (gatheredContent.trim().length < MIN_CONTENT_LENGTH) {
      const reason =
        "Content appears empty or inaccessible. The source may be behind a paywall, require authentication, or block automated access.";
      void logSystemEvent({
        severity: "warn",
        category: "ingestion",
        source: "ingest.prepare.contentCheck",
        message: "Empty/inaccessible content rejected",
        fingerprintKeys: ["ingestion", "empty_content", "agent"],
        metadata: {
          entry_id: entryId,
          source_url: normalizedUrl,
          length: gatheredContent.trim().length,
        },
        userId,
      });
      if (claimedFromPending) {
        // Don't delete — the user queued this URL and we want them to
        // retry (or cron to TTL it out). Revert to pending so the amber
        // tile survives; the catch block handles the same revert if we
        // error out before reaching this guard.
        await supabase
          .from("entries")
          .update({
            status: "pending_ingestion",
            updated_at: new Date().toISOString(),
          })
          .eq("id", entryId)
          .then(({ error: revertErr }) => {
            if (revertErr) {
              console.error(
                "[prepare] failed to revert claimed pending row after empty content:",
                revertErr.message
              );
            }
          });
      } else {
        await deleteFailedEntry(entryId);
      }
      // Surface the error up the stack. Note: for the claimed case,
      // createdEntryId is still null so the catch's deleteFailedEntry
      // path is skipped; the revert above has already handled it.
      throw new Error(reason);
    }

    // ── Build prompt bundle for the agent ──
    const bundle = buildAgentIngestBundle({ gatheredContent });

    // Echo images back so the agent can vision-analyze them. We assume the
    // client sent base64 in content.images (same contract as /api/ingest).
    const images = (parsed.data.content.images ?? []).map((b64, idx) => ({
      image_id: `img-${idx}`,
      base64: b64,
      // Mime type isn't sent in the current schema — agent can sniff from the
      // base64 header or default to image/png (what the legacy vision step does).
      mimeType: "image/png",
    }));

    return NextResponse.json({
      status: "ready",
      entry_id: entryId,
      slug: fallbackSlugFromId(entryId),
      source_url: normalizedUrl,
      source_platform: sourcePlatform,
      thumbnail_url: thumbnailUrl,
      gathered_content: bundle.gathered_content,
      gathered_content_chars: bundle.gathered_content_chars,
      images,
      prompts: bundle.prompts,
      instructions: AGENT_INGEST_INSTRUCTIONS,
    });
  } catch (error) {
    // Clean up partial DB state if we got as far as creating an entry row.
    if (createdEntryId) {
      await deleteFailedEntry(createdEntryId).catch((cleanupErr) => {
        console.error("[prepare] cleanup failed:", cleanupErr);
      });
    } else if (claimedFromPending && claimedEntryId) {
      // We claimed a pending_ingestion skeleton then failed mid-prepare.
      // Revert it to pending so the user's agent can retry on its next
      // tool call rather than leaving it stuck in `processing`.
      await supabase
        .from("entries")
        .update({
          status: "pending_ingestion",
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimedEntryId)
        .then(({ error: revertErr }) => {
          if (revertErr) {
            console.error(
              "[prepare] failed to revert claimed pending row:",
              revertErr.message
            );
          }
        });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const name = error instanceof Error ? error.name : "UnknownError";
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "POST /api/ingest/prepare",
      message: `Prepare endpoint threw: ${message}`,
      fingerprintKeys: ["ingestion", "prepare_throw", name],
      metadata: { error_name: name },
    });
    return NextResponse.json(
      { error: "Prepare failed", message },
      { status: 500 }
    );
  }
}

export const POST = withUserAuth(handlePost);

/**
 * Normalize a URL for dedup comparison.
 * Strips trailing slashes, strips utm_* / ref / source / fbclid / gclid
 * params, lowercases the host. Matches the helper in /api/ingest/route.ts
 * verbatim — kept duplicated rather than exported across routes to keep
 * the legacy ingest path's surface unchanged.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    const trackingPrefixes = ["utm_", "ref", "source", "fbclid", "gclid"];
    for (const key of [...u.searchParams.keys()]) {
      if (trackingPrefixes.some((p) => key.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }
    let result = u.toString();
    if (result.endsWith("/") && u.pathname !== "/") {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return url;
  }
}
