"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { ModalShell } from "@/shared/layout/settings-modal";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
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
 * Create-workspace dialog in the new design language: the shared
 * ModalShell (scrim + fade/pop-in light card) in its narrow size — same
 * chrome as `CreateBaseDialog`. Keeps the field set minimal — name +
 * description — and lets the server pick the slug.
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

  function close() {
    onOpenChange(false);
    reset();
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
    <ModalShell open={open} onClose={close} label="New workspace" size="narrow">
      <button
        type="button"
        className={modalStyles.close}
        onClick={close}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <div className={modalStyles.narrowBody}>
        <h2 className={modalStyles.narrowTitle}>New workspace</h2>
        <p className="mb-6 text-lead leading-relaxed text-text-secondary">
          Each workspace is separate — its own knowledge bases, skills,
          workflows, and members. Switch between workspaces any time from the
          rail on the left.
        </p>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-label font-medium text-text-tertiary uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing automation"
              autoFocus
              className="h-9 px-3 rounded-md bg-surface-raised-3 border border-border-strong text-body text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label font-medium text-text-tertiary uppercase tracking-wider">
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
              className="px-3 py-2 rounded-md bg-surface-raised-3 border border-border-strong text-body text-text-primary placeholder:text-text-muted outline-none focus:border-border-highlight transition-colors resize-none"
            />
          </div>

          {error && <p className="text-small text-danger">{error}</p>}
        </div>

        <div className={modalStyles.confirmActions}>
          <button
            type="button"
            className={modalStyles.btnCancel}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            className={modalStyles.btnConfirm}
            onClick={handleCreate}
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Creating..." : "Create workspace"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
