"use client";

/** STAGING COPY of `src/features/knowledge/components/doc-pane-chrome.tsx` — redesigned ahead of its source (PORTING.md). */
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { InlineUnderlineField } from "@/shared/ui/form-dialog";
import fieldStyles from "@/shared/ui/form-dialog.module.css";
import { SMALL_PILL_BUTTON, SMALL_PRIMARY_PILL } from "@/shared/ui/small-action-button";
import { toast } from "@/shared/ui/toast";
import { SkeletonBar } from "@/shared/ui/skeleton";
import { kbBodyIsUnsectioned, kbSummaryFault } from "@/shared/knowledge/write-rules";

/**
 * Presentational chrome for DocPane: the in-place title and description, the
 * body-loading skeleton and the 412-conflict banner. Split from `doc-pane.tsx`
 * for the §2 file-size cap; the base's info face edits its name and description
 * with the same two faces.
 */

/** A title edited in place: the page-title step, no box, no line. */
export const DOC_TITLE_INPUT =
  "w-full min-w-0 bg-transparent text-display font-semibold leading-snug tracking-tight " +
  "text-text-primary placeholder:text-text-muted focus:outline-none";

/**
 * The agent-facing description, edited in place: the kit's quiet underline
 * (no rule at rest, the ink sweep while focused) on a textarea that grows, in
 * secondary ink, with its count when editable.
 */
export function DescriptionField({
  label = "Description for agents",
  value,
  onChange,
  onBlur,
  max,
  placeholder,
  readOnly = false,
}: {
  /** The accessible name, where several sit on one page. */
  label?: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  max: number;
  placeholder: string;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-end gap-3">
      <InlineUnderlineField
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(next) => onChange(next.slice(0, max))}
        onBlur={onBlur}
        readOnly={readOnly}
        maxLength={max}
        multiline
        quiet
        className="flex-1"
        inputClassName={fieldStyles.inputSecondary}
      />
      {readOnly ? null : (
        <span className="shrink-0 pb-1 font-mono text-micro text-text-muted">
          {value.length}/{max}
        </span>
      )}
    </div>
  );
}

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
          className={SMALL_PILL_BUTTON}
        >
          Discard mine, reload
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          disabled={resolving}
          className={cn(SMALL_PRIMARY_PILL, "disabled:opacity-40")}
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
