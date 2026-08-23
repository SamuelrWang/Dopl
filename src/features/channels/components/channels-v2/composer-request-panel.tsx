"use client";

/**
 * THE COMPOSER'S NEW-THREAD PANEL — split out of `composer.tsx` on 2026-08-22 at
 * the 500-line cap, when the template chevron landed beside the Bot icon.
 *
 * ⚠ THE SEAM IS §1's "one file, one reason to change", not the line count that
 * forced the question. `composer.tsx` is about SENDING — a draft, a mention
 * picker, a bridge spawn. This is one recessed FORM that raises a REQUEST at
 * other members over the write layer, and it moves when the request's shape
 * moves. Two rates of change in one file is how a form ends up re-reviewed every
 * time a glyph is added to the icon row.
 *
 * ⚠ N PILLS = N ADDRESSEES, AND ZERO PILLS IS NOT SENDABLE. "Broadcast" is not a
 * shape this product has (INVARIANTS §5); the empty state says so out loud
 * rather than leaving a Send that quietly reaches nobody. The CONTRACT is
 * `schema.ts › TaskFanOutSchema`, where an empty addressee list is a 400.
 *
 * ⚠ THE CONCAVE FACES HERE ARE CORRECT AND DELIBERATE, and they are NOT the
 * agent-templates page's ruling (`features/agent-templates/`, where nothing is
 * pressed in). This panel is recessed INTO the composer card on purpose: the
 * body is the kit's concave section face, the pills are the raised `CHIP` that
 * face is written to carry, and the title is the concave `FIELD_WELL` — a
 * second, deeper well inside the first.
 */

import { X } from "lucide-react";
import { SECTION_BOX_INSET } from "@/shared/ui/section-box";
import { FIELD_WELL } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";
import { AgentTargetPill, IconButton } from "./bits";

export function AgentRequestPanel({
  targets,
  removed,
  title,
  onTitleChange,
  onRemove,
  onDismiss,
}: {
  targets: Array<{ id: string; label: string }>;
  removed: ReadonlySet<string>;
  title: string;
  onTitleChange: (next: string) => void;
  onRemove: (id: string) => void;
  onDismiss: () => void;
}) {
  const addressed = targets.filter((target) => !removed.has(target.id));

  return (
    <div className={cn(SECTION_BOX_INSET, "flex flex-col gap-2 rounded-[10px] p-2.5")}>
      <div className="flex items-center gap-2">
        <span className="text-label font-semibold uppercase tracking-wide text-text-secondary">
          New agent thread
        </span>
        <span className="flex-1" />
        <IconButton
          icon={X}
          label="Close new agent thread"
          size={13}
          className="h-5 w-5"
          onClick={onDismiss}
        />
      </div>

      {addressed.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {addressed.map((target) => (
            <AgentTargetPill
              key={target.id}
              label={target.label}
              onRemove={() => onRemove(target.id)}
            />
          ))}
        </div>
      ) : (
        // Fail-closed, said out loud: with nobody addressed there is no
        // thread. "Everyone" is not a shape this product has (INVARIANTS §5).
        <p className="py-1 text-caption text-text-muted">
          No agent addressed — this thread reaches nobody.
        </p>
      )}

      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        spellCheck={false}
        aria-label="Thread title"
        placeholder="Title — what is this thread about?"
        className={cn(
          FIELD_WELL,
          "h-8 w-full px-2.5 text-body text-text-primary placeholder:text-text-muted"
        )}
      />
    </div>
  );
}
