import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { isMcpConnected } from "@/features/onboarding/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

export const dynamic = "force-dynamic";

/** GET — has the caller's agent completed the MCP OAuth dance? Polled by the onboarding connect
 *  step (~3.5s). ⚠ Reads `mcp_tokens` (active grants), NOT the legacy
 *  `profiles.mcp_connected_at` heartbeat. */
export const GET = withUserAuth(async (_request, { userId }) => {
  try {
    const connected = await isMcpConnected(userId);
    return NextResponse.json({ connected });
  } catch (err) {
    return toHttpErrorResponse("api/onboarding/mcp-status", err);
  }
});
