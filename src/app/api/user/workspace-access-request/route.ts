import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

export const dynamic = "force-dynamic";

const supabase = supabaseAdmin();
const TABLE = "workspace_access_requests";

/**
 * TEAM WORKSPACES ARE INVITE-ONLY FOR NOW (Samuel, 2026-10-15). The rail's
 * "+ new workspace" opens a popup whose "Request Access" button lands here.
 *
 * ⚠ SCOPED TO THE AUTHENTICATED USER, NEVER A BODY FIELD: whose request this is
 * is not a parameter. One row per user (the table's PK), so a second press is a
 * no-op that still answers `{ requested: true }`.
 * ⚠ A PERSON'S ACT, NOT AN AGENT'S: an OAuth (agent) token is refused, so an agent
 * cannot sign its operator up for anything.
 */
export const GET = withUserAuth(async (_request, { userId, agentTokenId }) => {
  if (agentTokenId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("created_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ requested: data !== null });
  } catch (err) {
    return toHttpErrorResponse("api/user/workspace-access-request", err);
  }
});

export const POST = withUserAuth(async (_request, { userId, agentTokenId }) => {
  if (agentTokenId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    // ⚠ IDEMPOTENT: `ignoreDuplicates` is `ON CONFLICT DO NOTHING`, so the first
    // press's `created_at` is the one that stands.
    const { error } = await supabase
      .from(TABLE)
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ requested: true });
  } catch (err) {
    return toHttpErrorResponse("api/user/workspace-access-request", err);
  }
});
