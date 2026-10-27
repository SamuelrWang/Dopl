import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { answerConnect, connectDeps, readJsonBody } from "@/features/device-sdk/server/connect/runtime";
import { exchangePublicToken } from "@/features/device-sdk/server/connect/service";

export const dynamic = "force-dynamic";

/** `POST /v1/connections/exchange` (C2) — secret key, scope `connect`; the public token works once. */
export const POST = withDeveloperKey(
  (request, { projectId, env }) =>
    answerConnect(async () =>
      NextResponse.json(await exchangePublicToken(connectDeps, { projectId, env }, await readJsonBody(request)))
    ),
  { scopes: ["connect"] }
);
