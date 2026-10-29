import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { readJsonBody } from "@/features/device-sdk/server/connect/runtime";
import { rotateSecret } from "@/features/device-sdk/server/webhooks/api";
import { answerWebhooks, webhookApiDeps } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /v1/webhook_endpoints/{id}/rotate_secret` (C8) — a new signing secret, answered once. The old
 * one keeps signing alongside for `overlap_seconds` (default 24h, 0 = drop now, max 7 days).
 */
export const POST = withDeveloperKey(
  (request, { projectId, env }, { params }) =>
    answerWebhooks(async () => {
      const { id } = await params;
      // An empty body means "defaults": rotate with the 24h overlap.
      const body = request.headers.get("content-length") === "0" ? {} : await readJsonBody(request);
      return NextResponse.json(await rotateSecret(webhookApiDeps, { projectId, env }, id ?? "", body));
    }),
  { scopes: [] }
);
