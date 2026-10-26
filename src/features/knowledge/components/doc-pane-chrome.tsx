"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { toast } from "@/shared/ui/toast";
import { SkeletonBar } from "@/shared/ui/skeleton";
import { kbBodyIsUnsectioned, kbSummaryFault } from "@/shared/knowledge/write-rules";

/**
 * Presentational chrome for DocPane: the body-loading skeleton, the 412-conflict
 * banner and the write-rule labels. Split from `doc-pane.tsx` for the §2
 * file-size cap.
 */

/**
 * The document's placeholder while the per-entry body fetch is in flight: the
 * head card, then the editor column. Must mirror DocPane's geometry (the card's
 * `mb-6 px-6 pt-4 pb-3`, the editor's `px-6`) or the swap to real content jumps;
 * a 0%-width entry renders as a paragraph gap.
 */
export function DocBodySkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading document</span>
      <div className="white-card mb-6 flex flex-col gap-2.5 px-6 pt-4 pb-3">
        <SkeletonBar h={22} w="45%" />
        <SkeletonBar h={12} w="70%" />
      </div>
      <div className="flex flex-col gap-2.5 px-6">
        {DOC_SKELETON_LINE_WIDTHS.map((w, i) => (
          <SkeletonBar key={i} h={14} w={w} />
        ))}
      </div>
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
      className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-warning/10 px-4 py-3"
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
          className={pillButton("outline", "md")}
        >
          Discard mine, reload
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          disabled={resolving}
          className={cn(pillButton("ink", "md"), "disabled:opacity-40")}
        >
          {resolving ? "Saving…" : "Save mine, overwrite"}
        </button>
      </div>
    </div>
  );
}

/**
 * The labels a draft earns, in the order they are shown. ⚠ **DERIVATION AND
 * COPY IN ONE PLACE**, so the only thing `doc-pane.tsx` does with the rules is
 * render what comes back — see {@link WriteRuleWarnings} for the ruling.
 *
 * ⚠ **A BODYLESS ENTRY EARNS NOTHING.** A page nobody has typed into has no
 * summary because it has no content; warning there greets every new entry with
 * a complaint about itself.
 * ⚠ **NO `section` ARGUMENT, EVER** — this editor always holds the WHOLE body,
 * which is the only document the length rule may measure.
 */
export function writeRuleLabels({
  title,
  description,
  body,
}: {
  title: string;
  description: string;
  body: string;
}): string[] {
  if (body.trim() === "") return [];
  const labels: string[] = [];
  if (kbSummaryFault(description, title) !== null) labels.push("No summary");
  if (kbBodyIsUnsectioned(body)) labels.push("Long page, no headings");
  return labels;
}

/**
 * 🔒 **THE HUMAN HALF OF SAMUEL'S KB WRITE RULES (2026-09-18)** — *"Human
 * typing in the app: warn only, never blocked."* The agent half REFUSES the
 * same two shapes (`packages/mcp-server/src/tools/knowledge-write-rules.ts`);
 * this is the person's version of the identical question, which is why the
 * PREDICATE is one implementation (`src/shared/knowledge/write-rules.ts`) and
 * only the wording differs.
 *
 * ⚠ **LABEL ONLY — NO EXPLAINER, NO CONTROL, NO DISMISS** (Samuel's minimal-UI
 * ruling). Two or three words each. The entry is already saved by the time this
 * appears; there is nothing to confirm and nothing to undo, so a button here
 * would be a control with no verb.
 *
 * ⚠ **NOT A BANNER.** {@link ConflictBanner} interrupts because it is asking a
 * question; this only reports, so it rides the head card's title row beside
 * the save indicator — the existing `text-caption text-warning` + `AlertTriangle`
 * recipe this feature already uses (`agent-write-toggle.tsx`), at no new size,
 * colour or geometry.
 */
export function WriteRuleWarnings({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <span
      role="note"
      className="flex shrink-0 items-center gap-1.5 text-caption text-warning/80"
    >
      <AlertTriangle size={11} className="shrink-0" />
      {labels.join(" · ")}
    </span>
  );
}

export function reportError(err: unknown, fallback: string): void {
  toast({ title: fallback, description: userFacingMessage(err) });
}
