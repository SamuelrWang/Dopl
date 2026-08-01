"use client";

import { Slash } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { Popover } from "@/shared/ui/popover-menu";
import type { MentionCandidate } from "../lib/mention";
import type { SlashCommandSpec } from "../lib/composer-commands";
import { AgentStatusDot } from "./agent-chips-bar";

/**
 * The @-mention list, opened at the composer's caret.
 *
 * Agents and humans in ONE list, agents first: both are things you can name in
 * a message, and a room where only one population is completable teaches the
 * wrong model. An agent row carries its status dot (only addressable agents are
 * offered) and its OWNER's avatar; a human row carries their own.
 *
 * Positioned in the Popover's COORDINATE mode for the same reason the address
 * picker is: the composer sits at the bottom of a `.page-float`, which clips
 * overflow, so an anchored panel would render as a clipped sliver.
 */
export function MentionPopup({
  anchor,
  candidates,
  onSelect,
  onClose,
}: {
  /** Viewport coords to open at, or null when closed. */
  anchor: { x: number; y: number } | null;
  candidates: MentionCandidate[];
  onSelect: (candidate: MentionCandidate) => void;
  onClose: () => void;
}) {
  return (
    <Popover
      open={anchor !== null && candidates.length > 0}
      at={anchor ?? undefined}
      onClose={onClose}
      className="min-w-[240px]"
    >
      <div className="max-h-[240px] overflow-y-auto py-1" role="listbox">
        {candidates.map((candidate) => (
          <button
            key={candidate.key}
            type="button"
            role="option"
            // v1 has no keyboard cursor through the list, so no row is ever the
            // selected one — stated explicitly rather than left undefined.
            aria-selected={false}
            onClick={() => onSelect(candidate)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-raised-2"
          >
            <Avatar person={candidate.person} size="xs" />
            {candidate.status && <AgentStatusDot status={candidate.status} />}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-small text-text-primary",
                candidate.kind === "agent" && "font-medium"
              )}
            >
              {candidate.kind === "agent" ? `@${candidate.label}` : candidate.label}
            </span>
            {candidate.detail && (
              <span className="shrink-0 text-micro text-text-muted">
                {candidate.detail}
              </span>
            )}
          </button>
        ))}
      </div>
    </Popover>
  );
}

/**
 * The slash-command hint row — the ONE discoverable place `/new-agent` is
 * advertised. Shows while the draft starts with `/`, listing the commands whose
 * name still matches what has been typed (so it narrows as you type and
 * disappears on a command the composer does not implement, which posts as
 * ordinary text).
 */
export function SlashCommandHint({ commands }: { commands: SlashCommandSpec[] }) {
  if (commands.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-0.5">
      {commands.map((command) => (
        <div
          key={command.name}
          className="flex items-center gap-1.5 text-caption text-text-muted"
        >
          <Slash size={12} className="shrink-0" />
          <span className="font-medium text-text-secondary">{command.usage}</span>
          <span className="min-w-0 truncate">{command.hint}</span>
        </div>
      ))}
    </div>
  );
}
