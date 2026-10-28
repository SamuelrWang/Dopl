import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { answerConnect, connectDeps } from "@/features/device-sdk/server/connect/runtime";
import { listConnections } from "@/features/device-sdk/server/connect/service";

export const dynamic = "force-dynamic";

/** `GET /v1/users/{external_user_id}/connections` (C2) — secret key, scope `connect`; revoked ones included. */
export const GET = withDeveloperKey(
  (_request, { projectId, env }, { params }) =>
    answerConnect(async () => {
      const { external_user_id } = await params;
      return NextResponse.json(await listConnections(connectDeps, { projectId, env }, external_user_id ?? ""));
    }),
  { scopes: ["connect"] }
);
