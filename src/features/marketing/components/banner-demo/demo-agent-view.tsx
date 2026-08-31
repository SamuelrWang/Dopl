"use client";

/**
 * The banner demo's AGENT VIEW — the product's slide-out agent panel, rebuilt
 * from the SAME exported parts `channels-v2/agent-panel.tsx` composes.
 *
 * ⚠ WHY NOT MOUNT `ChannelsV2AgentPanel` ITSELF: its stream and liveness come
 * off the desktop bridge (`useAgentNarration`), which a plain browser cannot
 * feed — the real panel would honestly render "This build cannot show what
 * your agent is doing", which is the truth and also not a demo. This wrapper
 * keeps every rendered piece REAL (`AgentStream`, `AgentControls`,
 * `AgentLiveness`, `ComposerInputRow`, the model's own derivations) and
 * scripts only the entries the bridge would have pushed. The aside's classes
 * and the header's markup are copied verbatim from `agent-panel.tsx` —
 * change that file and change this one.
 */

import { useState } from "react";
import { Bot, CornerDownRight, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { AvatarPerson } from "@/shared/ui/avatar";
import type {
  DesktopNarrationEntry,
  DesktopSessionSummary,
} from "@/shared/lib/spa-bridge";
import type { ChannelMessage } from "@/features/channels/types";
import { IconButton } from "@/features/channels/components/channels-v2/bits";
import { AgentLiveness } from "@/features/channels/components/channels-v2/agent-bits";
import {
  NO_THREAD_LABEL,
  agentDisplayName,
  agentLiveness,
} from "@/features/channels/components/channels-v2/agents-model";
import {
  formatTokens,
  metric,
} from "@/features/channels/components/channels-v2/agent-metrics";
import { AgentStream } from "@/features/channels/components/channels-v2/agent-stream";
import { agentSentMessages } from "@/features/channels/components/channels-v2/agent-panel";
import {
  COMPOSER_BOTTOM,
  ComposerInputRow,
} from "@/features/channels/components/channels-v2/composer-input";

export function DemoAgentView({
  open,
  agent,
  entries,
  messages,
  currentUserId,
  viewer,
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
      {/* agent-panel.tsx › AgentPanelHeader, verbatim (model line omitted —
          the demo feed reports no model, and absent renders nothing there). */}
      <header className="flex h-[56px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
        <Bot size={15} aria-hidden className="shrink-0 text-text-secondary" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-semibold text-text-primary">
            {agentDisplayName(agent)}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-caption text-text-secondary">
            <CornerDownRight
              size={11}
              aria-hidden
              className="shrink-0 text-text-muted"
            />
            <span className="truncate">
              in {agent.threadTitle ?? NO_THREAD_LABEL}
            </span>
          </span>
        </span>
        <AgentLiveness {...agentLiveness(agent)} />
        <IconButton icon={X} label="Close agent view" size={15} onClick={onClose} />
      </header>

      {/* agent-panel.tsx › AgentStats, verbatim — the controls strip itself is
          bridge-gated and correctly absent in a browser. */}
      <div className="flex flex-col gap-1.5 border-b border-border-default px-3.5 py-3">
        <UsageMeter
          label="Context tokens"
          used={metric(agent.contextUsed) ?? 0}
          limit={metric(agent.contextWindow) ?? 0}
          tone="ramp"
          formatValue={formatTokens}
        />
        <p className="text-caption text-text-muted">
          {[
            metric(agent.startedAt) !== null &&
              `Started ${formatRelativeTime(new Date(metric(agent.startedAt) as number).toISOString())}`,
            metric(agent.tokensSpent) !== null &&
              `${formatTokens(metric(agent.tokensSpent) as number)} tokens spent`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <AgentStream
        entries={entries}
        supported
        sent={agentSentMessages(
          messages,
          agent.taskId,
          currentUserId,
          agent.agentId,
        )}
        delivered={messages}
        threadTitle={agent.threadTitle}
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
