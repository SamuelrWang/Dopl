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
import { KnowledgeApiError, createBase } from "../client/api";
import { knowledgeBaseSegment } from "../url";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceSlug: string;
}

/**
 * Create-knowledge-base modal. Modeled on `CreateWorkspaceDialog`.
 * Server derives the slug from the name; advanced users can override
 * via the settings page after creation.
 */
export function CreateBaseDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceSlug,
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
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const base = await createBase(
        { name: trimmed, description: description.trim() || undefined },
        workspaceId
      );
      onOpenChange(false);
      reset();
      router.push(`/${workspaceSlug}/knowledge/${knowledgeBaseSegment(base)}`);
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof KnowledgeApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong";
      setError(msg);
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
          <DialogTitle className="text-text-primary">New knowledge base</DialogTitle>
          <DialogDescription className="text-text-tertiary">
            A knowledge base holds folders + files. Editable in the
            browser, also accessible to your agent over MCP once you
            flip the agent-write toggle in settings.
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
              placeholder="e.g. Product specs"
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
              placeholder="What lives in this knowledge base?"
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
            {submitting ? "Creating..." : "Create"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
