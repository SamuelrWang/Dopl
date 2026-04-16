import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Analytics logger for MCP-originated tool calls.
 *
 * Writes to the `mcp_events` table (migration 032). This complements
 * `credit_ledger` (billing) and `api_key_usage` (rate limits) by capturing
 * the full request payload — for natural-language tools (`search_setups`,
 * `build_solution`, `query_cluster`, `ingest_url`, `save_cluster_memory`)
 * the arguments ARE the user's intent, verbatim.
 *
 * MCP is a tool protocol, not a conversation protocol — the server cannot
 * see the user's prompt to their LLM or the LLM's response. Tool arguments
 * are the richest signal we can capture at this boundary.
 */

export interface McpEventInput {
  userId: string | null;
  apiKeyId: string | null;
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
// without bloating the DB on a large ingest or brain synthesis response.
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
 * Derive a best-effort session_id from api_key_id + a 1-hour time bucket.
 * Groups tool calls made from the same key within a sliding hour window so
 * an admin UI can stitch them back into a pseudo-transcript. Not perfect
 * (calls spanning an hour boundary get split), but avoids protocol-level
 * session tracking which stdio MCP doesn't meaningfully expose.
 */
function deriveSessionId(apiKeyId: string | null): string | null {
  if (!apiKeyId) return null;
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
  return crypto
    .createHash("sha256")
    .update(`${apiKeyId}:${bucket}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Fire-and-forget logger. Never throws — analytics must not break a
 * user-facing request. Errors swallowed silently (we have the credit_ledger
 * as a fallback audit trail if mcp_events drops a row).
 */
export async function logMcpEvent(event: McpEventInput): Promise<void> {
  try {
    const supabase = supabaseAdmin();
    await supabase.from("mcp_events").insert({
      user_id: event.userId,
      api_key_id: event.apiKeyId,
      tool_name: event.toolName,
      endpoint: event.endpoint,
      arguments: truncate(event.arguments) ?? null,
      response_status: event.responseStatus,
      response_summary: event.responseSummary
        ? truncate(event.responseSummary)
        : null,
      latency_ms: event.latencyMs,
      session_id: deriveSessionId(event.apiKeyId),
      source: event.source,
      error: event.error ?? null,
    });
  } catch {
    // Swallow — analytics never breaks the request.
  }
}
