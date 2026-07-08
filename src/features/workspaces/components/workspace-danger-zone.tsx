"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { cn } from "@/shared/lib/utils";
import type { Workspace } from "../types";
import { workspaceSegment } from "../url";

/**
 * Owner-only workspace deletion: the danger-zone section box + confirm
 * dialog. Rendered by both the settings page and the settings modal,
 * after the reversible sections.
 */
export function WorkspaceDangerZone({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const segment = workspaceSegment(workspace);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${segment}`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to delete");
      }
      // Workspace is gone — land on the first remaining one (the root
      // page redirects on through onboarding if none are left).
      const next = await fetch("/api/workspaces")
        .then((r) => (r.ok ? r.json() : { workspaces: [] }))
        .then(
          (body: { workspaces?: Workspace[] }) => body.workspaces?.[0] ?? null
        )
        .catch(() => null);
      router.push(next ? `/${workspaceSegment(next)}` : "/onboarding");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setDeleting(false);
      setConfirmDelete(false);
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

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          showCloseButton={false}
          className="bg-modal-surface border-border-strong"
        >
          <DialogHeader>
            <DialogTitle className="text-title font-semibold tracking-tight text-text-primary">
              Delete this workspace?
            </DialogTitle>
            <DialogDescription className="text-caption text-text-secondary">
              You&apos;re about to permanently delete <strong>{workspace.name}</strong>.
              Every cluster, panel, and chat inside it will be
              removed. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="btn-light rounded-md px-2.5 py-1.5 text-small font-medium text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-md bg-danger px-2.5 py-1.5 text-small font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {deleting ? "Deleting..." : "Delete workspace"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
