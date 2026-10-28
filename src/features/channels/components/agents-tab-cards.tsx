"use client";

/**
 * The Agents tab's two card shapes: my own agent and a peer's, on the identity look's white card
 * (DESIGN-LANGUAGE §4). Every absent number renders as absent, never `0` (INVARIANTS §11), except
 * the context meter.
 */

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { formatTokens } from "@/shared/lib/format-tokens";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { pillButton } from "@/shared/ui/pill-button";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import { agentColorOrNull } from "@/shared/lib/agent-colors";
import { agentModelShortLabel } from "../lib/agent-models";
import type { ModelCatalogs } from "../lib/model-catalog";
import type { AgentColorKey, ChannelMember } from "../types";
import { AgentStatusPill } from "./agent-bits";
import { AgentDeleteButton } from "./agent-delete";
import { AgentFace } from "./agent-face";
import { metric } from "./agent-metrics";
import { AgentName } from "./agent-rename";
import { ContextMeter } from "./agent-stats";
import {
  agentDisplayName,
  agentLiveness,
  agentPermissionLabel,
  agentProfileLabel,
  agentRunningModel,
  NO_THREAD_LABEL,
  peerRowStale,
} from "./agents-model";

const CARD = "white-card flex flex-col px-3 py-2.5";
/** Under the name, clear of the 30px face and its gap. */
const UNDER_HEAD = "mt-1.5 ml-9.75 min-w-0 truncate text-caption";
const OPEN_BUTTON = cn(pillButton("outline", "sm"), "px-3");

/** The operator's description, read off a widened local type (older desktops omit it); own agents only. */
function agentDescription(
  session: DesktopSessionSummary & { description?: string | null }
): string | null {
  const value = typeof session.description === "string" ? session.description.trim() : "";
  return value || null;
}

function CardHead({
  owner,
  color,
  runtime,
  name,
  status,
}: {
  owner: ChannelMember | null;
  color: AgentColorKey | null;
  runtime: string | null;
  name: ReactNode;
  status: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.25">
      <AgentFace
        size="m"
        photo={owner?.avatarUrl}
        name={owner?.displayName}
        color={color}
        runtime={runtime}
      />
      {name}
      {status}
    </div>
  );
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
        const stale = peerRowStale(peer);
        const color = agentColorOrNull(peer.color);
        return (
          <div
            key={`${peer.userId}:${peer.name}:${peer.threadId ?? ""}`}
            data-stale={stale ? "true" : undefined}
            data-agent-color={color ?? undefined}
            className={cn(CARD, stale && "opacity-60")}
          >
            <CardHead
              owner={owner}
              color={color}
              runtime={peer.runtime ?? null}
              name={
                <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
                  {peer.displayName?.trim() || peer.name}
                </span>
              }
              // Peer rows carry coarse state only (INVARIANTS §11), so this degrades to Running / Idle.
              status={<AgentStatusPill {...agentLiveness(peer)} />}
            />
            {/* No timestamp on a peer card, by ruling; don't derive one from `updatedAt`. */}
            <p className={cn(UNDER_HEAD, "text-text-muted")}>
              ↳ {owner?.displayName || "A teammate"}&apos;s agent
              {peer.threadTitle ? ` · ${peer.threadTitle}` : ""}
            </p>
          </div>
        );
      })}
    </>
  );
}

/** One own-agent card. */
export function AgentCard({
  agent,
  owner = null,
  viewing,
  color = null,
  runtime = null,
  catalogs = null,
  onOpen,
}: {
  agent: DesktopSessionSummary;
  /** Model catalogs, so the line uses the runtime's own model name. */
  catalogs?: ModelCatalogs | null;
  /** Server-assigned colour from the host (this machine's feed can't know it); `null` rings neutral. */
  color?: AgentColorKey | null;
  /** `agent-face.tsx › agentRuntime`, resolved by the host; `null` draws no badge. */
  runtime?: string | null;
  owner?: ChannelMember | null;
  viewing: boolean;
  onOpen: () => void;
}) {
  const tokensSpent = metric(agent.tokensSpent);
  const description = agentDescription(agent);
  const permissionLabel = agentPermissionLabel(agent);
  // Spawn-time snapshot; own cards only — on a peer card a private identity's name is an existence oracle.
  const identityName = agent.identityName?.trim() || null;
  // The session's running model, never the channel's stored pick; labelled from the runtime's catalog.
  const modelLabel = agentModelShortLabel(agentRunningModel(agent), catalogs);
  const profileLabel = agentProfileLabel(agent);
  // A channel-level agent is on the room: a place with a name, not a missing field.
  const where = [agent.threadTitle ?? NO_THREAD_LABEL, identityName, modelLabel];

  return (
    // `group/card` is the pencil's and the delete's hover scope.
    <div
      data-viewing={viewing ? "true" : undefined}
      data-agent-color={color ?? undefined}
      className={cn(CARD, "group/card", viewing && "border-border-highlight")}
    >
      <CardHead
        owner={owner}
        color={color}
        runtime={runtime}
        // Own cards only: the rename reaches only this machine.
        name={<AgentName agentId={agent.agentId} name={agentDisplayName(agent)} />}
        status={<AgentStatusPill {...agentLiveness(agent)} />}
      />

      {/* Main's failure reason (F-692); `state` can't carry it. Own cards only. */}
      {agent.diag && (
        <p className={cn(UNDER_HEAD, "text-danger")} title={agent.diag}>
          {agent.diag}
        </p>
      )}
      {description && (
        <p className={cn(UNDER_HEAD, "text-text-secondary")} title={description}>
          {description}
        </p>
      )}

      {/* Unreported parts render nothing — never "Default". */}
      <p className={cn(UNDER_HEAD, "text-text-muted")}>
        ↳ {where.filter(Boolean).join(" · ")}
        {permissionLabel && <span title={agent.permission?.setting}> · {permissionLabel}</span>}
        {profileLabel && ` · ${profileLabel}`}
      </p>

      <ContextMeter agent={agent} color={color} className="mt-2.5" />

      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-label text-text-muted">
          {tokensSpent === null
            ? "Tokens spent: not measured yet"
            : `${formatTokens(tokensSpent)} tokens spent`}
        </span>
        {/* Own cards only: the delete reaches only local stores. */}
        <AgentDeleteButton agent={agent} />
        <button
          type="button"
          onClick={onOpen}
          aria-current={viewing ? "true" : undefined}
          className={OPEN_BUTTON}
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </div>
    </div>
  );
}
