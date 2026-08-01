"use client";

import { useEffect, useState } from "react";
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
import {
  AGENT_ENGAGEMENT_LABEL,
  AGENT_ENGAGEMENT_TAG,
  agentEngagedByLabel,
  agentEngagementChipClass,
  agentEngagementHint,
  agentEngagementTagClass,
  canDisengageAgent,
  deriveAgentEngagement,
  engagementTickDelay,
  nextEngagementExpiry,
  type AgentEngagement,
} from "../lib/agent-engagement";

/**
 * THE ENGAGEMENT CLOCK — the `now` every chip in this bar is derived against.
 *
 * Engagement expires by the passage of time and nothing else: no message, no
 * realtime event, no server write marks the moment an agent stops acting on
 * untagged messages, because the server deliberately never expires the stamp
 * (`constants.ts#ENGAGEMENT_TTL_MS`). A bar rendered once therefore keeps
 * saying "listening" long after the desktop has stopped listening, which is the
 * chip promising behavior nothing will deliver.
 *
 * SCHEDULED, NOT POLLED. One `setTimeout` aimed at the exact instant the
 * soonest-expiring agent falls out of the window ({@link nextEngagementExpiry}),
 * rescheduled whenever that instant changes. A blind interval would have been
 * simpler to write and worse on both ends: it wakes an idle tab for an hour of
 * nothing, and it is still up to a full period late on the one transition it
 * exists to catch. Nothing is engaged -> the expiry is null -> NO timer at all,
 * so a plain human channel and a channel of idle agents cost the same as before.
 *
 * TWO WAKES, NOT ONE, and the second is the subtle one. A clock that is ONLY
 * woken by its own expiry timer fails in the opposite direction, and silently:
 * on a quiet channel nothing is engaged, so no timer is ever scheduled, so the
 * `now` seeded at mount FREEZES there. Engage an agent two hours later and its
 * fresh stamp lands two hours in that stale clock's future, which the skew bound
 * in `hasLiveEngagementStamp` correctly refuses -> the chip reads IDLE over an
 * agent that is listening right now, and `nextEngagementExpiry` skips it for the
 * same reason, so no timer arrives to undo it. The bar would be stuck lying.
 * Hence the RESYNC effect below, which re-reads the wall clock whenever the
 * stamps themselves change. Reading `Date.now()` during render would fix it too
 * and is exactly what React's purity rule forbids; a timer callback is where
 * that impurity is allowed to live, so both wakes go through one.
 *
 * `expiry` is a plain number and does NOT move with `now` (it is a stamp plus
 * the TTL), so a parent that hands us a fresh `agents` array every render does
 * not resubscribe; the expiry effect re-runs only when the instant we are
 * waiting for actually moves.
 */
function useEngagementClock(agents: readonly ChannelAgent[]): number {
  const [now, setNow] = useState(() => Date.now());
  // Derived against the SAME `now` the chips render against, so the timer we
  // schedule and the state the user sees can never disagree about who is next.
  const expiry = nextEngagementExpiry(agents, now);

  // Everything a chip's engagement is derived FROM, other than time. Changes
  // only when realtime delivers a new / cleared stamp or a lifecycle flip.
  const stampKey = agents
    .map((a) => `${a.id}:${a.engagedAt ?? ""}:${a.status}`)
    .join("|");

  // RESYNC. A ONE-SHOT settle, not a tick: it is keyed on the stamps, so it
  // fires once at mount and once per stamp change and then stays quiet forever
  // on a channel where nothing happens. It cannot loop, because re-reading the
  // clock does not change `stampKey`.
  useEffect(() => {
    const id = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(id);
  }, [stampKey]);

  // EXPIRY. The wake that makes a lit chip go dark on time. No engaged agent
  // means no expiry means NO TIMER AT ALL.
  useEffect(() => {
    if (expiry === null) return;
    const id = setTimeout(
      () => setNow(Date.now()),
      engagementTickDelay(expiry, Date.now())
    );
    return () => clearTimeout(id);
  }, [expiry]);

  return now;
}

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
  /**
   * Roster, for the owner avatar miniature, the owner's name, AND the owner's
   * desktop presence — an agent runs on its owner's machine, so their
   * `agentOnline` decides whether a live engagement can act at all.
   */
  members: ChannelMember[];
  memberNames: ReadonlyMap<string, string>;
  currentUserId: string;
  /** Rename an agent. Absent hides the affordance (still owner-gated below). */
  onRename?: (agentId: string, name: string) => Promise<unknown>;
  /** Park / resume / dismiss. Absent hides those affordances. */
  onSetStatus?: (agentId: string, status: AgentStatus) => Promise<unknown>;
  /** Stop an agent listening to this channel. Absent hides the affordance. */
  onDisengage?: (agentId: string) => Promise<unknown>;
}

/**
 * The AGENT CHIPS BAR — who is in the room besides the humans, and which of
 * them is actually listening.
 *
 * One chip per non-dismissed agent, under the channel header: handle, its
 * owner's avatar miniature (an agent runs on ITS OWNER'S machine, so the face
 * is the fastest way to read whose it is), a lifecycle status dot, and the
 * ENGAGEMENT treatment in three states — LIT when it will act on your next
 * untagged message, SOLID BUT FLAT when it is engaged and cannot act right now
 * (parked, or its owner's desktop is offline), HOLLOW AND DASHED when it has to
 * be tagged. A distinct word rides in each chip and in its accessible name, so
 * the distinction never rests on color.
 *
 * Engagement is the fact an operator acts on. Clicking a chip opens a popover
 * that says what to expect in one line, and who engaged it.
 *
 * THE BAR OWNS A CLOCK ({@link useEngagementClock}). Engagement expires by time
 * alone, so without one every chip would go on claiming "listening" until some
 * unrelated re-render happened by. There is no timer when nothing is engaged.
 *
 * OWNER-ONLY: rename / park / dismiss / disengage show only on your own agents
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
  onDisengage,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  // Before the early return: a hook may not be skipped, and this one is what
  // keeps every chip below honest as the TTL elapses.
  const now = useEngagementClock(agents);
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
        // The owner's roster row carries the presence bits, and an agent runs
        // on ITS OWNER'S machine: no desktop, no listening, however fresh the
        // stamp is. Absent (roster loading, owner no longer a member) stays
        // unknown rather than becoming a claim that their machine is gone.
        const owner = members.find((m) => m.userId === agent.ownerUserId);
        const engagement = deriveAgentEngagement(agent, now, owner);
        return (
          <div key={agent.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenId((v) => (v === agent.id ? null : agent.id))}
              title={`${agent.name} · ${agentOwnerLabel(
                agent,
                memberNames,
                currentUserId
              )} · ${AGENT_ENGAGEMENT_LABEL[engagement]} · ${
                AGENT_STATUS_LABEL[agent.status]
              } · ${agentEngagementHint(engagement, agent.name)}`}
              className={cn(
                "flex items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-1 text-caption font-medium transition-colors",
                // Hover included: it belongs to the state, not to the chip.
                agentEngagementChipClass(engagement)
              )}
            >
              <AgentStatusDot status={agent.status} />
              <span className="max-w-[120px] truncate">{agent.name}</span>
              <EngagementTag engagement={engagement} />
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
                engagement={engagement}
                canDisengage={canDisengageAgent(agent, currentUserId, now)}
                ownerLabel={agentOwnerLabel(agent, memberNames, currentUserId)}
                engagedByLabel={agentEngagedByLabel(
                  agent,
                  memberNames,
                  currentUserId,
                  now
                )}
                onRename={onRename}
                onSetStatus={onSetStatus}
                onDisengage={onDisengage}
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
 * The engagement word, rendered inside the chip.
 *
 * It is NOT a decoration duplicating the chip's fill: it is the non-color
 * carrier of the state, which is why it is real text rather than a `title` or
 * an `aria-label` alone. One distinct word per state, so the three treatments
 * are still three when color is not available.
 *
 * Exported and asserted directly in the test, one state at a time, because a
 * word that changes is easier to catch on the word than on a whole bar.
 */
export function EngagementTag({ engagement }: { engagement: AgentEngagement }) {
  return (
    <span
      className={cn(
        "shrink-0 text-micro font-medium uppercase tracking-wide",
        agentEngagementTagClass(engagement)
      )}
    >
      {AGENT_ENGAGEMENT_TAG[engagement]}
    </span>
  );
}

/**
 * The chip's popover body. A non-owner reads status only. The owner gets a
 * rename field constrained by the handle charset (inline validation, refusing
 * the write rather than letting the server 400 it) plus park / resume /
 * dismiss, and Disengage when the agent is currently engaged.
 *
 * Exported so the owner-gating can be driven statically in tests — the popover
 * itself renders nothing until it is opened (same split the invite dialog's
 * `GroupChannelRoutingNote` uses).
 */
export function AgentChipMenu({
  agent,
  owned,
  engagement,
  canDisengage = false,
  ownerLabel,
  engagedByLabel = null,
  onRename,
  onSetStatus,
  onDisengage,
  onDone,
}: {
  agent: ChannelAgent;
  owned: boolean;
  /**
   * The chip's state, resolved by the bar. PASSED IN, never re-derived here:
   * the bar holds both inputs this popover does not have, the engagement clock
   * and the owner's presence, and a popover that re-derived from `agent` alone
   * would quietly say "listening" over an owner whose desktop is gone.
   */
  engagement: AgentEngagement;
  /**
   * The result of {@link canDisengageAgent} for the viewer — owner-only AND
   * currently engaged. Passed in rather than re-derived so the ONE rule lives
   * in the lib; the `owned` gate below is still required, so a caller that
   * forgets cannot open the affordance to a peer.
   */
  canDisengage?: boolean;
  ownerLabel: string;
  /** {@link agentEngagedByLabel} — who engaged it, when that is worth saying. */
  engagedByLabel?: string | null;
  onRename?: (agentId: string, name: string) => Promise<unknown>;
  onSetStatus?: (agentId: string, status: AgentStatus) => Promise<unknown>;
  onDisengage?: (agentId: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [busy, setBusy] = useState(false);
  // Compared and sent in the form the server stores (trimmed + case-folded),
  // so "Quartz" is neither refused here nor a surprise rename there.
  const normalized = normalizeAgentHandle(name);
  const changed = normalized !== agent.name;
  const invalid = changed && !isValidAgentHandle(name);
  // Owner-gated exactly like the other writes, and additionally hidden when
  // there is nothing to disengage FROM — an idle agent offering "Disengage"
  // teaches that idle means engaged.
  const showDisengage = !!onDisengage && owned && canDisengage;

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

      {/* What the state MEANS, in one line, for everyone who can see the chip.
          This is the sentence that makes the treatments actionable — including
          the held ones, where the useful fact is what it is waiting on. */}
      <div className="flex items-center gap-1.5">
        <EngagementTag engagement={engagement} />
        <span className="min-w-0 flex-1 text-caption text-text-secondary">
          {agentEngagementHint(engagement, agent.name)}
        </span>
      </div>

      {/* Who engaged it. The one person the owner-only Disengage is most likely
          to frustrate is the peer who engaged somebody else's agent, so name
          them rather than leaving the chip looking broken. */}
      {engagedByLabel && (
        <span className="text-caption text-text-muted">{engagedByLabel}</span>
      )}

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

      {owned && agent.status !== "dismissed" && (onSetStatus || showDisengage) && (
        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border-subtle pt-2">
          {showDisengage && onDisengage && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => onDisengage(agent.id))}
              title="Stop it listening to this channel. It stays a member."
              className="btn-light rounded-[8px] px-2.5 py-1 text-caption font-medium text-text-primary disabled:opacity-60"
            >
              Disengage
            </button>
          )}
          {onSetStatus && (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
