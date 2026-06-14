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
import type { Workspace, Role } from "../types";
import { workspaceSegment } from "../url";

interface Props {
  workspace: Workspace;
  role: Role;
}

/**
 * Per-workspace settings form. Two sections for v1: General (rename +
 * description) and Danger zone (delete). Members tab + invitations
 * land in Phase 4.
 */
export function WorkspaceSettingsForm({ workspace, role }: Props) {
  const router = useRouter();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canEdit = role === "owner" || role === "admin";
  const canDelete = role === "owner";
  const dirty =
    name.trim() !== workspace.name ||
    (description.trim() || null) !== (workspace.description ?? null);

  const segment = workspaceSegment(workspace);

  async function handleSave() {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/workspaces/${segment}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() !== workspace.name ? name.trim() : undefined,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to save");
      }
      const { workspace: updated } = (await res.json()) as { workspace: Workspace };
      setSuccess("Saved.");
      // Slug may have changed if the name changed; redirect to the new
      // canonical settings URL so subsequent saves hit the right route.
      if (updated.slug !== workspace.slug) {
        router.push(`/${workspaceSegment(updated)}/settings`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!canDelete) return;
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
    <div className="space-y-8">
      <section className="rounded-lg bg-surface-raised-1 border border-border-default p-5">
        <h2 className="text-sm font-medium text-text-primary">General</h2>
        <p className="text-xs text-text-tertiary mt-1 mb-5">
          Renaming a workspace regenerates its slug, so the URL changes.
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              className="h-9 px-3 rounded-md bg-surface-raised-3 border border-border-strong text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors disabled:opacity-50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={!canEdit}
              className="px-3 py-2 rounded-md bg-surface-raised-3 border border-border-strong text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors resize-none disabled:opacity-50"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {success && <p className="text-xs text-emerald-400">{success}</p>}

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canEdit || !dirty || saving}
              onClick={handleSave}
              className="h-8 px-4 rounded-md bg-surface-cta text-text-on-cta text-xs font-medium hover:bg-surface-cta/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      </section>

      {canDelete && (
        <section className="rounded-lg bg-surface-raised-1 border border-red-500/20 p-5">
          <h2 className="text-sm font-medium text-red-200">Danger zone</h2>
          <p className="text-xs text-text-tertiary mt-1 mb-4">
            Deletes this workspace, every cluster inside it, all panels, and
            all chat history. This cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="h-8 px-4 rounded-md bg-red-500/10 text-red-300 border border-red-500/30 text-xs font-medium hover:bg-red-500/20 transition-colors"
          >
            Delete workspace
          </button>
        </section>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent
          showCloseButton={false}
          className="bg-modal-surface border-border-strong"
        >
          <DialogHeader>
            <DialogTitle className="text-text-primary">Delete this workspace?</DialogTitle>
            <DialogDescription className="text-text-tertiary">
              You're about to permanently delete <strong>{workspace.name}</strong>.
              Every cluster, panel, and chat inside it will be
              removed. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="h-8 px-4 rounded-md text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="h-8 px-4 rounded-md bg-red-500 text-white text-xs font-medium hover:bg-red-500/90 disabled:opacity-40 transition-colors"
            >
              {deleting ? "Deleting..." : "Delete workspace"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
