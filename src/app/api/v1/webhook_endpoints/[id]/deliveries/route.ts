import { NextResponse } from "next/server";
import { listDeliveries } from "@/features/device-sdk/server/webhooks/api";
import { webhookApiDeps, webhookRoute } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/** `GET /v1/webhook_endpoints/{id}/deliveries` (C8): the endpoint's deliveries, newest first (`cursor` + `limit`). */
export const GET = webhookRoute(async (request, tenant, { id }) => NextResponse.json(await listDeliveries(webhookApiDeps, tenant, id ?? "", new URL(request.url).searchParams)));
