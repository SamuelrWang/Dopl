import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * OAuth client verification for the consent screen (anti-phishing).
 *
 * A client's `client_name` is attacker-controllable — RFC 7591 dynamic client
 * registration is an OPEN endpoint, so anyone can register a client named
 * "Dopl Official Desktop" and send its /authorize link to a victim. The consent
 * screen must therefore never render a first-time client's self-chosen name as
 * a trusted first-party label. This module answers "have I connected this app
 * before", which is what lets the screen mark an unknown client as unverified.
 *
 * Lives outside `mcp-oauth.ts` only because that file is at the §2 500-line cap.
 */

/**
 * Has this user ever authorized this client before? True if ANY `mcp_tokens`
 * row exists for the (user, client) pair — including revoked/expired ones,
 * since the question is "have I connected this app before", not "is a grant
 * live". Fail-closed: a DB error answers `false` (treat as unverified), so a
 * lookup outage widens the warning rather than suppressing it.
 */
export async function userHasPriorGrant(
  userId: string,
  clientId: string,
): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("mcp_tokens")
    .select("id")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return data !== null;
}
