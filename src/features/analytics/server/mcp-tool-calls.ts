import type { McpCallTally } from "@dopl/client";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Per-op MCP instrumentation: one `mcp_tool_calls` row per workspace-scoped
 * tool call — who / where / what / whether-it-wrote. Distinct from `mcp_events`
 * (full payloads for the admin transcript view).
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

/**
 * Rows tallying one MCP TOOL CALL (the consume route, once per charged call) rather than one
 * loopback request carry this prefix on `tool`; loopback rows cannot, their tool is split at "_".
 * Legacy-tool retirement reads `tool like 'mcp:%'`; loopback readers exclude {@link MCP_CALL_ROWS}.
 */
const MCP_CALL_TOOL_PREFIX = "mcp:";
/** PostgREST `like` pattern for those rows. */
export const MCP_CALL_ROWS = `${MCP_CALL_TOOL_PREFIX}*`;

const TALLY_TOOL = /^dopl_[a-z_]{1,40}$/;
const TALLY_OP = /^(?:[a-z_]{1,40}(?:\.[a-z_]{1,40})?)?$/;

/** The consume body's `call`, shape-checked (it is caller-supplied), or null. */
export async function readMcpCallTally(request: Request): Promise<McpCallTally | null> {
  try {
    const { call } = (await request.json()) as { call?: Partial<McpCallTally> };
    if (typeof call?.tool !== "string" || !TALLY_TOOL.test(call.tool)) return null;
    if (typeof call.op !== "string" || !TALLY_OP.test(call.op)) return null;
    return { tool: call.tool, op: call.op, write: call.write === true };
  } catch {
    return null;
  }
}

export function logMcpCall(workspaceId: string, userId: string | null, call: McpCallTally) {
  return logMcpToolCall({
    workspaceId,
    userId,
    tool: `${MCP_CALL_TOOL_PREFIX}${call.tool}`,
    op: call.op,
    isWrite: call.write,
  });
}
