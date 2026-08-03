"use client";

import { useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import type { Workspace } from "../types";
import { workspaceSegment } from "../url";

export interface WorkspaceDangerZoneCoreProps {
  workspace: Workspace;
  /**
   * Fired after the workspace is gone, with the workspace to land on (the
   * first one left) or `null` when none remain. Router-agnostic: the web app
   * pushes, the desktop SPA navigates its hash router.
   */
  onDeleted: (next: Workspace | null) => void;
}

/**
 * Owner-only workspace deletion's Next-free core (see
 * `./workspace-danger-zone` for the web binding): the danger-zone section box
 * + confirm dialog. Both writes go through `apiRequest`, the transport seam
 * the desktop renderer rides over IPC.
 */
export function WorkspaceDangerZoneCore({
  workspace,
  onDeleted,
}: WorkspaceDangerZoneCoreProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const segment = workspaceSegment(workspace);

  // Errors surface inline in the section below (not a toast), and the
  // dialog closes on failure — so we swallow here rather than rethrow,
  // which lets ConfirmDialog run its close-on-resolve path.
  async function handleDelete() {
    setError(null);
    try {
      await apiRequest<void>(`/api/workspaces/${segment}`, { method: "DELETE" });
      // Workspace is gone — land on the first remaining one (the caller
      // routes on through onboarding when none are left).
      const next = await apiRequest<{ workspaces?: Workspace[] }>("/api/workspaces")
        .then((body) => body.workspaces?.[0] ?? null)
        .catch(() => null);
      onDeleted(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <section className="w-full overflow-hidden rounded-[14px] border border-border-strong">
      <div className="flex items-center bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-danger">
          Danger zone
        </span>
      </div>
      <div className={cn(SECTION_BOX_INSET, "space-y-3 p-4")}>
        <p className="text-caption text-text-secondary">
          Deletes this workspace, every cluster inside it, all panels, and
          all chat history. This cannot be undone.
        </p>
        {error && <p className="text-caption text-danger">{error}</p>}
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="btn-light rounded-md px-2.5 py-1.5 text-small font-medium text-danger"
        >
          Delete workspace
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this workspace?"
        description={`You're about to permanently delete ${workspace.name}. Every cluster, panel, and chat inside it will be removed. This action cannot be undone.`}
        confirmLabel="Delete workspace"
        destructive
        onConfirm={handleDelete}
      />
    </section>
  );
}
