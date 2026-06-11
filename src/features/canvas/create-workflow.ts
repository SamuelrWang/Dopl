"use client";

/**
 * Workflow creation + DB sync. Spawns a workflow header panel (self-contained
 * name + description in panel_data) and creates the backing `workflows` row
 * via /api/workflows fire-and-forget. The panel carries the DB workflow id,
 * so the POST writes the row with that same id (no response round-trip needed
 * to wire the panel up).
 */

import type { Dispatch } from "react";
import { toast } from "@/shared/ui/toast";
import { normalizeClusterName } from "@/shared/lib/cluster-name";
import type { CanvasAction, CanvasState, WorkflowPanelData } from "./types";
import { WORKFLOW_PANEL_SIZE } from "./types";
import { nextPanelIdString } from "./canvas-store/layout";

interface CreateArgs {
  state: CanvasState;
  dispatch: Dispatch<CanvasAction>;
  workspaceId: string | null;
  /** World-space anchor — the header panel's top-left. */
  at: { x: number; y: number };
}

// Seed the server's canonical UPPER_SNAKE form so the panel_data name and
// the workflows row stay byte-identical (the API normalizes on write — a
// friendlier "New workflow" would drift to "NEW_WORKFLOW" on the first edit).
const DEFAULT_NAME = normalizeClusterName("New workflow");

/** Spawn a workflow header panel and create its DB row. */
export function createWorkflow({
  state,
  dispatch,
  workspaceId,
  at,
}: CreateArgs): void {
  const workflowId = crypto.randomUUID();
  const panel: WorkflowPanelData = {
    id: nextPanelIdString(state),
    type: "workflow",
    workflowId,
    name: DEFAULT_NAME,
    description: null,
    x: at.x,
    y: at.y,
    width: WORKFLOW_PANEL_SIZE.width,
    height: WORKFLOW_PANEL_SIZE.height,
  };
  dispatch({ type: "CREATE_WORKFLOW", panel });
  syncWorkflowToDb(workspaceId, workflowId, DEFAULT_NAME);
}

/** POST the workflows row (id is client-generated to match the panel). */
function syncWorkflowToDb(
  workspaceId: string | null,
  id: string,
  name: string
): void {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
  fetch("/api/workflows", {
    method: "POST",
    headers,
    body: JSON.stringify({ id, name }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    })
    .catch((err) => {
      console.error("[create-workflow] workflow DB sync failed:", err);
      toast({
        title: "Workflow created locally but couldn't sync",
        description:
          "Check your connection — changes to it won't reach agents until it syncs.",
      });
    });
}
