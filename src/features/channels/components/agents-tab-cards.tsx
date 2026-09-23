"use client";

/**
 * The Agents tab's two card shapes: my own agent and a peer's, on the shared `PANEL_CARD` face.
 * Every absent number renders as absent, never `0` (INVARIANTS §11) — except the context meter.
 */

import { Bot, CornerDownRight } from "lucide-react";
import { AgentColorDot } from "./agent-color-dot";
import { agentColorOrNull } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";
import { AgentName } from "./agent-rename";
import { AgentDeleteButton } from "./agent-delete";
import { Avatar } from "@/shared/ui/avatar";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import type { ChannelMember } from "../types";
import { memberPerson } from "./view-model";
import { CARD_BUTTON, PANEL_CARD } from "./bits";
import { AgentEndedPill, AgentLiveness } from "./agent-bits";
import {
  agentDisplayName,
  agentLiveness,
  agentRunningModel,
  NO_THREAD_LABEL,
  peerRowStale,
} from "./agents-model";
import { formatTokens } from "@/shared/lib/format-tokens";
import { metric } from "./agent-metrics";
import { agentModelShortLabel } from "../lib/agent-models";
import type { ModelCatalogs } from "../lib/model-catalog";

/** The operator's description, read off a widened local type (older desktops omit it); own agents only. */
function agentDescription(
  session: DesktopSessionSummary & { description?: string | null }
): string | null {
  const value = typeof session.description === "string" ? session.description.trim() : "";
  return value || null;
}

/**
 * Other members' agents: state only, never openable. A quiet row is dimmed (`peerRowStale`), never
 * dropped — `updated_at` moves on state change, not a heartbeat, so an idle agent dims too.
 */
export function PeerCards({
  peers,
  byUser,
}: {
  peers: readonly ChannelPeerSession[];
  byUser: ReadonlyMap<string, ChannelMember>;
}) {
  if (peers.length === 0) return null;
  return (
    <>
      {peers.map((peer) => {
        const owner = byUser.get(peer.userId) ?? null;
        const ownerName = owner?.displayName || "A teammate";
        const stale = peerRowStale(peer);
        return (
          <div
            key={`${peer.userId}:${peer.name}:${peer.threadId ?? ""}`}
            data-stale={stale ? "true" : undefined}
            className={cn(PANEL_CARD, stale && "opacity-60")}
          >
            <div className="flex items-center gap-2">
              {owner ? (
                <Avatar person={memberPerson(owner)} size="xs" />
              ) : (
                <Bot size={14} aria-hidden className="shrink-0 text-text-secondary" />
              )}
              {/* No liveness gate: ended rows never reach the wire. */}
              <AgentColorDot color={agentColorOrNull(peer.color)} />
              <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
                {peer.displayName?.trim() || peer.name}
              </span>
              {/* Peer rows carry coarse state only (INVARIANTS §11), so this degrades to Running / Idle. */}
              <AgentLiveness {...agentLiveness(peer)} />
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
              <CornerDownRight size={12} aria-hidden className="shrink-0 text-text-muted" />
              <span className="min-w-0 truncate">
                {ownerName}&apos;s agent
                {peer.threadTitle ? ` · ${peer.threadTitle}` : ""}
                {/* No timestamp on a peer card, by ruling; don't derive one from `updatedAt`. */}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/** One own-agent card. `UsageMeter` gets no `over`: a full context window is not an entitlement event. */
export function AgentCard({
  agent,
  owner = null,
  viewing,
  color = null,
  catalogs = null,
  onOpen,
}: {
  agent: DesktopSessionSummary;
  /** Model catalogs, so the chip uses the runtime's own model name. */
  catalogs?: ModelCatalogs | null;
  /** Server-assigned colour from the host (this machine's feed can't know it); `null` draws nothing. */
  color?: AgentColorKey | null;
  owner?: ChannelMember | null;
  viewing: boolean;
  onOpen: () => void;
}) {
  // A channel-level agent is on the room: a place with a name, not a missing field.
  const threadTitle = agent.threadTitle ?? NO_THREAD_LABEL;
  const contextUsed = metric(agent.contextUsed);
  const contextWindow = metric(agent.contextWindow);
  const tokensSpent = metric(agent.tokensSpent);
  const ended = agent.state === "ended";
  const description = agentDescription(agent);
  // The session's running model, never the channel's stored pick; labelled from the runtime's catalog.
  const modelLabel = agentModelShortLabel(agentRunningModel(agent), catalogs);
  // Spawn-time snapshot; own cards only — on a peer card a private identity's name is an existence oracle.
  const identityName = agent.identityName?.trim() || null;

  return (
    // `group/card` is the pencil's hover scope — see `AgentName`.
    <div className={cn(PANEL_CARD, "group/card", viewing && "border-border-highlight")}>
      <div className="flex items-center gap-2">
        {owner ? (
          <Avatar person={memberPerson(owner)} size="xs" />
        ) : (
          <Bot size={14} aria-hidden className="shrink-0 text-text-secondary" />
        )}
        {/* Ended agents get `null` from the host (`view-model.ts › indexAgents`), so no gate here. */}
        <AgentColorDot color={color} />
        {/* Own cards only: the rename reaches only this machine. */}
        <AgentName agentId={agent.agentId} name={agentDisplayName(agent)} />
        {ended ? <AgentEndedPill /> : <AgentLiveness {...agentLiveness(agent)} />}
      </div>

      {/* Main's failure reason (F-692); `state` can't carry it. Own cards only. */}
      {agent.diag && (
        <p
          className="min-w-0 truncate text-caption text-danger"
          title={agent.diag}
        >
          {agent.diag}
        </p>
      )}

      {description && (
        <p className="min-w-0 truncate text-caption text-text-secondary" title={description}>
          {description}
        </p>
      )}

      <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
        <CornerDownRight size={12} aria-hidden className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate">{threadTitle}</span>
        {/* Unreported renders nothing — never "Default". */}
        {identityName && (
          <span className="min-w-0 truncate text-text-muted">· {identityName}</span>
        )}
        {modelLabel && (
          <span className="shrink-0 text-text-muted">· {modelLabel}</span>
        )}
      </div>

      {/* Draws at 0 when unmeasured (matches `agent-stats.tsx`); a rendering choice — never default the data. */}
      <UsageMeter
        label="Context tokens"
        used={contextUsed ?? 0}
        limit={contextWindow ?? 0}
        tone="ramp"
        formatValue={formatTokens}
        className="mt-0.5"
      />

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          {tokensSpent === null
            ? "Tokens spent: not measured yet"
            : `Tokens spent: ${formatTokens(tokensSpent)}`}
        </span>
        {/* Own cards only: the delete reaches only local stores. */}
        <AgentDeleteButton agent={agent} />
        <button
          type="button"
          onClick={onOpen}
          aria-current={viewing ? "true" : undefined}
          className={CARD_BUTTON}
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </div>
    </div>
  );
}
