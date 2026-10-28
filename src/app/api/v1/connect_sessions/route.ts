import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { answerConnect, connectDeps, readJsonBody } from "@/features/device-sdk/server/connect/runtime";
import { createConnectSession } from "@/features/device-sdk/server/connect/service";

export const dynamic = "force-dynamic";

/**
 * `POST /v1/connect_sessions` (C2) — the ONE route a publishable `pk_` key may call (C1). Scope
 * `connect`. Upserts the end user by (project, env, external_user_id) and answers the hosted URL.
 */
export const POST = withDeveloperKey(
  (request, { projectId, env }) =>
    answerConnect(async () => {
      const origin = new URL(request.url).origin;
      const created = await createConnectSession(connectDeps, { projectId, env }, await readJsonBody(request), origin);
      return NextResponse.json(created, { status: 201 });
    }),
  { scopes: ["connect"], publishable: true }
);
