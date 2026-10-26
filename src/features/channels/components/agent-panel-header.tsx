"use client";

/**
 * Channels — THE AGENT VIEW'S HEADER: the agent's identity face, its name, where it works, its
 * status pill and the close control. It reads only the session row and the host's face facts, so
 * the landing demo mounts it too.
 */

import { CornerDownRight, X } from "lucide-react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { IdentityFace, type IdentityFacts } from "@/shared/ui/identity-face";
import { IconButton } from "./bits";
import { AgentEndedPill, AgentStatusPill } from "./agent-bits";
import {
  NO_THREAD_LABEL,
  agentDisplayName,
  agentLiveness,
  agentPermissionLabel,
  agentProfileLabel,
  agentRunningModel,
} from "./agents-model";
import { agentModelShortLabel } from "../lib/agent-models";
import { useChannelLaunchPosture } from "../hooks/use-channel-launch-posture";

export function AgentPanelHeader({
  agent,
  face,
  onClose,
}: {
  agent: DesktopSessionSummary;
  /** The owner's photo in the agent's colour ring; the runtime badge only when the host has a logo. */
  face: IdentityFacts;
  onClose: () => void;
}) {
  // The desktop's model rosters, so the label names a live model the way its runtime does (F15).
  const { catalogs } = useChannelLaunchPosture(agent.channelId);
  const modelLabel = agentModelShortLabel(agentRunningModel(agent), catalogs);
  const permissionLabel = agentPermissionLabel(agent);
  const profileLabel = agentProfileLabel(agent);
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-2.5 border-b border-border-default pr-2.5 pl-3.5">
      <IdentityFace size={30} {...face} />
      <span className="ml-0.5 flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {agentDisplayName(agent)}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-caption text-text-muted">
          <CornerDownRight size={11} aria-hidden className="shrink-0" />
          <span className="truncate">in {agent.threadTitle ?? NO_THREAD_LABEL}</span>
          {/* Only what this build reports: an absent model says nothing, never "Default". */}
          {modelLabel && <span className="shrink-0">· {modelLabel}</span>}
          {permissionLabel && (
            <span className="shrink-0" title={agent.permission?.setting}>
              · {permissionLabel}
            </span>
          )}
          {profileLabel && <span className="shrink-0">· {profileLabel}</span>}
        </span>
      </span>
      {/* The ended pill REPLACES the status: one fact, one element. */}
      {agent.state === "ended" ? (
        <AgentEndedPill />
      ) : (
        <AgentStatusPill {...agentLiveness(agent)} />
      )}
      <IconButton
        icon={X}
        label="Close agent view"
        size={14}
        onClick={onClose}
        className="rounded-full text-text-muted"
      />
    </header>
  );
}
