import { NextResponse } from "next/server";
import { getDelivery } from "@/features/device-sdk/server/webhooks/api";
import { webhookApiDeps, webhookRoute } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/** `GET /v1/webhook_deliveries/{id}` (C8): one delivery with every HTTP attempt, newest first. */
export const GET = webhookRoute(async (_request, tenant, { id }) => NextResponse.json(await getDelivery(webhookApiDeps, tenant, id ?? "")));
