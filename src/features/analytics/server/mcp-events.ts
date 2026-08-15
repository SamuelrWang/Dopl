import crypto from "crypto";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Analytics logger for MCP-originated tool calls → `mcp_events` (migration
 * 032). Complements `api_key_usage` (rate limits) by capturing the full request
 * payload: for natural-language tools the arguments ARE the user's intent.
 *
 * MCP is a tool protocol, not a conversation protocol — the server cannot see
 * the user's prompt or the LLM's response, so tool arguments are the richest
 * signal available at this boundary.
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

// ~8KB per JSONB field: enough for analytics without bloating the DB on a
// large ingest response.
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
 * Best-effort session_id from the agent (OAuth) token id + a 1-hour bucket, so
 * an admin UI can stitch calls into a pseudo-transcript. ⚠ Calls spanning an
 * hour boundary get split — the MCP transport exposes no real session id.
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

/** Fire-and-forget. Never throws — analytics must not break a request. */
export async function logMcpEvent(event: McpEventInput): Promise<void> {
  try {
    const supabase = supabaseAdmin();
    await supabase.from("mcp_events").insert({
      // ⚠ Legacy column that FK'd to the removed api_keys table; must stay
      // null so the insert is valid before and after that drop migration.
      // Agent identity lives in session_id.
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
