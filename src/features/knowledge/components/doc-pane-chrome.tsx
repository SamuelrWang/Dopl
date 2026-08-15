"use client";

import { AlertTriangle } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { SkeletonBar } from "@/shared/ui/skeleton";
import { KnowledgeApiError } from "../client/api";

/**
 * Presentational chrome for DocPane: body-loading skeleton + 412-conflict
 * banner. Split from `doc-pane.tsx` for the §2 file-size cap.
 */

/**
 * Editor-column placeholder while the per-entry body fetch is in flight.
 * ⚠ Must mirror the editor's geometry (`mx-auto … max-w-3xl px-6`) or the swap
 * to real content jumps. A 0%-width entry renders as a paragraph gap.
 *
 * ⚠ Bars come from the shared kit (`SkeletonBar`) — no hand-rolled
 * `animate-pulse` clones (shared/ui/skeleton.tsx, DESIGN-SYSTEM).
 */
export function DocBodySkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-3xl px-6 pt-5 flex flex-col gap-2.5"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading document</span>
      {DOC_SKELETON_LINE_WIDTHS.map((w, i) => (
        <SkeletonBar key={i} h={14} w={w} />
      ))}
    </div>
  );
}

const DOC_SKELETON_LINE_WIDTHS = [
  "42%", "96%", "88%", "92%", "60%", "0%", "78%", "94%", "85%", "70%", "0%",
  "64%", "90%", "52%",
];

export function ConflictBanner({
  resolving,
  onKeepMine,
  onDiscardMine,
}: {
  resolving: boolean;
  onKeepMine: () => void;
  onDiscardMine: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-y border-warning/25 bg-warning/5 px-6 py-3 flex flex-wrap items-center gap-3"
    >
      <AlertTriangle size={14} className="shrink-0 text-warning" />
      <div className="min-w-0 flex-1 text-small leading-relaxed text-text-primary">
        <strong className="font-semibold">Edited elsewhere.</strong> The server
        has a newer version of this entry. Choose how to resolve — your edits
        are preserved until you do.
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscardMine}
          disabled={resolving}
          className="rounded-md border border-border-default bg-surface-raised-1 px-2.5 py-1 text-caption text-text-secondary transition-colors hover:bg-surface-raised-3 hover:text-text-primary disabled:opacity-40"
        >
          Discard mine, reload
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          disabled={resolving}
          className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1 text-caption text-text-primary transition-colors hover:bg-warning/15 disabled:opacity-40"
        >
          {resolving ? "Saving…" : "Save mine, overwrite"}
        </button>
      </div>
    </div>
  );
}

export function reportError(err: unknown, fallback: string): void {
  if (err instanceof KnowledgeApiError) {
    toast({ title: fallback, description: err.message });
    return;
  }
  toast({
    title: fallback,
    description: err instanceof Error ? err.message : "Unknown error",
  });
}
