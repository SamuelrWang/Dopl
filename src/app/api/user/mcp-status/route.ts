import { NextResponse } from "next/server";
import { withUserAuth, isAdmin } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

export const dynamic = "force-dynamic";

const supabase = supabaseAdmin();

/** POST /api/user/mcp-status — MCP server startup liveness ping; stamps the user's profile. */
export const POST = withUserAuth(async (_request, { userId }) => {
  const now = new Date().toISOString();
  const is_admin = isAdmin(userId);

  const { error } = await supabase
    .from("profiles")
    .update({ mcp_connected_at: now })
    .eq("id", userId);

  if (error) {
    // Column may not exist yet — acknowledge the ping regardless.
    return NextResponse.json({ ok: true, connected_at: now, is_admin, user_id: userId });
  }

  // `user_id` lets MCP startup scope its local skill-dir cleanup to dirs it owns — see
  // packages/mcp-server/src/orphan-skill-cleanup.ts.
  return NextResponse.json({ ok: true, connected_at: now, is_admin, user_id: userId });
// ⚠ writeScopeExempt: every MCP connection fires this non-GET ping, read-only ones included, so
// it must bypass the write-scope gate or a read-only connection never lights the indicator.
}, { writeScopeExempt: true });

/** GET — has the MCP server pinged within the last 5 minutes? */
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

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const connected = lastSeen > fiveMinutesAgo;

  return NextResponse.json({ connected, last_seen: lastSeen });
});
