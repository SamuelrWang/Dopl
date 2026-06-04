import "server-only";
import { listClusters as listClustersForScope } from "@/features/clusters/server/service";
import type { CanvasContextPayload } from "../canvas-context";
import type { ToolResult } from "./types";

/**
 * Tool: list_workspace_clusters — returns slug/name/panel_count per cluster.
 *
 * Delegates to the canonical `listClusters` service so this tool can't
 * drift from the schema. Counts flow through `cluster_panels` the way
 * the rest of the app does.
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
      panel_count: c.panel_count,
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
