import { NextRequest, NextResponse } from "next/server";
import { IngestRequestSchema } from "@/types/api";
import { ingestEntry, deleteFailedEntry } from "@/lib/ingestion/pipeline";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { MAX_CONTENT_FOR_CLAUDE, MAX_IMAGES_PER_ENTRY, MAX_IMAGE_SIZE_BYTES } from "@/lib/config";
import {
  deductCredits,
  grantCredits,
  grantDailyBonus,
  checkAndResetCycle,
  CREDIT_COSTS,
  type SubscriptionTier,
} from "@/lib/credits";
import { getUserSubscription } from "@/lib/billing/subscriptions";
import { assertPublicHttpUrl, UnsafeUrlError } from "@/lib/ingestion/url-safety";
import { logSystemEvent } from "@/lib/analytics/system-events";

const MAX_LINKS = 50;
const MAX_URL_LENGTH = 2_048;

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  let creditsDeducted = false;
  try {
    const body = await request.json();
    const parsed = IngestRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    // -- Input size validation --
    if (parsed.data.url.length > MAX_URL_LENGTH) {
      return NextResponse.json(
        { error: "URL too long", max: MAX_URL_LENGTH },
        { status: 400 }
      );
    }

    // -- SSRF guard upfront --
    // fetchSimple() in the pipeline re-checks before actually fetching, but
    // we reject here too so we don't create DB rows or burn credits for
    // obviously-malicious targets (metadata endpoints, loopback, LAN).
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

    if (parsed.data.content.text && parsed.data.content.text.length > MAX_CONTENT_FOR_CLAUDE) {
      return NextResponse.json(
        { error: "Text content too long", max: MAX_CONTENT_FOR_CLAUDE },
        { status: 400 }
      );
    }

    if (parsed.data.content.images && parsed.data.content.images.length > MAX_IMAGES_PER_ENTRY) {
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

    // ── Dedup check: has this URL already been ingested? ──────────
    // Only match entries that are either (a) publicly approved, so we can
    // share a common row across users, OR (b) the calling user's own
    // pending/processing entry. This prevents cross-user leaks — a user
    // ingesting a URL someone else submitted (and which was later denied)
    // must never be told the entry already exists.
    const normalizedUrl = normalizeUrl(parsed.data.url);
    const supabase = supabaseAdmin();
    // Check both normalized and raw URL to catch old entries
    const urlsToCheck = [normalizedUrl];
    if (parsed.data.url !== normalizedUrl) urlsToCheck.push(parsed.data.url);
    const { data: existing } = await supabase
      .from("entries")
      .select("id, slug, title, status, updated_at, moderation_status, ingested_by")
      .in("source_url", urlsToCheck)
      .in("status", ["complete", "processing"])
      .or(
        `moderation_status.eq.approved,and(ingested_by.eq.${userId},moderation_status.neq.denied)`
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (existing.status === "processing") {
        // Check if this processing entry is stale (zombie)
        const updatedAt = new Date(existing.updated_at).getTime();
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        if (updatedAt < oneHourAgo) {
          // Zombie: entry stuck in processing > 1hr. Signal a warn to the
          // health dashboard so recurring zombies become visible as an
          // abnormality (usually means the pipeline is wedged / external
          // API hanging before timeout).
          void logSystemEvent({
            severity: "warn",
            category: "ingestion",
            source: "ingest.dedup.zombie",
            message: `Zombie ingestion cleaned up: stuck > 1hr`,
            fingerprintKeys: ["ingestion", "zombie"],
            metadata: { entry_id: existing.id, source_url: normalizedUrl },
            userId,
          });
          // Delete the zombie entry entirely — no partial data stays
          // in the common DB. Fall through to new ingestion below.
          await deleteFailedEntry(existing.id);
        } else {
          // Still actively processing — return stream URL
          return NextResponse.json(
            {
              entry_id: existing.id,
              slug: existing.slug ?? null,
              status: "processing",
              title: existing.title,
              stream_url: `/api/ingest/${existing.id}/stream`,
            },
            { status: 200 }
          );
        }
      } else {
        // Already complete
        return NextResponse.json(
          {
            entry_id: existing.id,
            slug: existing.slug ?? null,
            status: "already_exists",
            title: existing.title,
          },
          { status: 200 }
        );
      }
    }

    // ── Cycle reset + daily bonus ───────────────────────────────
    const sub = await getUserSubscription(userId);
    const userTier = (sub.tier as SubscriptionTier) || "free";
    await checkAndResetCycle(userId, userTier, sub.subscription_period_end);
    await grantDailyBonus(userId, userTier);

    // ── Atomic deduct ───────────────────────────────────────────
    // Single RPC is the source of truth. Trusting the result closes the
    // race where parallel requests both pass a check-then-update.
    const deductResult = await deductCredits(userId, "ingestion", {
      url: normalizedUrl,
    });
    if (!deductResult.success) {
      return NextResponse.json(
        {
          error: "insufficient_credits",
          balance: deductResult.newBalance,
          cost: CREDIT_COSTS.ingestion,
        },
        { status: 402 }
      );
    }
    creditsDeducted = true;

    // ── New ingestion ───────────────────────────────────────────
    const entryId = await ingestEntry({
      url: normalizedUrl,
      content: {
        text: parsed.data.content.text,
        images: parsed.data.content.images,
        links: parsed.data.content.links,
      },
      userId,
    });

    // Fetch the slug assigned during row insert so the MCP client can
    // hand the user a hyperlink immediately, even before the pipeline
    // replaces the UUID-derived slug with a title-based one.
    const { data: newRow } = await supabase
      .from("entries")
      .select("slug")
      .eq("id", entryId)
      .maybeSingle();

    return NextResponse.json(
      {
        entry_id: entryId,
        slug: (newRow as { slug: string | null } | null)?.slug ?? null,
        status: "processing",
        stream_url: `/api/ingest/${entryId}/stream`,
      },
      { status: 202 }
    );
  } catch (error) {
    // Refund the upfront deduction if we charged but the endpoint failed.
    if (creditsDeducted) {
      grantCredits(userId, CREDIT_COSTS.ingestion, "ingestion_error_refund", {
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const name = error instanceof Error ? error.name : "UnknownError";
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "POST /api/ingest",
      message: `Ingest endpoint threw: ${message}`,
      fingerprintKeys: ["ingestion", "endpoint_throw", name],
      metadata: { error_name: name },
    });
    return NextResponse.json(
      { error: "Ingestion failed", message },
      { status: 500 }
    );
  }
}

export const POST = withUserAuth(handlePost);

/**
 * Normalize a URL for dedup comparison.
 * Strips trailing slashes, query params like utm_*, and lowercases the host.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    // Remove common tracking params
    const trackingPrefixes = ["utm_", "ref", "source", "fbclid", "gclid"];
    for (const key of [...u.searchParams.keys()]) {
      if (trackingPrefixes.some((p) => key.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }
    // Remove trailing slash
    let result = u.toString();
    if (result.endsWith("/") && u.pathname !== "/") {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return url;
  }
}
