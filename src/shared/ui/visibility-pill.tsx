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
import { Lock, Globe, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";

export type Visibility = "public" | "private";

/**
 * Three-state scope badge for knowledge bases (private / team /
 * workspace). KBs moved to the fully-changeable sharing model — scope
 * is edited from Settings → Sharing, so this badge is informational
 * only. Skills still use the two-state `VisibilityPill` +
 * `MakePublicAction` below. (Local literal union rather than importing
 * the knowledge feature's `KbScope` — shared/ui stays feature-free.)
 */
export function KbScopeBadge({
  scope,
  className,
}: {
  scope: "private" | "team" | "workspace";
  className?: string;
}) {
  if (scope === "private") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
          "border-amber-400/30 bg-amber-400/[0.08] text-amber-200/95",
          className,
        )}
        title="Private — only you can see this. Change it from Settings → Sharing."
        aria-label="Private — only you"
      >
        <Lock size={9} />
        Private
      </span>
    );
  }
  if (scope === "team") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
          "border-sky-400/30 bg-sky-400/[0.08] text-sky-200/95",
          className,
        )}
        title="Team — visible to specific teams. Manage from Settings → Sharing."
        aria-label="Team — specific teams"
      >
        <Users size={9} />
        Team
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        "border-border-default bg-surface-raised-2 text-text-tertiary",
        className,
      )}
      title="Workspace — every member of this workspace can see this."
      aria-label="Workspace"
    >
      Workspace
    </span>
  );
}

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
        "border-border-default bg-surface-raised-2 text-text-tertiary",
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
 * Inline "Make public" button + confirmation step — SKILLS ONLY now.
 * Knowledge bases use the fully-changeable Sharing settings instead
 * (`KbScopeBadge` above is their read-only indicator). Render ONLY when:
 *   - the resource's visibility is `'private'`, AND
 *   - the calling user owns the resource (createdBy = userId).
 *
 * Once-public-stays-public remains the M-10 rule for skills: there is
 * no server path to flip back, so the confirmation copy is explicit
 * about that. Confirmation runs through the shared in-app
 * ConfirmDialog (new design language), not window.confirm.
 */
export function MakePublicAction({
  resourceType,
  onConfirm,
  className,
}: MakePublicProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        title={`Make this ${resourceType} visible to every workspace member. Cannot be undone.`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
          "border-border-strong bg-surface-raised-2 text-text-secondary hover:bg-surface-raised-4 hover:text-text-primary",
          "cursor-pointer",
          className,
        )}
      >
        <Globe size={9} />
        Make public
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Make this ${resourceType} public?`}
        description={
          `Every member of this workspace will be able to see it. ` +
          `This is irreversible — once public, ${resourceType}s cannot be made private again.`
        }
        confirmLabel="Make public"
        onConfirm={onConfirm}
      />
    </>
  );
}
