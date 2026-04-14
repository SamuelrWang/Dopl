"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clusterName: string;
  clusterDbId: string;
  onPublished?: (slug: string) => void;
}

const CATEGORIES = [
  "Marketing",
  "Development",
  "Automation",
  "Data & Analytics",
  "Design",
  "Productivity",
  "AI & ML",
  "DevOps",
  "Security",
  "Other",
];

export function PublishDialog({
  open,
  onOpenChange,
  clusterName,
  clusterDbId,
  onPublished,
}: PublishDialogProps) {
  const [title, setTitle] = useState(clusterName);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/community/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cluster_id: clusterDbId,
          title: title.trim(),
          description: description.trim(),
          category: category || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to publish");
      }

      const data = await res.json();
      onOpenChange(false);
      onPublished?.(data.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#0a0a0a] border-white/[0.12] text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Publish to Community</DialogTitle>
          <DialogDescription className="text-white/50">
            Share this cluster publicly. Others can view and import it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your cluster a name..."
              className="h-9 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white placeholder:text-white/30 outline-none focus:border-white/[0.25] transition-colors"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this cluster help people do?"
              rows={3}
              className="px-3 py-2 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white placeholder:text-white/30 outline-none focus:border-white/[0.25] transition-colors resize-none"
            />
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-white/60 uppercase tracking-wider">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 px-3 rounded-md bg-white/[0.06] border border-white/[0.12] text-sm text-white outline-none focus:border-white/[0.25] transition-colors appearance-none cursor-pointer"
            >
              <option value="" className="bg-[#0a0a0a]">
                Select a category...
              </option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat.toLowerCase()} className="bg-[#0a0a0a]">
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
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
            onClick={handlePublish}
            disabled={submitting || !title.trim()}
            className="h-8 px-4 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Publishing..." : "Publish"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
