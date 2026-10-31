import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { DEFAULT_EVENT_RETENTION_DAYS } from "@/features/device-sdk/server/events";
import { pruneDevEvents, pruneDeviceText, rollSeedRows } from "@/features/device-sdk/server/retention";

/**
 * GET /api/cron/device-sdk-events-prune — deletes Device SDK `dev_events` rows, and the message text
 * held beside them (`retention.ts`), older than the retention window (C8 "retained per plan"; `DEFAULT_EVENT_RETENTION_DAYS` until plans exist).
 * Auth: CRON_SECRET bearer. Schedule: vercel.json.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  try {
    await rollSeedRows();
    const deleted = await pruneDevEvents({ retentionDays: DEFAULT_EVENT_RETENTION_DAYS });
    const text = await pruneDeviceText({ retentionDays: DEFAULT_EVENT_RETENTION_DAYS });
    return NextResponse.json({ ok: true, deleted, text, retention_days: DEFAULT_EVENT_RETENTION_DAYS });
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
