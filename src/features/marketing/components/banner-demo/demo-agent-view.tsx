"use client";

/**
 * The demo's agent panel, rebuilt from `channels/components/agent-panel.tsx`'s exported
 * parts: `ChannelsAgentPanel` reads the desktop bridge, which a browser cannot feed, so
 * this scripts the entries the bridge would have pushed.
 */

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import type { AvatarPerson } from "@/shared/ui/avatar";
import type {
  DesktopNarrationEntry,
  DesktopSessionSummary,
} from "@/shared/lib/spa-bridge";
import type { ChannelMessage } from "@/features/channels/types";
import type { AgentColorKey } from "@dopl/contracts";
import {
  agentDisplayName,
  agentLiveness,
  postDestination,
} from "@/features/channels/components/agents-model";
import { AgentStream } from "@/features/channels/components/agent-stream";
import {
  AgentPanelHeader,
  agentSentMessages,
} from "@/features/channels/components/agent-panel";
import { AgentStats } from "@/features/channels/components/agent-stats";
import {
  COMPOSER_BOTTOM,
  ComposerInputRow,
} from "@/features/channels/components/composer-input";

export function DemoAgentView({
  open,
  agent,
  entries,
  messages,
  currentUserId,
  viewer,
  color,
  onClose,
}: {
  open: boolean;
  agent: DesktopSessionSummary;
  /** The scripted 1:1 lane — what the bridge would have pushed. */
  entries: DesktopNarrationEntry[];
  /** The channel transcript — source of the agent's Sent lane. */
  messages: ChannelMessage[];
  currentUserId: string;
  viewer: AvatarPerson;
  /** Resolved by the mount from the channel's bank (`view-model.ts › AgentRosterEntry.color`). */
  color: AgentColorKey | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <aside
      aria-label="Agent view"
      inert={!open}
      className={cn(
        // Verbatim from agent-panel.tsx (the divider + slide notes live there).
        "absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col bg-[var(--panel-surface)]",
        "border-l border-border-default",
        "transition-transform duration-200 ease-out motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
    >
      {/* Mounted, not copied: it reads only the session row, so it needs no bridge. */}
      <AgentPanelHeader agent={agent} onClose={onClose} />

      {/* `AgentControls` is bridge-gated, so this states its box (`agent-panel-controls.tsx`,
          class for class) around the real `AgentStats`, as its `stats` slot would. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-default px-3.5 py-2">
        <AgentStats agent={agent} />
      </div>

      <AgentStream
        entries={entries}
        supported
        // The key the transcript paints this agent's posts in.
        color={color}
        // The header pill's own verdict, handed down so the two cannot disagree.
        liveness={agentLiveness(agent)}
        sent={agentSentMessages(
          messages,
          agent.taskId,
          currentUserId,
          agent.agentId,
        )}
        delivered={messages}
        destination={postDestination(agent)}
        viewer={viewer}
        className="px-3.5"
      />

      {/* `agent-composer.tsx`'s mount; the demo never sends, so the arrow stays disabled. */}
      <div className={cn("shrink-0 pt-3", COMPOSER_BOTTOM, "px-3.5")}>
        <ComposerInputRow
          face="pill"
          value={draft}
          onChange={setDraft}
          placeholder={`Message ${agentDisplayName(agent)}`}
          ariaLabel="Message your agent"
          onSend={() => {}}
          sendDisabled
          sendTitle="This is a demo"
          sendLabel="Send"
        />
      </div>
    </aside>
  );
}
