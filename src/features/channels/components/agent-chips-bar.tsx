"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { Popover } from "@/shared/ui/popover-menu";
import { FIELD_WELL } from "@/shared/ui/wells";
import type { AgentStatus, ChannelAgent, ChannelMember } from "../types";
import {
  AGENT_HANDLE_HINT,
  AGENT_STATUS_LABEL,
  agentOwnerLabel,
  agentStatusDotClass,
  isAgentOwner,
  isValidAgentHandle,
  normalizeAgentHandle,
  visibleAgents,
} from "../lib/agent-display";

/** The status dot: pulsing (summoned), solid (active), hollow (parked). */
export function AgentStatusDot({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        agentStatusDotClass(status),
        className
      )}
    />
  );
}

interface Props {
  /** The channel's agents; dismissed rows are filtered out here. */
  agents: ChannelAgent[];
  /** Roster, for the owner avatar miniature + the owner's name. */
  members: ChannelMember[];
  memberNames: ReadonlyMap<string, string>;
  currentUserId: string;
  /** Rename an agent. Absent hides the affordance (still owner-gated below). */
  onRename?: (agentId: string, name: string) => Promise<unknown>;
  /** Park / resume / dismiss. Absent hides those affordances. */
  onSetStatus?: (agentId: string, status: AgentStatus) => Promise<unknown>;
}

/**
 * The AGENT CHIPS BAR — who is in the room besides the humans.
 *
 * One chip per non-dismissed agent, under the channel header and beside the
 * presence strip's concerns: handle, its owner's avatar miniature (an agent
 * runs on ITS OWNER'S machine, so the face is the fastest way to read whose it
 * is), and a status dot. Clicking a chip opens its popover.
 *
 * OWNER-ONLY: rename / park / dismiss show only on your own agents
 * (`agent.ownerUserId === currentUserId`, the same "mine" check the presence
 * and members surfaces use). Someone else's chip opens a read-only line saying
 * whose it is and what it is doing — peer visibility is coarse status by
 * design, never session internals. The server re-checks ownership; this is
 * legibility, not authorization.
 *
 * Renders nothing when the channel has no agents, so a plain human channel is
 * untouched by the multiplayer surface.
 */
export function AgentChipsBar({
  agents,
  members,
  memberNames,
  currentUserId,
  onRename,
  onSetStatus,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = visibleAgents(agents);
  if (shown.length === 0) return null;

  return (
    <div
      aria-label="Channel agents"
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border-subtle px-3.5 py-1.5"
    >
      <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
        Agents
      </span>
      {shown.map((agent) => {
        const owner = members.find((m) => m.userId === agent.ownerUserId);
        return (
          <div key={agent.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenId((v) => (v === agent.id ? null : agent.id))}
              title={`${agent.name} · ${agentOwnerLabel(
                agent,
                memberNames,
                currentUserId
              )} · ${AGENT_STATUS_LABEL[agent.status]}`}
              className="flex items-center gap-1.5 rounded-full border border-border-strong bg-bg-elevated py-0.5 pl-2 pr-1 text-caption font-medium text-text-primary transition-colors hover:bg-bg-elevated-hover"
            >
              <AgentStatusDot status={agent.status} />
              <span className="max-w-[120px] truncate">{agent.name}</span>
              <Avatar
                person={{
                  userId: agent.ownerUserId,
                  email: owner?.email ?? null,
                  displayName:
                    owner?.displayName ?? memberNames.get(agent.ownerUserId) ?? null,
                  avatarUrl: owner?.avatarUrl ?? null,
                }}
                size="xs"
                className="h-4 w-4"
              />
            </button>
            <Popover
              open={openId === agent.id}
              onClose={() => setOpenId(null)}
              className="w-64"
            >
              <AgentChipMenu
                agent={agent}
                owned={isAgentOwner(agent, currentUserId)}
                ownerLabel={agentOwnerLabel(agent, memberNames, currentUserId)}
                onRename={onRename}
                onSetStatus={onSetStatus}
                onDone={() => setOpenId(null)}
              />
            </Popover>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The chip's popover body. A non-owner reads status only. The owner gets a
 * rename field constrained by the handle charset (inline validation, refusing
 * the write rather than letting the server 400 it) plus park / resume /
 * dismiss.
 *
 * Exported so the owner-gating can be driven statically in tests — the popover
 * itself renders nothing until it is opened (same split the invite dialog's
 * `GroupChannelRoutingNote` uses).
 */
export function AgentChipMenu({
  agent,
  owned,
  ownerLabel,
  onRename,
  onSetStatus,
  onDone,
}: {
  agent: ChannelAgent;
  owned: boolean;
  ownerLabel: string;
  onRename?: (agentId: string, name: string) => Promise<unknown>;
  onSetStatus?: (agentId: string, status: AgentStatus) => Promise<unknown>;
  onDone: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [busy, setBusy] = useState(false);
  // Compared and sent in the form the server stores (trimmed + case-folded),
  // so "Quartz" is neither refused here nor a surprise rename there.
  const normalized = normalizeAgentHandle(name);
  const changed = normalized !== agent.name;
  const invalid = changed && !isValidAgentHandle(name);

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch {
      // The caller surfaces the error; keep the popover open for a retry.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <AgentStatusDot status={agent.status} />
        <span className="min-w-0 flex-1 truncate text-small font-medium text-text-primary">
          {agent.name}
        </span>
        <span className="shrink-0 text-micro text-text-muted">
          {AGENT_STATUS_LABEL[agent.status]}
        </span>
      </div>
      <span className="text-caption text-text-secondary">{ownerLabel}</span>

      {/* A dismissed agent is retired: nothing about it is editable any more
          (its chip is gone too — this path is only reachable mid-dismiss). */}
      {owned && onRename && agent.status !== "dismissed" && (
        <>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            maxLength={31}
            spellCheck={false}
            aria-label="Agent handle"
            aria-invalid={invalid || undefined}
            placeholder="handle"
            className={cn(
              FIELD_WELL,
              "w-full px-2.5 py-1 text-caption text-text-primary placeholder:text-text-muted",
              invalid && "text-danger"
            )}
          />
          {invalid && (
            <span className="text-micro text-danger">{AGENT_HANDLE_HINT}</span>
          )}
          <button
            type="button"
            disabled={busy || !changed || invalid}
            onClick={() => run(() => onRename(agent.id, normalized))}
            className="btn-light self-end rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
          >
            Rename
          </button>
        </>
      )}

      {owned && onSetStatus && agent.status !== "dismissed" && (
        <div className="flex items-center justify-end gap-1.5 border-t border-border-subtle pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(() =>
                onSetStatus(
                  agent.id,
                  agent.status === "parked" ? "summoned" : "parked"
                )
              )
            }
            className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
          >
            {agent.status === "parked" ? "Resume" : "Park"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => onSetStatus(agent.id, "dismissed"))}
            className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-danger disabled:opacity-60"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
