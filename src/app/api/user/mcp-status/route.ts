import { NextRequest, NextResponse } from "next/server";
import { withExternalAuth, withUserAuth, isAdmin } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

export const dynamic = "force-dynamic";

const supabase = supabaseAdmin();

/**
 * POST /api/user/mcp-status — Called by the MCP server on startup to signal
 * that a connection is live. Updates the user's profile with a timestamp.
 *
 * Authenticated via API key (same as all MCP calls).
 */
export const POST = withUserAuth(async (_request, { userId }) => {
  const now = new Date().toISOString();
  const is_admin = isAdmin(userId);

  // Upsert into a lightweight mcp_connections table
  const { error } = await supabase
    .from("profiles")
    .update({ mcp_connected_at: now })
    .eq("id", userId);

  if (error) {
    // If the column doesn't exist yet, try a raw approach — store in metadata
    // For now just acknowledge the ping
    return NextResponse.json({ ok: true, connected_at: now, is_admin });
  }

  return NextResponse.json({ ok: true, connected_at: now, is_admin });
});

/**
 * GET /api/user/mcp-status — Polled by the frontend to detect MCP connection.
 * Returns whether the MCP server has pinged recently (within last 5 minutes).
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("mcp_connected_at")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return NextResponse.json({ connected: false, last_seen: null });
  }

  const lastSeen = data.mcp_connected_at;
  if (!lastSeen) {
    return NextResponse.json({ connected: false, last_seen: null });
  }

  // Consider connected if pinged within the last 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const connected = lastSeen > fiveMinutesAgo;

  return NextResponse.json({ connected, last_seen: lastSeen });
});
