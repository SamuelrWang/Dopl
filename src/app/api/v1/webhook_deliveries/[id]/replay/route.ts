import { NextResponse } from "next/server";
import { replayDelivery } from "@/features/device-sdk/server/webhooks/api";
import { kickWebhookSender, webhookApiDeps, webhookRoute } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /v1/webhook_deliveries/{id}/replay` (C8): queue the delivery again now with a fresh retry
 * budget (works on `failed` and `delivered`). Same `webhook-id`, so a receiver that dedupes ignores it.
 */
export const POST = webhookRoute(async (_request, tenant, { id }) => {
  const delivery = await replayDelivery(webhookApiDeps, tenant, id ?? "");
  kickWebhookSender();
  return NextResponse.json(delivery, { status: 202 });
});
