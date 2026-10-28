"use client";

/**
 * The demo's agent panel, built from `channels/components/agent-panel.tsx`'s parts:
 * `ChannelsAgentPanel` reads the desktop bridge for the agent's work stream, which a browser
 * cannot feed, so this hands the stream the entries the bridge would have pushed. Every face is
 * the product's. The /channels staging page and the /popups agent window mount it too, with a
 * send (`onSend`) and, for the window, `layout="fill"` (no slide, no header: the window's chrome
 * names the agent).
 */

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import type { AvatarPerson } from "@/shared/ui/avatar";
import type {
  DesktopNarrationEntry,
  DesktopSessionSummary,
} from "@/shared/lib/spa-bridge";
import type { ChannelMessage } from "@/features/channels/types";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import type { AgentColorKey } from "@dopl/contracts";
import {
  agentDisplayName,
  agentLiveness,
  postDestination,
} from "@/features/channels/components/agents-model";
import { AgentStream } from "@/features/channels/components/agent-stream";
import { useAgentIdentity } from "@/features/channels/components/agent-face";
import { agentSentMessages } from "@/features/channels/components/agent-panel";
import { AgentPanelHeader } from "@/features/channels/components/agent-panel-header";
import { AgentControls } from "@/features/channels/components/agent-panel-controls";
import { AgentStats } from "@/features/channels/components/agent-stats";
import {
  COMPOSER_BOTTOM,
  ComposerInputRow,
} from "@/features/channels/components/composer-input";

export function DemoAgentView({
  layout = "slide",
  open,
  agent,
  ownerPhoto,
  entries,
  messages,
  currentUserId,
  viewer,
  roster,
  color,
  onClose,
  onSend,
}: {
  /** `slide` = the record pane's slide-over; `fill` = the agent window's body. */
  layout?: "slide" | "fill";
  open: boolean;
  agent: DesktopSessionSummary;
  /** The agent owner's photo, off the scene's identity table. */
  ownerPhoto: string | null;
  /** The scripted 1:1 lane — what the bridge would have pushed. */
  entries: DesktopNarrationEntry[];
  /** The channel transcript — source of the agent's Sent lane. */
  messages: ChannelMessage[];
  currentUserId: string;
  viewer: AvatarPerson;
  /** The channel's roster, for the addressee pills on a posted box (`agent-stream.tsx › roster`). */
  roster: AuthorIndex;
  /** Resolved by the mount from the channel's bank (`view-model.ts › AgentRosterEntry.color`). */
  color: AgentColorKey | null;
  onClose: () => void;
  /** The in-memory 1:1 send; absent keeps the arrow disabled (the landing page never sends). */
  onSend?: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const face = useAgentIdentity({
    photo: ownerPhoto,
    name: agentDisplayName(agent),
    color,
    runtime: agent.runtimeId,
  });
  const text = draft.trim();
  return (
    <aside
      aria-label="Agent view"
      inert={!open}
      className={
        layout === "fill"
          ? "flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--panel-surface)]"
          : cn(
              "absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col bg-[var(--panel-surface)]",
              "border-l border-border-default",
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              open ? "translate-x-0" : "pointer-events-none translate-x-full",
            )
      }
    >
      {layout === "slide" && <AgentPanelHeader agent={agent} face={face} onClose={onClose} />}
      {/* No bridge: no Pause / End / Open window and no held gates, so the box holds the numbers. */}
      <AgentControls
        agent={agent}
        workspaceSlug=""
        stats={<AgentStats agent={agent} color={color} />}
      />
      <AgentStream
        entries={entries}
        supported
        roster={roster}
        color={color}
        self={face}
        liveness={agentLiveness(agent)}
        sent={agentSentMessages(messages, agent.threadId, currentUserId, agent.agentId)}
        delivered={messages}
        destination={postDestination(agent)}
        viewer={viewer}
        className="px-3.5"
      />
      {/* `agent-composer.tsx`'s mount, on an in-memory send. */}
      <div className={cn("shrink-0 pt-3", COMPOSER_BOTTOM, "px-3.5")}>
        <ComposerInputRow
          face="pill"
          value={draft}
          onChange={setDraft}
          placeholder={`Message ${agentDisplayName(agent)}`}
          ariaLabel="Message your agent"
          onSend={() => {
            if (!text || !onSend) return;
            onSend(text);
            setDraft("");
          }}
          sendDisabled={!onSend || text.length === 0}
          sendTitle={!onSend ? "This is a demo" : text ? "Send" : "Write a message first"}
          sendLabel="Send"
        />
      </div>
    </aside>
  );
}
