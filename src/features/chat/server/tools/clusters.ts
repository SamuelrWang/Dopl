import "server-only";
import { listClusters as listClustersForScope } from "@/features/clusters/server/service";
import type { CanvasContextPayload } from "../canvas-context";
import type { ToolResult } from "./types";

/**
 * Tool: list_workspace_clusters — returns slug/name/workflow_count per
 * cluster (clusters are containers that group workflows).
 *
 * Delegates to the canonical `listClusters` service so this tool can't
 * drift from the schema.
 */
export async function executeListWorkspaceClusters(
  _input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: CanvasContextPayload,
  workspaceId?: string
): Promise<ToolResult> {
  if (!workspaceId || !userId) {
    return { result: JSON.stringify({ error: "Canvas not resolved." }) };
  }
  try {
    const rows = await listClustersForScope({
      workspaceId,
      userId,
      source: "agent",
    });
    const clusters = rows.map((c) => ({
      slug: c.slug,
      name: c.name,
      workflow_count: c.workflow_count,
    }));
    return { result: JSON.stringify({ clusters }) };
  } catch (err) {
    return {
      result: JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
    };
  }
}
