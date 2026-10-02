import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DEVICE_CLIENT_ID, PLAYGROUND_CLIENT_ID } from "@/shared/auth/mcp-credential";
import type { AgentAppStore, GrantRow } from "./agent-apps";

const FIRST_PARTY = `(${DEVICE_CLIENT_ID},${PLAYGROUND_CLIENT_ID})`;

/** Service-role reads of `mcp_tokens`; every statement is filtered on `user_id`. */
export const agentAppRepository: AgentAppStore = {
  async listGrants(userId) {
    const { data, error } = await supabaseAdmin()
      .from("mcp_tokens")
      .select(
        "id, client_id, client_name, last_used_at, created_at, access_expires_at, refresh_expires_at, oauth_clients(redirect_uris)"
      )
      .eq("user_id", userId)
      .is("revoked_at", null)
      .not("client_id", "in", FIRST_PARTY);
    if (error) throw new Error(`agent apps list failed: ${error.message}`);
    type Row = Omit<GrantRow, "redirect_uris"> & {
      oauth_clients: { redirect_uris: string[] | null } | null;
    };
    return ((data ?? []) as unknown as Row[]).map(({ oauth_clients, ...row }) => ({
      ...row,
      redirect_uris: oauth_clients?.redirect_uris ?? null,
    }));
  },

  async revokeTokens(userId, ids, now) {
    const { data, error } = await supabaseAdmin()
      .from("mcp_tokens")
      .update({ revoked_at: now })
      .eq("user_id", userId)
      .in("id", ids)
      .is("revoked_at", null)
      .select("id");
    if (error) throw new Error(`agent apps revoke failed: ${error.message}`);
    return (data ?? []).length;
  },
};

/** Where one credential came from — the `metadata.via` read (`channels/server/message-via.ts`). */
export interface GrantOrigin {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[] | null;
}

/** One `mcp_tokens` row by id with its client's redirect URIs, or `null`. Service-role. */
export async function readGrantOrigin(tokenId: string): Promise<GrantOrigin | null> {
  const { data, error } = await supabaseAdmin()
    .from("mcp_tokens")
    .select("client_id, client_name, oauth_clients(redirect_uris)")
    .eq("id", tokenId)
    .maybeSingle();
  if (error) throw new Error(`grant origin read failed: ${error.message}`);
  if (!data) return null;
  const { oauth_clients, ...row } = data as unknown as Omit<GrantOrigin, "redirect_uris"> & {
    oauth_clients: { redirect_uris: string[] | null } | null;
  };
  return { ...row, redirect_uris: oauth_clients?.redirect_uris ?? null };
}
