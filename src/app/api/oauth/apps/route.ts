import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { listAgentApps } from "@/features/devices/server/agent-apps";
import { agentAppRepository } from "@/features/devices/server/agent-apps-repository";

export const dynamic = "force-dynamic";

/** GET — the caller's connected agent apps, one row per app (Settings > Agents). */
export const GET = withUserAuth(
  async (_request, { userId }) => {
    try {
      const body = await listAgentApps(agentAppRepository, userId, new Date().toISOString());
      return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
    } catch (err) {
      return toHttpErrorResponse("oauth.apps.list", err);
    }
  },
  { sessionOnly: true }
);
