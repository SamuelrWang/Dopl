import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { logSystemEvent } from "@/lib/analytics/system-events";

/**
 * GET /api/ingest/cleanup-pending
 *
 * Scheduled job: delete `pending_ingestion` skeletons that have sat in
 * the queue for more than 7 days without being claimed by the user's
 * MCP agent. Mirrors the "zombie processing" cleanup in
 * /api/ingest/prepare (which handles 1-hour-stuck processing rows) but
 * for the longer-lived pending state.
 *
 * Hit this from Vercel Cron (or any external scheduler). Authentication:
 * requires the `CRON_SECRET` env var as a bearer token so random
 * unauth'd calls don't wipe queued rows.
 */
const PENDING_TTL_DAYS = 7;

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
  const cutoff = new Date(
    Date.now() - PENDING_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: deleted, error } = await supabase
    .from("entries")
    .delete()
    .eq("status", "pending_ingestion")
    .lt("created_at", cutoff)
    .select("id");

  if (error) {
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "cron.cleanup_pending",
      message: `Cleanup failed: ${error.message}`,
      fingerprintKeys: ["cron", "cleanup_pending", "error"],
      metadata: { cutoff },
    });
    return NextResponse.json(
      { error: "Cleanup failed", message: error.message },
      { status: 500 }
    );
  }

  const count = deleted?.length ?? 0;
  if (count > 0) {
    void logSystemEvent({
      severity: "info",
      category: "ingestion",
      source: "cron.cleanup_pending",
      message: `Pruned ${count} pending_ingestion skeleton(s) older than ${PENDING_TTL_DAYS} days`,
      fingerprintKeys: ["cron", "cleanup_pending"],
      metadata: { count, cutoff },
    });
  }

  return NextResponse.json({
    status: "ok",
    deleted: count,
    cutoff,
  });
}
