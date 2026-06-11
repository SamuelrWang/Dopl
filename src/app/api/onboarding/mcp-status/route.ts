import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { isMcpConnected } from "@/features/onboarding/server/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/onboarding/mcp-status — has the caller's agent completed the
 * MCP OAuth dance? Polled by the onboarding connect step (~3.5s). Reads
 * mcp_tokens (active grants), NOT the legacy profiles.mcp_connected_at
 * heartbeat.
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  try {
    const connected = await isMcpConnected(userId);
    return NextResponse.json({ connected });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
