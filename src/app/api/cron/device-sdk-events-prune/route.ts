import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { DEFAULT_EVENT_RETENTION_DAYS, pruneDevEvents } from "@/features/device-sdk/server/events";

/**
 * GET /api/cron/device-sdk-events-prune — deletes Device SDK `dev_events` rows older than the
 * retention window (C8 "retained per plan"; `DEFAULT_EVENT_RETENTION_DAYS` until plans exist).
 * Auth: CRON_SECRET bearer. Schedule: vercel.json.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  try {
    const deleted = await pruneDevEvents({ retentionDays: DEFAULT_EVENT_RETENTION_DAYS });
    return NextResponse.json({ ok: true, deleted, retention_days: DEFAULT_EVENT_RETENTION_DAYS });
  } catch (err) {
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "GET /api/cron/device-sdk-events-prune",
      message: `dev_events prune failed: ${err instanceof Error ? err.message : String(err)}`,
      fingerprintKeys: ["device_sdk_events_prune_failed"],
    });
    return NextResponse.json({ error: "prune failed" }, { status: 500 });
  }
}
