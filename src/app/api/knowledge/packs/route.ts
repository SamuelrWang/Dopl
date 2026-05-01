import { NextResponse } from "next/server";
import { withMcpAccess } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * GET /api/knowledge/packs — list all installed knowledge packs.
 *
 * Visible to every authenticated MCP user. Per-user filtering (only the
 * packs a user has explicitly enabled) is deferred to V2.
 */
export const GET = withMcpAccess("kb_list_packs", async () => {
  // Inline supabaseAdmin per-call (audit fix #27) — matches the pattern
  // every other repository / route file in the codebase uses.
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("knowledge_packs")
    .select("id, name, description, sdk_version, repo_url, last_synced_at, last_commit_sha")
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ packs: data ?? [] });
});
