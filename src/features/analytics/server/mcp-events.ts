import crypto from "crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Analytics logger for MCP-originated tool calls.
 *
 * Writes to the `mcp_events` table (migration 032). This complements
 * `api_key_usage` (rate limits) by capturing the full request payload —
 * for natural-language tools (`search_setups`, `build_solution`,
 * `query_cluster`, `ingest_url`, `save_cluster_memory`) the arguments
 * ARE the user's intent, verbatim.
 *
 * MCP is a tool protocol, not a conversation protocol — the server cannot
 * see the user's prompt to their LLM or the LLM's response. Tool arguments
 * are the richest signal we can capture at this boundary.
 */

export interface McpEventInput {
  userId: string | null;
  /** From the x-workspace-id header the MCP loopback always sends. */
  workspaceId: string | null;
  agentTokenId: string | null;
  toolName: string;
  endpoint: string;
  arguments: unknown;
  responseStatus: number;
  responseSummary?: unknown;
  latencyMs: number;
  source: "mcp" | "web" | "api";
  error?: string | null;
}

// Keep JSONB columns reasonable. ~8KB per field is plenty for analytics
// without bloating the DB on a large ingest response.
const MAX_PAYLOAD_CHARS = 8_000;

function truncate(value: unknown): unknown {
  if (value == null) return value;
  try {
    const str = JSON.stringify(value);
    if (str.length <= MAX_PAYLOAD_CHARS) return value;
    return {
      _truncated: true,
      _length: str.length,
      preview: str.slice(0, MAX_PAYLOAD_CHARS),
    };
  } catch {
    return { _unserializable: true };
  }
}

/**
 * Derive a best-effort session_id from the agent (OAuth) token id + a 1-hour
 * time bucket. Groups tool calls made from the same token within a sliding hour
 * window so an admin UI can stitch them back into a pseudo-transcript. Not
 * perfect (calls spanning an hour boundary get split), but avoids
 * protocol-level session tracking the MCP transport doesn't expose.
 */
function deriveSessionId(agentTokenId: string | null): string | null {
  if (!agentTokenId) return null;
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
  return crypto
    .createHash("sha256")
    .update(`${agentTokenId}:${bucket}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Fire-and-forget logger. Never throws — analytics must not break a
 * user-facing request. Errors swallowed silently.
 */
export async function logMcpEvent(event: McpEventInput): Promise<void> {
  try {
    const supabase = supabaseAdmin();
    await supabase.from("mcp_events").insert({
      // Legacy column that FK'd to the removed api_keys table. Agent identity
      // now lives in session_id (derived from the OAuth token id). Kept null so
      // the insert is valid both before and after the api_keys drop migration.
      api_key_id: null,
      user_id: event.userId,
      workspace_id: event.workspaceId,
      tool_name: event.toolName,
      endpoint: event.endpoint,
      arguments: truncate(event.arguments) ?? null,
      response_status: event.responseStatus,
      response_summary: event.responseSummary
        ? truncate(event.responseSummary)
        : null,
      latency_ms: event.latencyMs,
      session_id: deriveSessionId(event.agentTokenId),
      source: event.source,
      error: event.error ?? null,
    });
  } catch {
    // Swallow — analytics never breaks the request.
  }
}
