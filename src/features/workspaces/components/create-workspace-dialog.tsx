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
import type { Workspace } from "../types";
import { workspaceSegment } from "../url";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback fired after the workspace is created. */
  onCreated?: (workspace: Workspace) => void;
  /** Skip the post-create router push when caller wants to handle nav. */
  skipRedirect?: boolean;
}

/**
 * Create-workspace modal. Mirrors the PublishDialog idiom (charcoal panel,
 * uppercase-tracking labels, white-on-black submit button). Keeps the
 * field set minimal — name + description — and lets the server pick the
 * slug.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
  skipRedirect,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setError(null);
    setSubmitting(false);
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to create workspace");
      }
      const { workspace } = (await res.json()) as { workspace: Workspace };
      onOpenChange(false);
      reset();
      onCreated?.(workspace);
      if (!skipRedirect) {
        router.push(`/${workspaceSegment(workspace)}`);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-md bg-modal-surface border-border-strong text-text-primary">
        <DialogHeader>
          <DialogTitle className="text-text-primary">New workspace</DialogTitle>
          <DialogDescription className="text-text-tertiary">
            Each workspace is separate — its own knowledge bases, skills,
            workflows, and members. Switch between workspaces any time
            from the rail on the left.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing automation"
              autoFocus
              className="h-9 px-3 rounded-md bg-surface-raised-3 border border-border-strong text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-tertiary uppercase tracking-wider">
              Description{" "}
              <span className="text-text-muted normal-case tracking-normal">
                (optional)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What lives in this workspace?"
              rows={3}
              className="px-3 py-2 rounded-md bg-surface-raised-3 border border-border-strong text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter className="bg-transparent border-border-default">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 px-4 rounded-md text-xs font-medium text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={submitting || !name.trim()}
            className="h-8 px-4 rounded-md bg-surface-cta text-text-on-cta text-xs font-medium hover:bg-surface-cta/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Creating..." : "Create workspace"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
