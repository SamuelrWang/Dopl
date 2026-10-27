import { NextResponse } from "next/server";
import { withDeveloperKey } from "@/features/device-sdk/server/with-developer-key";
import { answerConnect, connectDeps } from "@/features/device-sdk/server/connect/runtime";
import { revokeConnection } from "@/features/device-sdk/server/connect/service";

export const dynamic = "force-dynamic";

/** `DELETE /v1/connections/{id}` (C2) — secret key, scope `connect`; answers the revoked Connection. */
export const DELETE = withDeveloperKey(
  (_request, { projectId, env }, { params }) =>
    answerConnect(async () => {
      const { id } = await params;
      return NextResponse.json(await revokeConnection(connectDeps, { projectId, env }, id ?? ""));
    }),
  { scopes: ["connect"] }
);
