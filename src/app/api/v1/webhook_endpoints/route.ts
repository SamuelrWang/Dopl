import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { readJsonBody } from "@/features/device-sdk/server/connect/runtime";
import { createEndpoint, listEndpoints } from "@/features/device-sdk/server/webhooks/api";
import { answerWebhooks, webhookApiDeps } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /v1/webhook_endpoints` (C8) — register an https endpoint for this key's project + env.
 * Answers the endpoint WITH its signing secret (`whsec_…`), shown only here and on rotate.
 * `GET` lists them (`cursor` + `limit`, newest first). Any secret key; publishable keys refused.
 */
export const POST = withDeveloperKey(
  (request, { projectId, env }) =>
    answerWebhooks(async () =>
      NextResponse.json(await createEndpoint(webhookApiDeps, { projectId, env }, await readJsonBody(request)), { status: 201 })
    ),
  { scopes: [] }
);

export const GET = withDeveloperKey(
  (request, { projectId, env }) =>
    answerWebhooks(async () =>
      NextResponse.json(await listEndpoints(webhookApiDeps, { projectId, env }, new URL(request.url).searchParams))
    ),
  { scopes: [] }
);
