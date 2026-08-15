import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * OAuth client verification for the consent screen (anti-phishing).
 *
 * ⚠ `client_name` is ATTACKER-CONTROLLABLE — RFC 7591 dynamic registration is an
 * OPEN endpoint, so anyone can register "Dopl Official Desktop" and send its
 * /authorize link to a victim. The consent screen must never render a
 * first-time client's self-chosen name as a trusted first-party label. This
 * answers "have I connected this app before".
 */

/**
 * Has this user authorized this client before? True if ANY `mcp_tokens` row
 * exists for the (user, client) pair — ⚠ including revoked/expired ones, since
 * the question is "connected before", not "grant live". ⚠ Fail-closed: a DB
 * error answers `false`, widening the warning rather than suppressing it.
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
