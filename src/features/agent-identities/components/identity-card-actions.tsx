"use client";

import { Loader2, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import type { AgentIdentity, IdentityKnowledgeRef } from "../client/types";
import { EMPTY_KNOWLEDGE } from "../lib/knowledge-scopes";
import { IDENTITY_ROW_ADD } from "./identity-section";

/** Which row is launching, and the one line a refusal gets. The host owns the launch itself. */
export interface CardLaunch {
  /** The launch op exists on this build; no button otherwise. */
  canLaunch: boolean;
  /** The identity id with a launch in flight, or `null`. */
  busyId: string | null;
  /** The last refusal, on the row that earned it (a refusal is not a push). */
  error: { identityId: string; message: string } | null;
  launch: (identity: AgentIdentity) => void;
}

/** A personal card's footer: add knowledge, the row's refusal line, and Launch. */
export function PersonalCardFooter({
  identity,
  launch,
  onAddKnowledge,
}: {
  identity: AgentIdentity;
  launch: CardLaunch;
  onAddKnowledge: () => void;
}) {
  return (
    <>
      <AddKnowledgeRow
        // Stale-cache fallback: `knowledge` joined an already-persisted payload (INVARIANTS §8).
        refs={identity.knowledge ?? EMPTY_KNOWLEDGE}
        identityName={identity.name}
        onClick={onAddKnowledge}
      />
      {launch.error?.identityId === identity.id && (
        <p role="alert" className="text-caption text-danger">
          {launch.error.message}
        </p>
      )}
      {launch.canLaunch && (
        <LaunchIntoChannelButton
          busy={launch.busyId === identity.id}
          // The double-submit guard is the pane's, so every other row is inert.
          disabled={launch.busyId !== null}
          onClick={() => launch.launch(identity)}
        />
      )}
    </>
  );
}

/** The dashed add row. The paths themselves are an editor question; `refs` only words the row. */
function AddKnowledgeRow({
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

/** One-click Launch: the card's primary act, so the small ink pill, at the card's bottom right. */
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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(pillButton("ink", "sm"), "gap-1.5 self-end disabled:cursor-not-allowed disabled:opacity-60")}
    >
      {busy && <Loader2 size={12} aria-hidden="true" className="animate-spin" />}
      Launch
    </button>
  );
}
