import { NextResponse } from "next/server";
import { readJsonBody } from "@/features/device-sdk/server/connect/runtime";
import { deleteEndpoint, getEndpoint, updateEndpoint } from "@/features/device-sdk/server/webhooks/api";
import { webhookApiDeps, webhookRoute } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/** `GET | PATCH | DELETE /v1/webhook_endpoints/{id}` (C8). */
export const GET = webhookRoute(async (_request, tenant, { id }) => NextResponse.json(await getEndpoint(webhookApiDeps, tenant, id ?? "")));

export const PATCH = webhookRoute(async (request, tenant, { id }) => NextResponse.json(await updateEndpoint(webhookApiDeps, tenant, id ?? "", await readJsonBody(request))));

export const DELETE = webhookRoute(async (_request, tenant, { id }) => NextResponse.json(await deleteEndpoint(webhookApiDeps, tenant, id ?? "")));
