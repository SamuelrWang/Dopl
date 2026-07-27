"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { AGENT_TOOL_PROFILE_LABELS } from "../constants";
import type { AgentToolProfile, Channel, ChannelMember } from "../types";

/** The three tool-scope choices for the caller's own responding agent. */
const TOOL_PROFILE_OPTIONS: Array<{
  profile: AgentToolProfile;
  description: string;
}> = [
  { profile: "full", description: "Your agent runs with all its tools." },
  { profile: "dopl_only", description: "Only the Dopl tools plus safe reads." },
  { profile: "read_only", description: "Read and safe tools only. No writes." },
];

interface Props {
  channel: Channel;
  /** Other channel members (trust targets); the caller is excluded upstream. */
  otherMembers: ChannelMember[];
  trustedIds: ReadonlySet<string>;
  /** Trust rows with a write in flight; clicks are ignored until it settles. */
  trustBusyIds: ReadonlySet<string>;
  onSetToolProfile: (profile: AgentToolProfile) => void;
  onToggleTrust: (userId: string, trusted: boolean) => void;
}

/**
 * Channel settings popover — the caller's own agent tool profile (self-only)
 * plus per-teammate standing trust. Trust is an explicit choice about a PERSON
 * ("always allow Alice's agent"): a trusted teammate's inbound requests
 * auto-allow instead of prompting. It never affects outbound review.
 *
 * Both lists are `MenuItem` rows: a `role="menu"` panel may only own menu
 * items, so the trust toggles use the checked-menuitem idiom rather than a
 * nested interactive Switch.
 */
export function ChannelSettingsPopover({
  channel,
  otherMembers,
  trustedIds,
  trustBusyIds,
  onSetToolProfile,
  onToggleTrust,
}: Props) {
  const [open, setOpen] = useState(false);
  const current = channel.myAgentToolProfile ?? "full";

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Channel settings"
        title="Agent tools & trust"
        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
      >
        <SlidersHorizontal size={16} />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="min-w-[280px]"
      >
        <p className="px-3 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-wide text-text-muted">
          Your agent&apos;s tools
        </p>
        {TOOL_PROFILE_OPTIONS.map((option) => (
          <MenuItem
            key={option.profile}
            showCheck
            active={current === option.profile}
            description={option.description}
            onSelect={() => {
              if (option.profile !== current) onSetToolProfile(option.profile);
            }}
          >
            {AGENT_TOOL_PROFILE_LABELS[option.profile]}
          </MenuItem>
        ))}

        {otherMembers.length > 0 && (
          <>
            <div className="my-1 border-t border-border-subtle" />
            <p className="px-3 pb-0.5 pt-1 text-micro font-semibold uppercase tracking-wide text-text-muted">
              Always allow
            </p>
            <p className="px-3 pb-1.5 text-caption leading-snug text-text-muted">
              Trusted teammates&apos; requests run without a prompt.
            </p>
            <div className="max-h-[200px] overflow-y-auto">
              {otherMembers.map((m) => {
                const trusted = trustedIds.has(m.userId);
                const busy = trustBusyIds.has(m.userId);
                return (
                  <MenuItem
                    key={m.userId}
                    showCheck
                    active={trusted}
                    icon={
                      <Avatar
                        person={{
                          userId: m.userId,
                          email: m.email,
                          displayName: m.displayName,
                          avatarUrl: m.avatarUrl,
                        }}
                        size="xs"
                      />
                    }
                    description={busy ? "Saving…" : undefined}
                    onSelect={() => {
                      if (!busy) onToggleTrust(m.userId, !trusted);
                    }}
                  >
                    {m.displayName || m.email || m.userId}
                  </MenuItem>
                );
              })}
            </div>
          </>
        )}
      </Popover>
    </div>
  );
}
