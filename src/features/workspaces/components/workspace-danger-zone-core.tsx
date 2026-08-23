"use client";

import { useState } from "react";
import { apiRequest } from "@/shared/api/api-client";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import type { Workspace } from "../types";
import { isStandardWorkspace } from "../types";
import { workspaceSegment } from "../url";

export interface WorkspaceDangerZoneCoreProps {
  workspace: Workspace;
  /**
   * Fired after the workspace is gone, with the workspace to land on (first one
   * left) or `null` when none remain. Router-agnostic.
   */
  onDeleted: (next: Workspace | null) => void;
}

/**
 * Owner-only workspace deletion's Next-free core (`./workspace-danger-zone` is
 * the web binding). Both writes go through `apiRequest` — the transport seam
 * the desktop renderer rides over IPC.
 */
export function WorkspaceDangerZoneCore({
  workspace,
  onDeleted,
}: WorkspaceDangerZoneCoreProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const segment = workspaceSegment(workspace);

  // ⚠ Swallow rather than rethrow so ConfirmDialog runs its close-on-resolve
  // path; errors surface inline in the section below, not a toast.
  async function handleDelete() {
    setError(null);
    try {
      await apiRequest<void>(`/api/workspaces/${segment}`, { method: "DELETE" });
      // Land on the first remaining STANDARD one; caller routes to onboarding
      // if none. ⚠ The route is unfiltered — landing on a hidden home-channel
      // container would navigate into a workspace with no UI.
      const next = await apiRequest<{ workspaces?: Workspace[] }>("/api/workspaces")
        .then((body) => body.workspaces?.find(isStandardWorkspace) ?? null)
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
          Deletes this workspace and everything inside it — clusters,
          knowledge bases, skills, and chat history. This can&rsquo;t be
          undone.
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
        description={`This permanently deletes “${workspace.name}” and every cluster, knowledge base, skill, and chat inside it. This can't be undone.`}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={handleDelete}
      />
    </section>
  );
}
