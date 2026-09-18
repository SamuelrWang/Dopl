"use client";

/**
 * The banner demo's AGENT VIEW — the product's slide-out agent panel, rebuilt
 * from the SAME exported parts `channels/components/agent-panel.tsx` composes.
 *
 * ⚠ WHY NOT MOUNT `ChannelsAgentPanel` ITSELF: its stream and liveness come
 * off the desktop bridge (`useAgentNarration`), which a plain browser cannot
 * feed — the real panel would honestly render "This build cannot show what
 * your agent is doing", which is the truth and also not a demo. This wrapper
 * scripts only the entries the bridge would have pushed.
 *
 * 🔑 **EVERY RENDERED PIECE IS THE PANEL'S OWN COMPONENT SINCE 2026-09-17** —
 * `AgentPanelHeader`, `AgentStats`, `AgentStream` and `ComposerInputRow`, all
 * imported. The header and the stats were TRANSCRIBED here until then and had
 * drifted: the real header had grown the effective-model clause and the
 * ended-agent pill, and the real stats a third clause. **The only thing this
 * file still states is the aside's own class list** (verbatim from
 * `agent-panel.tsx`, whose divider and slide notes live there) and the box
 * around the stats that `AgentControls` would have drawn — that component is
 * bridge-gated and correctly absent in a browser.
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
  /** This agent's identity colour, resolved by the MOUNT off the channel's own
   *  bank (`view-model.ts › AgentIdentity.color`) — never stamped on a row. */
  color: AgentColorKey | null;
  onClose: () => void;
}) {
  // The demo's composer face — the REAL shared input row, never sendable.
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
      {/* 🔑 **THE PANEL'S OWN HEADER, MOUNTED — NOT COPIED (2026-09-17).** It was
          transcribed here, and by the time this scene was rebuilt the real one had
          grown the effective-model clause and the ended-agent pill that replaces the
          liveness dot. `agent-panel.tsx › AgentPanelHeader` is exported for this
          mount; it reads nothing but the session row, so it needs no bridge. */}
      <AgentPanelHeader agent={agent} onClose={onClose} />

      {/* THE CONTROLS BOX, WITHOUT ITS BUTTONS. `AgentControls` is bridge-gated
          (pause/end/open all actuate a desktop session) and correctly absent in a
          browser, but the box it draws around the stats is chrome the scene needs —
          so this states the box (`agent-panel-controls.tsx`'s own, class for class)
          and mounts the REAL `AgentStats` inside it, exactly as the panel passes it
          through that component's `stats` slot. */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-border-default px-3.5 py-2">
        <AgentStats agent={agent} />
      </div>

      <AgentStream
        entries={entries}
        supported
        // ⚠ THE AGENT'S OWN IDENTITY COLOUR, which the SENT banner boxes with —
        // the same key the transcript beside it paints this agent's posts in.
        color={color}
        // ⚠ THE LIVE TAIL AT THE FOOT OF THE STREAM (Samuel, 2026-09-14) — the
        // SAME `agentLiveness` verdict the header pill renders, handed down
        // rather than re-derived, so the two cannot disagree.
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

      {/* agent-composer.tsx's mount, with the real shared row — the demo can
          never send, so the arrow stays disabled with its honest title. */}
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
