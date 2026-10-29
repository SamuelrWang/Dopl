import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { listDeliveries } from "@/features/device-sdk/server/webhooks/api";
import { answerWebhooks, webhookApiDeps } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/** `GET /v1/webhook_endpoints/{id}/deliveries` (C8) — the endpoint's deliveries, newest first (`cursor` + `limit`). */
export const GET = withDeveloperKey(
  (request, { projectId, env }, { params }) =>
    answerWebhooks(async () => {
      const { id } = await params;
      return NextResponse.json(await listDeliveries(webhookApiDeps, { projectId, env }, id ?? "", new URL(request.url).searchParams));
    }),
  { scopes: [] }
);
