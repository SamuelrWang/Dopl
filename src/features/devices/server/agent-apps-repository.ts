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
        "id, client_id, client_name, last_used_at, created_at, access_expires_at, refresh_expires_at"
      )
      .eq("user_id", userId)
      .is("revoked_at", null)
      .not("client_id", "in", FIRST_PARTY);
    if (error) throw new Error(`agent apps list failed: ${error.message}`);
    return (data ?? []) as GrantRow[];
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
