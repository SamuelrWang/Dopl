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
import type { Canvas } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional callback fired after the canvas is created. */
  onCreated?: (canvas: Canvas) => void;
  /** Skip the post-create router push when caller wants to handle nav. */
  skipRedirect?: boolean;
}

/**
 * Create-canvas modal. Mirrors the PublishDialog idiom (charcoal panel,
 * uppercase-tracking labels, white-on-black submit button). Keeps the
 * field set minimal — name + description — and lets the server pick the
 * slug.
 */
export function CreateCanvasDialog({
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
      const res = await fetch("/api/canvases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message || body?.error || "Failed to create canvas");
      }
      const { canvas } = (await res.json()) as { canvas: Canvas };
      onOpenChange(false);
      reset();
      onCreated?.(canvas);
      if (!skipRedirect) {
        router.push(`/canvas/${canvas.slug}`);
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
      <DialogContent className="sm:max-w-md bg-[#0a0a0a] border-white/[0.12] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">New canvas</DialogTitle>
          <DialogDescription className="text-white/50">
            A canvas is a workspace for one project — its own clusters,
            brain, and chat history. You can switch between canvases any
            time from the header.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing automation"
              autoFocus
              className="h-9 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white placeholder:text-white/30 outline-none focus:border-white/[0.25] transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
              Description{" "}
              <span className="text-white/30 normal-case tracking-normal">
                (optional)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What lives in this workspace?"
              rows={3}
              className="px-3 py-2 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white placeholder:text-white/30 outline-none focus:border-white/[0.25] transition-colors resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter className="bg-transparent border-white/[0.08]">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 px-4 rounded-md text-xs font-medium text-white/60 hover:text-white/80 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={submitting || !name.trim()}
            className="h-8 px-4 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Creating..." : "Create canvas"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
