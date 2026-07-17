import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Per-op MCP instrumentation writer. Inserts one row into `mcp_tool_calls`
 * for every workspace-scoped MCP tool call, capturing who / where / what /
 * whether-it-wrote. Foundation for future usage analytics and usage-based
 * billing — distinct from `mcp_events` (which captures full payloads for
 * the admin transcript view).
 *
 * Fire-and-forget: never throws — instrumentation must not break a request.
 */

export interface McpToolCallInput {
  workspaceId: string;
  userId: string | null;
  /** Tool family, e.g. "kb", "ontology", "skill". */
  tool: string;
  /** Operation within the tool, e.g. "write_file", "create_object". */
  op: string;
  isWrite: boolean;
}

export async function logMcpToolCall(input: McpToolCallInput): Promise<void> {
  try {
    await supabaseAdmin().from("mcp_tool_calls").insert({
      workspace_id: input.workspaceId,
      user_id: input.userId,
      tool: input.tool,
      op: input.op,
      is_write: input.isWrite,
    });
  } catch {
    // Swallow — instrumentation never breaks the request.
  }
}
