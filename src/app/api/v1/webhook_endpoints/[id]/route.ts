import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { readJsonBody } from "@/features/device-sdk/server/connect/runtime";
import { deleteEndpoint, getEndpoint, updateEndpoint } from "@/features/device-sdk/server/webhooks/api";
import { answerWebhooks, webhookApiDeps } from "@/features/device-sdk/server/webhooks/runtime";

export const dynamic = "force-dynamic";

/** `GET | PATCH | DELETE /v1/webhook_endpoints/{id}` (C8). Any secret key of the endpoint's project + env. */
export const GET = withDeveloperKey(
  (_request, { projectId, env }, { params }) =>
    answerWebhooks(async () => {
      const { id } = await params;
      return NextResponse.json(await getEndpoint(webhookApiDeps, { projectId, env }, id ?? ""));
    }),
  { scopes: [] }
);

export const PATCH = withDeveloperKey(
  (request, { projectId, env }, { params }) =>
    answerWebhooks(async () => {
      const { id } = await params;
      return NextResponse.json(await updateEndpoint(webhookApiDeps, { projectId, env }, id ?? "", await readJsonBody(request)));
    }),
  { scopes: [] }
);

export const DELETE = withDeveloperKey(
  (_request, { projectId, env }, { params }) =>
    answerWebhooks(async () => {
      const { id } = await params;
      return NextResponse.json(await deleteEndpoint(webhookApiDeps, { projectId, env }, id ?? ""));
    }),
  { scopes: [] }
);
