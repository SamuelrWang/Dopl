import { NextResponse } from "next/server";
import { withUserAuth, isAdmin } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
// ⚠ THE ONE SLUGGER (`channels/lib/mentions.ts › mentionSlug`), never a local
// copy: the handle this ping returns is the token an agent will WRITE into a
// message body, and the resolver that reads it back is exact equality against
// that same derivation. A second `.replace(/\s+/g, "-")` here is how the
// briefing comes to teach a tag the resolver does not accept.
import { mentionSlug } from "@/features/channels/lib/mentions";

export const dynamic = "force-dynamic";

const supabase = supabaseAdmin();

/**
 * 🔒 **HOW TO ADDRESS THE OPERATOR, ON THE REQUEST THAT ALREADY RAN** (A1/S48,
 * 2026-09-18).
 *
 * The MCP briefing names the caller's user id and could not name the HANDLE a
 * post has to carry, so every agent wanting to tag its own operator spent a
 * `dopl_members` roster call and re-derived the rule. This ping is the boot's
 * one guaranteed round trip; it now returns the SLUG form — the spelling
 * `insertableHandle` puts first and a picker inserts.
 *
 * ⚠ **THE SLUG, NOT AN AMBIGUITY VERDICT.** Whether a handle is contested is a
 * question about a ROOM's roster (mentions.ts rule 5) and this request has no
 * room. The briefing therefore offers the operator's own preferred spelling and
 * claims nothing about uniqueness; a contested handle still resolves the way
 * every other surface resolves it.
 *
 * ⚠ FALLBACK IS THE EMAIL LOCAL PART, the second source `handlesOf` reads, and
 * `null` when neither yields one — the briefing then prints no handle at all
 * rather than a guess.
 */
function handleOf(row: { display_name?: string | null; email?: string | null } | null): string | null {
  const name = row?.display_name?.trim();
  if (name) return mentionSlug(name) || null;
  const local = row?.email?.split("@")[0]?.trim();
  return local ? mentionSlug(local) || null : null;
}

/** POST /api/user/mcp-status — MCP server startup liveness ping; stamps the user's profile. */
export const POST = withUserAuth(async (_request, { userId }) => {
  const now = new Date().toISOString();
  const is_admin = isAdmin(userId);

  // ⚠ `.select()` ON THE UPDATE, NOT A SECOND READ. `factory.ts › bootServer`
  // forbids adding a round trip to boot, and the MCP route boots per request —
  // so the handle rides the write that was already happening.
  const { data, error } = await supabase
    .from("profiles")
    .update({ mcp_connected_at: now })
    .eq("id", userId)
    .select("display_name, email")
    .maybeSingle();

  if (error) {
    // Column may not exist yet — acknowledge the ping regardless.
    // ⚠ NO HANDLE ON THIS BRANCH, and that is the honest answer: the read that
    // would have carried it is the one that failed.
    return NextResponse.json({ ok: true, connected_at: now, is_admin, user_id: userId, handle: null });
  }

  // `user_id` lets MCP startup scope its local skill-dir cleanup to dirs it owns — see
  // packages/mcp-server/src/orphan-skill-cleanup.ts.
  return NextResponse.json({
    ok: true,
    connected_at: now,
    is_admin,
    user_id: userId,
    handle: handleOf(data),
  });
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
