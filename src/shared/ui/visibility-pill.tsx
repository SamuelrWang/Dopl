"use client";

/**
 * Visibility pill — a small badge that sits next to the title on the
 * KB and skill detail pages (M-10).
 *
 * Public:  muted, no icon — the default state, doesn't shout.
 * Private: accent-colored with a lock icon — distinct enough that the
 *          owner immediately knows the item is owner-only.
 *
 * Tooltip on hover via native `title` attribute, no custom popover —
 * the pill is informational, not interactive.
 */

import { useState } from "react";
import { Lock, Globe } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export type Visibility = "public" | "private";

interface Props {
  visibility: Visibility;
  className?: string;
}

export function VisibilityPill({ visibility, className }: Props) {
  if (visibility === "private") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
          "border-amber-400/30 bg-amber-400/[0.08] text-amber-200/95",
          className,
        )}
        title="Private — only you can see this. Change it from Settings → Visibility."
        aria-label="Private — only you"
      >
        <Lock size={9} />
        Private
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        "border-white/[0.1] bg-white/[0.04] text-white/55",
        className,
      )}
      title="Public — every member of this workspace can see this."
      aria-label="Public"
    >
      Public
    </span>
  );
}

interface MakePublicProps {
  /** Resource type rendered into the confirmation copy. */
  resourceType: "knowledge base" | "skill";
  /** Async commit. Called after the user confirms; should issue the
   *  updateBase / updateSkill call with `visibility: "public"`. */
  onConfirm: () => Promise<void>;
  className?: string;
}

/**
 * Inline "Make public" button + confirmation step. Render ONLY when:
 *   - the resource's visibility is `'private'`, AND
 *   - the calling user owns the resource (createdBy = userId).
 *
 * Once-public-stays-public is the M-10 product rule: there is no
 * server path to flip back, so the confirmation copy is explicit
 * about that. Native `confirm()` keeps the dependency surface zero;
 * we can swap for a styled modal once one exists in shared/ui.
 */
export function MakePublicAction({
  resourceType,
  onConfirm,
  className,
}: MakePublicProps) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        const ok = window.confirm(
          `Make this ${resourceType} public?\n\n` +
            `Every member of this workspace will be able to see it. ` +
            `This is irreversible — once public, ${resourceType}s cannot be made private again.`,
        );
        if (!ok) return;
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
        }
      }}
      title={`Make this ${resourceType} visible to every workspace member. Cannot be undone.`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
        "border-white/[0.18] bg-white/[0.04] text-white/75 hover:bg-white/[0.08] hover:text-white/95",
        "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
        className,
      )}
    >
      <Globe size={9} />
      {busy ? "Publishing…" : "Make public"}
    </button>
  );
}
