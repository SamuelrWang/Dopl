"use client";

import { useRef, useState } from "react";
import { AtSign, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { Popover } from "@/shared/ui/popover-menu";
import type { ChannelMember } from "../types";

interface Props {
  members: ChannelMember[];
  currentUserId: string;
  /** Selected target user id, or null for a plain broadcast message. */
  value: string | null;
  onChange: (userId: string | null) => void;
}

function memberLabel(m: ChannelMember): string {
  return m.displayName || m.email || m.userId;
}

/** Small online / offline status dot for a member's agent. */
export function PresenceDot({
  online,
  className,
}: {
  online: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        online ? "bg-success" : "bg-text-disabled",
        className
      )}
    />
  );
}

/**
 * "Ask a specific agent" affordance for the composer — a member picker that
 * sets `toUserId` addressing. Shows each teammate's agent presence so the
 * sender knows who's listening; excludes self (you don't address your own
 * agent through a channel).
 *
 * The list opens in the Popover's COORDINATE mode (measured off the trigger on
 * open) rather than the trigger-anchored mode: the composer is pinned to the
 * bottom of a `.page-float`, which clips overflow, so an anchored panel would
 * render as a clipped sliver. Coordinate mode portals to `<body>` and
 * `useClampedFixedPosition` slides it back up on-screen.
 */
export function AddressPicker({ members, currentUserId, value, onChange }: Props) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const targets = members.filter((m) => m.userId !== currentUserId);
  const selected = members.find((m) => m.userId === value) ?? null;

  function toggle() {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4 });
  }

  if (selected) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border-default bg-bg-elevated py-0.5 pl-1.5 pr-1 text-caption text-text-secondary">
        <span className="text-text-muted">To</span>
        <PresenceDot online={selected.agentOnline} />
        <span className="max-w-[140px] truncate font-medium text-text-primary">
          {memberLabel(selected)}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear addressee"
          className="flex h-4 w-4 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
        >
          <X size={11} />
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={targets.length === 0}
        className="inline-flex items-center gap-1 rounded-full border border-border-default bg-bg-elevated px-2 py-0.5 text-caption text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50"
      >
        <AtSign size={12} />
        Ask a specific agent
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className="min-w-[240px]"
      >
        <div className="max-h-[280px] overflow-y-auto py-1">
          {targets.map((m) => (
            <button
              key={m.userId}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(m.userId);
                setAnchor(null);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface-raised-2"
            >
              <AvatarWithPresence
                person={{
                  userId: m.userId,
                  email: m.email,
                  displayName: m.displayName,
                  avatarUrl: m.avatarUrl,
                }}
                online={m.agentOnline}
                size="xs"
                title={m.agentOnline ? "Agent listening" : "Agent offline"}
              />
              <span className="min-w-0 flex-1 truncate text-small text-text-primary">
                {memberLabel(m)}
              </span>
              <span className="shrink-0 text-micro text-text-muted">
                {m.agentOnline ? "listening" : "offline"}
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
