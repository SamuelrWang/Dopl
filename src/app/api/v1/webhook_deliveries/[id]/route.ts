import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { getDelivery } from "@/features/device-sdk/server/webhooks/api";
import { answerWebhooks, webhookApiDeps } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/** `GET /v1/webhook_deliveries/{id}` (C8) — one delivery with every HTTP attempt, newest first. */
export const GET = withDeveloperKey(
  (_request, { projectId, env }, { params }) =>
    answerWebhooks(async () => {
      const { id } = await params;
      return NextResponse.json(await getDelivery(webhookApiDeps, { projectId, env }, id ?? ""));
    }),
  { scopes: [] }
);
