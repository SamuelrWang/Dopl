import { NextResponse } from "next/server";
import { readJsonBody } from "@/features/device-sdk/server/connect/runtime";
import { createEndpoint, listEndpoints } from "@/features/device-sdk/server/webhooks/api";
import { webhookApiDeps, webhookRoute } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /v1/webhook_endpoints` (C8): register an https endpoint for this key's project + env.
 * Answers the endpoint WITH its signing secret (`whsec_…`), shown only here and on rotate.
 * `GET` lists them (`cursor` + `limit`, newest first).
 */
export const POST = webhookRoute(async (request, tenant) =>
  NextResponse.json(await createEndpoint(webhookApiDeps, tenant, await readJsonBody(request)), { status: 201 })
);

export const GET = webhookRoute(async (request, tenant) => NextResponse.json(await listEndpoints(webhookApiDeps, tenant, new URL(request.url).searchParams)));
