import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * GET /api/ingest/cleanup-pending
 *
 * Scheduled job. Two sweeps:
 *
 *   1. `pending_ingestion` skeletons older than 7 days — skeletons the
 *      user's MCP agent never claimed. (Original purpose of this route.)
 *
 *   2. `processing` entries older than 1 hour with `ingested_at IS NULL` —
 *      zombie ingests where prepare created the row but submit never
 *      claimed it (server crash, network drop, agent abandoned the
 *      pipeline). `/api/ingest/prepare` reaps these opportunistically
 *      when the same URL is re-prepared, but that's URL-scoped and only
 *      fires on demand. This sweep is the unconditional safety net.
 *
 * Hit this from Vercel Cron (or any external scheduler). Authentication:
 * requires the `CRON_SECRET` env var as a bearer token so random
 * unauth'd calls don't wipe queued rows.
 */
const PENDING_TTL_DAYS = 7;
const PROCESSING_TTL_HOURS = 1;

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  // If CRON_SECRET isn't configured, refuse — don't accidentally
  // expose a destructive endpoint.
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }

  const token = auth?.replace(/^Bearer\s+/i, "").trim();
  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const pendingCutoff = new Date(
    Date.now() - PENDING_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const processingCutoff = new Date(
    Date.now() - PROCESSING_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  // Sweep 1 — pending_ingestion skeletons > 7 days.
  const { data: pendingDeleted, error: pendingError } = await supabase
    .from("entries")
    .delete()
    .eq("status", "pending_ingestion")
    .lt("created_at", pendingCutoff)
    .select("id");

  if (pendingError) {
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "cron.cleanup_pending",
      message: `Pending cleanup failed: ${pendingError.message}`,
      fingerprintKeys: ["cron", "cleanup_pending", "error"],
      metadata: { pendingCutoff },
    });
    return NextResponse.json(
      { error: "Pending cleanup failed", message: pendingError.message },
      { status: 500 }
    );
  }

  // Sweep 2 — processing rows > 1 hour where submit never claimed them.
  // The `ingested_at IS NULL` guard protects in-flight embeds (submit sets
  // ingested_at at claim time; chunkAndEmbed can legitimately run for
  // tens of seconds). updated_at isn't bumped during processing, so
  // we use created_at for age.
  const { data: processingDeleted, error: processingError } = await supabase
    .from("entries")
    .delete()
    .eq("status", "processing")
    .is("ingested_at", null)
    .lt("created_at", processingCutoff)
    .select("id");

  if (processingError) {
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "cron.cleanup_pending",
      message: `Processing cleanup failed: ${processingError.message}`,
      fingerprintKeys: ["cron", "cleanup_pending", "error"],
      metadata: { processingCutoff },
    });
    return NextResponse.json(
      { error: "Processing cleanup failed", message: processingError.message },
      { status: 500 }
    );
  }

  const pendingCount = pendingDeleted?.length ?? 0;
  const processingCount = processingDeleted?.length ?? 0;

  if (pendingCount > 0 || processingCount > 0) {
    void logSystemEvent({
      severity: "info",
      category: "ingestion",
      source: "cron.cleanup_pending",
      message: `Pruned ${pendingCount} pending + ${processingCount} zombie processing row(s)`,
      fingerprintKeys: ["cron", "cleanup_pending"],
      metadata: {
        pending_count: pendingCount,
        processing_count: processingCount,
        pending_cutoff: pendingCutoff,
        processing_cutoff: processingCutoff,
      },
    });
  }

  return NextResponse.json({
    status: "ok",
    pending_deleted: pendingCount,
    processing_deleted: processingCount,
    pending_cutoff: pendingCutoff,
    processing_cutoff: processingCutoff,
  });
}
