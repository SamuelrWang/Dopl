import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { disconnectAgentApp } from "@/features/devices/server/agent-apps";
import { agentAppRepository } from "@/features/devices/server/agent-apps-repository";

export const dynamic = "force-dynamic";

/**
 * DELETE — disconnect one agent app: every live credential it holds is revoked and its next
 * `/api/mcp` call 401s. ⚠ `sessionOnly`: an agent token must never revoke grants.
 */
export const DELETE = withUserAuth(
  async (_request, { userId, params }) => {
    try {
      const revoked = await disconnectAgentApp(
        agentAppRepository,
        userId,
        params?.key ?? "",
        new Date().toISOString()
      );
      if (revoked === 0) throw new HttpError(404, "APP_NOT_FOUND", "No such connected app.");
      return NextResponse.json({ ok: true, revoked }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return toHttpErrorResponse("oauth.apps.disconnect", err);
    }
  },
  { sessionOnly: true }
);
