import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { listUserGrants } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/grants — the caller's active MCP OAuth grants ("Connected
 * apps"), for the settings list. Session-authenticated (a logged-in user
 * managing their own connections).
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  const grants = await listUserGrants(userId);
  return NextResponse.json({ grants });
});
