import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { listUserGrants } from "@/shared/auth/mcp-oauth";

export const dynamic = "force-dynamic";

/** GET — the caller's active MCP OAuth grants ("Connected apps"). Session-authenticated. */
export const GET = withUserAuth(async (_request, { userId }) => {
  const grants = await listUserGrants(userId);
  return NextResponse.json({ grants });
});
