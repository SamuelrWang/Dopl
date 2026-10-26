"use client";

/**
 * STAGING COPY of `marketing/components/banner-demo/demo-agent-view.tsx`. Changes (marked
 * STAGING): the composer sends — `onSend(text)` appends an operator turn to this agent's
 * in-memory lane (the demo's arrow is disabled); `layout="fill"` draws the same view as the
 * agent WINDOW's body (`popups-staging/stubs/channel-windows.tsx`): fills its box, no slide,
 * no header (the window's chrome names the agent). No bridge, no fetch.
 *
 * --- original docblock ---
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
import type { AuthorIndex } from "@/features/channels/components/view-model";
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

export function StagingAgentView({
  layout = "slide",
  open,
  agent,
  entries,
  messages,
  currentUserId,
  viewer,
  roster,
  color,
  onClose,
  onSend,
}: {
  /** STAGING: `slide` = the record pane's slide-over (default); `fill` = the agent window body. */
  layout?: "slide" | "fill";
  open: boolean;
  agent: DesktopSessionSummary;
  /** The scripted 1:1 lane — what the bridge would have pushed. */
  entries: DesktopNarrationEntry[];
  /** The channel transcript — source of the agent's Sent lane. */
  messages: ChannelMessage[];
  currentUserId: string;
  viewer: AvatarPerson;
  /** The channel's roster, for the addressee pills on a posted box (`agent-stream.tsx ›
   *  roster`). ⚠ NOT the same index as that file's `displayIndex`, which answers a
   *  different question; the demo presses no card buttons, so it hands none. */
  roster: AuthorIndex;
  /** Resolved by the mount from the channel's bank (`view-model.ts › AgentRosterEntry.color`). */
  color: AgentColorKey | null;
  onClose: () => void;
  /** STAGING: the in-memory 1:1 send. */
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <aside
      aria-label="Agent view"
      inert={!open}
      className={
        layout === "fill"
          ? // STAGING: the agent window's body box (`agent-window.tsx`'s outer column).
            "flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--panel-surface)]"
          : cn(
              // Verbatim from agent-panel.tsx (the divider + slide notes live there).
              "absolute inset-y-0 right-0 z-20 flex w-[380px] flex-col bg-[var(--panel-surface)]",
              "border-l border-border-default",
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              open ? "translate-x-0" : "pointer-events-none translate-x-full",
            )
      }
    >
      {/* Mounted, not copied: it reads only the session row, so it needs no bridge. */}
      {layout === "slide" && <AgentPanelHeader agent={agent} onClose={onClose} />}

      {/* `AgentControls` is bridge-gated, so this states its box (`agent-panel-controls.tsx`,
          class for class) around the real `AgentStats`, as its `stats` slot would. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-default px-3.5 py-2">
        <AgentStats agent={agent} />
      </div>

      <AgentStream
        entries={entries}
        supported
        roster={roster}
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
          onSend={() => {
            const text = draft.trim();
            if (!text) return;
            onSend(text);
            setDraft("");
          }}
          sendDisabled={draft.trim().length === 0}
          sendTitle={draft.trim() ? "Send" : "Write a message first"}
          sendLabel="Send"
        />
      </div>
    </aside>
  );
}
