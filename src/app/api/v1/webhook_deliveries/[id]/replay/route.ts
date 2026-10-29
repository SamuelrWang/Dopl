import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { replayDelivery } from "@/features/device-sdk/server/webhooks/api";
import { answerWebhooks, kickWebhookSender, webhookApiDeps } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /v1/webhook_deliveries/{id}/replay` (C8) — queue the delivery again now with a fresh retry
 * budget (works on `failed` and `delivered`). Same `webhook-id`, so a receiver that dedupes ignores it.
 */
export const POST = withDeveloperKey(
  (_request, { projectId, env }, { params }) =>
    answerWebhooks(async () => {
      const { id } = await params;
      const delivery = await replayDelivery(webhookApiDeps, { projectId, env }, id ?? "");
      kickWebhookSender();
      return NextResponse.json(delivery, { status: 202 });
    }),
  { scopes: [] }
);
