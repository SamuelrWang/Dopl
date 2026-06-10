import "server-only";

import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Edge } from "@/features/canvas/types";

/**
 * Data access for canvas_edges — workflow connector edges between node
 * panels. Workspace-scoped; ids are client-generated uuids so the store
 * and the row agree without a round-trip.
 */

interface EdgeRow {
  id: string;
  from_panel_id: string;
  to_panel_id: string;
}

export async function listEdges(workspaceId: string): Promise<Edge[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvas_edges")
    .select("id, from_panel_id, to_panel_id")
    .eq("workspace_id", workspaceId);
  if (error) throw error;
  return ((data as EdgeRow[]) ?? []).map((row) => ({
    id: row.id,
    fromPanelId: row.from_panel_id,
    toPanelId: row.to_panel_id,
  }));
}

export async function insertEdge(
  workspaceId: string,
  userId: string,
  edge: Edge
): Promise<void> {
  const db = supabaseAdmin();
  // Overwrite on (from, to) conflict instead of ignoring: a fast
  // delete→redraw of the same connection races the DELETE of the old
  // row; ignoreDuplicates would silently drop the new row and the
  // trailing DELETE would then erase the only copy. Overwriting adopts
  // the new client id so the store and the row agree.
  const { error } = await db.from("canvas_edges").upsert(
    {
      id: edge.id,
      workspace_id: workspaceId,
      from_panel_id: edge.fromPanelId,
      to_panel_id: edge.toPanelId,
      created_by: userId,
    },
    { onConflict: "workspace_id,from_panel_id,to_panel_id" }
  );
  if (error) throw error;
}

export async function deleteEdge(
  workspaceId: string,
  edgeId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("canvas_edges")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", edgeId);
  if (error) throw error;
}
