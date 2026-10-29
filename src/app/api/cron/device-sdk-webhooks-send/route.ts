import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/shared/auth/require-cron-secret";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { CRON_BUDGET_MS, runWebhookSenderNow } from "@/features/device-sdk/server/webhooks/runtime";

/**
 * GET /api/cron/device-sdk-webhooks-send — one Device SDK webhook sender run (C8): fan out the
 * outbox, send due deliveries, record attempts, schedule retries, dead-letter the exhausted.
 * Auth: CRON_SECRET bearer. Schedule: vercel.json (every minute).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  try {
    const report = await runWebhookSenderNow(CRON_BUDGET_MS);
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    void logSystemEvent({
      severity: "error",
      category: "other",
      source: "GET /api/cron/device-sdk-webhooks-send",
      message: `webhook sender run failed: ${err instanceof Error ? err.message : String(err)}`,
      fingerprintKeys: ["device_sdk_webhooks_send_failed"],
    });
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
