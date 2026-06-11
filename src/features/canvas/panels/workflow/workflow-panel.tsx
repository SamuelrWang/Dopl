"use client";

/**
 * WorkflowPanelBody — the editable header card that fronts a workflow.
 *
 * Name + description live in the panel's own panel_data (self-contained,
 * synced to canvas_panels) and mirror to the `workflows` table via
 * /api/workflows/[workflowId] on blur so agents see the latest over MCP.
 * The trash affordance deletes the workflow row and closes the panel; a
 * single connector site (rendered by NodePortsLayer) sits at its bottom.
 */

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { normalizeClusterName } from "@/shared/lib/cluster-name";
import { DESCRIPTION_MAX } from "@/config";
import { useCanvas, useCanvasScope } from "../../canvas-store";
import type { WorkflowPanelData } from "../../types";

export function WorkflowPanelBody({ panel }: { panel: WorkflowPanelData }) {
  const { dispatch } = useCanvas();
  const scope = useCanvasScope();
  const workspaceId = scope?.workspaceId ?? null;

  const [name, setName] = useState(panel.name);
  const [description, setDescription] = useState(panel.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const nameFocusedRef = useRef(false);
  const descFocusedRef = useRef(false);
  // Serialize PATCHes so a quick rename + describe land in order.
  const patchQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Re-seed local fields when panel_data changes underneath us (realtime
  // panel sync, an agent editing over MCP) — but never clobber a field
  // the user is currently editing.
  useEffect(() => {
    if (!nameFocusedRef.current) setName(panel.name);
    if (!descFocusedRef.current) setDescription(panel.description ?? "");
  }, [panel.name, panel.description]);

  function patchWorkflowDb(body: { name?: string; description?: string | null }) {
    patchQueueRef.current = patchQueueRef.current
      .then(() => executePatch(body))
      .catch(() => {
        toast({ title: "Couldn't save workflow details" });
      });
  }

  async function executePatch(body: {
    name?: string;
    description?: string | null;
  }): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
    const res = await fetch(`/api/workflows/${panel.workflowId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  function commitName() {
    const normalized = normalizeClusterName(name);
    if (!normalized || normalized === panel.name) {
      setName(panel.name);
      return;
    }
    setName(normalized);
    dispatch({ type: "UPDATE_WORKFLOW_INFO", panelId: panel.id, name: normalized });
    patchWorkflowDb({ name: normalized });
  }

  function commitDescription() {
    const next = description.trim();
    if (next === (panel.description ?? "")) return;
    const value = next === "" ? null : next;
    dispatch({
      type: "UPDATE_WORKFLOW_INFO",
      panelId: panel.id,
      description: value,
    });
    patchWorkflowDb({ description: value });
  }

  async function handleDelete() {
    const headers: Record<string, string> = {};
    if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
    let res: Response;
    try {
      res = await fetch(`/api/workflows/${panel.workflowId}`, {
        method: "DELETE",
        headers,
      });
    } catch {
      toast({
        title: "Couldn't delete workflow",
        description: "Network error — try again.",
      });
      throw new Error("delete failed");
    }
    // 404 = already gone (deleted elsewhere) — proceed with local removal.
    if (!res.ok && res.status !== 404) {
      toast({
        title: "Couldn't delete workflow",
        description: `Server said ${res.status} — try again.`,
      });
      throw new Error("delete failed");
    }
    dispatch({ type: "CLOSE_PANEL", id: panel.id });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col px-4 pt-2.5 pb-3 gap-1.5">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          data-no-drag
          onChange={(e) => setName(e.target.value)}
          onFocus={() => {
            nameFocusedRef.current = true;
          }}
          onBlur={() => {
            nameFocusedRef.current = false;
            commitName();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Workflow name"
          placeholder="WORKFLOW_NAME"
          className="flex-1 min-w-0 bg-transparent font-mono text-[13px] font-semibold uppercase tracking-wide text-text-primary placeholder:text-text-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          aria-label="Delete workflow"
          title="Delete workflow"
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-[3px] text-text-muted hover:text-danger hover:bg-surface-raised-3 transition-colors cursor-pointer"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <textarea
        value={description}
        data-no-drag
        onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
        onFocus={() => {
          descFocusedRef.current = true;
        }}
        onBlur={() => {
          descFocusedRef.current = false;
          commitDescription();
        }}
        rows={3}
        maxLength={DESCRIPTION_MAX}
        aria-label="Workflow description"
        placeholder="Describe what this workflow does — agents see this when reading the workflow…"
        className="flex-1 min-h-0 resize-none bg-transparent text-[12px] leading-relaxed text-text-secondary placeholder:text-text-muted focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
          Workflow
        </span>
        <span className="font-mono text-[9px] text-text-muted">
          {description.length}/{DESCRIPTION_MAX}
        </span>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete workflow?"
        description={`“${panel.name}” will be deleted. Nodes inside it stay on the canvas; attached knowledge bases and skills are detached (not deleted).`}
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
