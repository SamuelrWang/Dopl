"use client";

import { Loader2, Plus } from "lucide-react";
import { OPEN_SCALE_ICON, OpenScaleButton } from "@/shared/ui/open-scale-button";
import type { IdentityKnowledgeRef } from "../client/types";
import { IDENTITY_ROW_ADD } from "./identity-section";

/** The personal card's footer controls, inside the card's face and never over it. */

/** The dashed add row. The paths themselves are an editor question; `refs` only words the row. */
export function AddKnowledgeRow({
  refs,
  identityName,
  onClick,
}: {
  refs: ReadonlyArray<IdentityKnowledgeRef>;
  /** Names the row: one sits on every card, and the dialog is already called "Add knowledge". */
  identityName: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Add knowledge to ${identityName}`}
      className={IDENTITY_ROW_ADD}
    >
      <Plus size={12} strokeWidth={2} className="flex-none" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {refs.length === 0 ? "Add knowledge" : "Add more knowledge"}
      </span>
    </button>
  );
}

/** One-click Launch, full width at the card's foot. */
export function LaunchIntoChannelButton({
  onClick,
  busy,
  disabled,
}: {
  onClick: () => void;
  /** The launch in flight is on THIS row. */
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <OpenScaleButton
      onClick={onClick}
      disabled={disabled || busy}
      className="w-full justify-center gap-1.5 disabled:opacity-60"
    >
      {busy && <Loader2 size={OPEN_SCALE_ICON} aria-hidden="true" className="animate-spin" />}
      Launch
    </OpenScaleButton>
  );
}
